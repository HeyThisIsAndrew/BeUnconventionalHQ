/**
 * THE HQ DISPATCH feed: what /dispatch.xml carries and which images the
 * newsletter needs (issue #266). The route (src/pages/dispatch.xml.ts) and
 * the image sync (scripts/sync-dispatch-images.mjs) both select through
 * selectDispatchEntries(), so the sync always builds images for exactly the
 * stories the feed will list.
 *
 * Plain module, no JSON imports, so it runs under `node` in
 * scripts/dispatch-feed.test.mjs. Callers hand it the data.
 *
 * ─── WHY A SECOND FEED ────────────────────────────────────────────────────
 * /rss.xml is the Google News feed (see the note at the top of that route).
 * It lists articles only, with no image and no category, and it is not to be
 * reshaped for an email. Kit, which sends the newsletter, reads THIS one.
 *
 * ─── WHAT KIT NEEDS FROM AN ITEM ──────────────────────────────────────────
 * Kit's RSS Liquid exposes title, url, summary, categories and content, and
 * has NO image variable. So the image is the FIRST element of
 * content:encoded, and the Kit Post Template
 * (email/hq-dispatch/post-template.liquid.html) reads the first `src="`.
 * Categories are [content type, section]: "Review", "TV" renders REVIEW | TV,
 * and a "Video" type turns the button into Watch now.
 *
 * ─── IMAGES ARE NEVER CUT OFF ─────────────────────────────────────────────
 * The owner's rule. An item's image is the committed 1200x675 JPEG the sync
 * composed (the whole picture fitted inside a 16:9 frame over a blurred copy
 * of itself), never the raw source: a raw one could be any shape, and the
 * email's 16:9 box would have to crop or distort it. An item whose image was
 * not built yet gets the branded fallback (DISPATCH_FALLBACK_IMAGE), so the
 * FEATURED box always opens on a full-width image.
 */
import { articlePath } from '../data/sections.js';
import { editorialPreview } from './editorial-text.ts';

/** How many stories the feed lists. Kit takes the ones new since its last
 *  send; twenty covers a week of articles and videos with room to spare. */
export const DISPATCH_FEED_LIMIT = 20;

/** Every newsletter image is this size: 16:9, 2x the email's 550px box. */
export const DISPATCH_IMAGE_WIDTH = 1200;
export const DISPATCH_IMAGE_HEIGHT = 675;

/** Where the composed images are served from, under public/. */
export const DISPATCH_IMAGE_PUBLIC_PATH = '/dispatch/images';

/** The masthead (3:1), and the 16:9 art a story gets when it has none of its
 *  own. Both built by scripts/build-dispatch-art.mjs and committed. */
export const DISPATCH_HEADER_IMAGE = '/dispatch/header-v2-1200x400.png';
export const DISPATCH_FALLBACK_IMAGE = '/dispatch/fallback-1200x675.jpg';

/** Section names that say nothing, so the label shows the type alone. */
const NON_SECTIONS = new Set(['', 'general']);

export interface DispatchArticleInput {
  slug: string;
  title: string;
  isoDate: string;
  excerpt?: string;
  preview?: string[];
  image?: string;
  category?: string;
  contentType?: string;
  editorial?: unknown;
}

export interface DispatchVideoInput {
  title: string;
  link: string;
  youtubeId?: string;
  publishedAt?: string;
  description?: string;
  thumbnail?: string;
  category?: string;
  isShort?: boolean;
  isLive?: boolean;
  editorial?: unknown;
}

/**
 * The newsletter's own copy for a story, kept as SEPARATE fields (owner's
 * rules, 2026-10-31):
 *   subtitle  the author's standfirst, printed whole: the CMS editorial
 *             excerpt, else (articles) the Substack subtitle. Never rewritten.
 *   lede      articles only: whole sentences from the opening paragraph,
 *             minus any sentence that repeats the subtitle. Shown under the
 *             subtitle on FEATURED; it is where the date and place live.
 *   blurb     the one line under a LATEST headline: a newsletter-specific
 *             `editorial.newsletterBlurb` if written, else the subtitle when
 *             it is one line. Never the body's first sentence, never a
 *             YouTube description, never cut mid-sentence.
 *   missing   what the owner still has to write ('subtitle', 'blurb'). A
 *             missing field is left OUT of the email and reported; it is
 *             never invented or filled from somewhere else.
 */
export interface NewsletterCopy {
  subtitle: string | null;
  lede: string | null;
  blurb: string | null;
  missing: string[];
}

/** Longest lede excerpt, in characters. Whole sentences only, so often shorter. */
export const NEWSLETTER_LEDE_MAX = 320;
/** Longest subtitle that still counts as a one-line LATEST blurb. */
export const NEWSLETTER_BLURB_MAX = 220;

export interface DispatchEntry {
  kind: 'article' | 'video';
  title: string;
  /** Absolute URL. */
  link: string;
  /** Plain-text summary. */
  summary: string;
  pubDate: Date;
  /** [content type, section?] */
  categories: string[];
  /** The ORIGINAL image URL. The sync composes it; the feed looks it up. */
  imageSource: string | null;
  /** The newsletter's separate fields (see NewsletterCopy). */
  newsletter: NewsletterCopy;
}

/** One manifest entry, keyed by the source URL. */
export interface DispatchImage {
  src: string;
  width: number;
  height: number;
}
export type DispatchImageManifest = Record<string, DispatchImage>;

/**
 * Is this raw videos.json doc a long-form, published video? The same test
 * getVideosUnified() (src/lib/videos-source.ts) applies, restated here because
 * that module imports the JSON store and the sync runs under plain node.
 * Shorts and live streams are left out, as on the event coverage pages.
 */
export function isDispatchVideoDoc(doc: any): boolean {
  const type = doc?.manualTypeOverride || doc?._type;
  if (type !== 'video') return false;
  if (doc.contentStatus && doc.contentStatus !== 'published') return false;
  return Boolean(doc.youtubeId && doc.title && !doc.isShort && !doc.isLive);
}

function section(category: unknown): string | null {
  const s = String(category ?? '').trim();
  return NON_SECTIONS.has(s.toLowerCase()) ? null : s;
}

function validDate(value: unknown): Date | null {
  const d = new Date(String(value ?? ''));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Absolute site URL, with a slash-free canonical path (see rss.xml.ts). */
function absolute(siteUrl: string, pathname: string): string {
  return new URL(pathname, siteUrl).toString().replace(/\/$/, '');
}

const plainText = (value: unknown): string =>
  String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Sentences of plain text. A sentence ends at . ! ? or an ellipsis, before a capital or quote. */
export function splitSentences(text: string): string[] {
  return plainText(text)
    .split(/(?<=[.!?\u2026]["\u201d\u2019)]?)\s+(?=["\u201c\u2018(]?[A-Z0-9])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Compares sentences the way a reader would: case, quote style and end punctuation aside. */
const sentenceKey = (s: string) =>
  s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\s.!?\u2026,;:]+$/, '').replace(/\s+/g, ' ').trim();

/** Text a machine shortened: it ends in an ellipsis. Never printed as a whole line. */
const looksCut = (s: string) => /(\u2026|\.\.\.)$/.test(s.trim());

/** Whole sentences from the front of `paragraph`, up to `max` characters, skipping any in `avoid`. */
export function wholeSentences(paragraph: string, max: number, avoid: string[] = []): string | null {
  const banned = new Set(avoid.flatMap((a) => splitSentences(a)).map(sentenceKey));
  const kept: string[] = [];
  for (const sentence of splitSentences(paragraph)) {
    if (banned.has(sentenceKey(sentence))) continue;
    if ([...kept, sentence].join(' ').length > max) break;
    kept.push(sentence);
  }
  return kept.length ? kept.join(' ') : null;
}

export function newsletterCopy(
  item: DispatchArticleInput | DispatchVideoInput,
  kind: 'article' | 'video',
): NewsletterCopy {
  const editorial = (item.editorial ?? {}) as { excerpt?: unknown; newsletterBlurb?: unknown };
  const authored = plainText(editorial.excerpt);
  const substackSubtitle = kind === 'article' ? plainText((item as DispatchArticleInput).excerpt) : '';
  const subtitle = authored || substackSubtitle || null;

  let lede: string | null = null;
  if (kind === 'article') {
    const preview = (item as DispatchArticleInput).preview;
    const opening = plainText(Array.isArray(preview) ? preview[0] : preview);
    lede = opening ? wholeSentences(opening, NEWSLETTER_LEDE_MAX, subtitle ? [subtitle] : []) : null;
  }

  const written = plainText(editorial.newsletterBlurb);
  const subtitleFits = subtitle && subtitle.length <= NEWSLETTER_BLURB_MAX && !looksCut(subtitle);
  const blurb = written || (subtitleFits ? subtitle : null);

  const missing: string[] = [];
  if (!subtitle) missing.push('subtitle');
  if (!blurb) missing.push('blurb');
  return { subtitle, lede, blurb, missing };
}

export function articleEntry(article: DispatchArticleInput, siteUrl: string): DispatchEntry | null {
  const pubDate = validDate(article.isoDate);
  if (!article.slug || !article.title || !pubDate) return null;
  const type = String(article.contentType ?? '').trim() || 'Story';
  return {
    kind: 'article',
    title: article.title,
    /* Never hand-build this path: articlePath() is the one place that knows
       where an article lives. */
    link: absolute(siteUrl, articlePath(article.slug)),
    summary: editorialPreview(article),
    pubDate,
    categories: [type, section(article.category)].filter(Boolean) as string[],
    imageSource: article.image ? String(article.image) : null,
    newsletter: newsletterCopy(article, 'article'),
  };
}

export function videoEntry(video: DispatchVideoInput): DispatchEntry | null {
  const pubDate = validDate(video.publishedAt);
  if (!video.title || !video.link || !pubDate || video.isShort || video.isLive) return null;
  return {
    kind: 'video',
    title: video.title,
    /* The watch page. There is no per-video page on the site; the reader
       asked to watch, and YouTube is where the video plays. */
    link: video.link,
    summary: editorialPreview(video),
    pubDate,
    categories: ['Video', section(video.category)].filter(Boolean) as string[],
    imageSource: video.thumbnail ? String(video.thumbnail) : null,
    newsletter: newsletterCopy(video, 'video'),
  };
}

/**
 * The stories the newsletter feed lists: articles and long-form videos
 * together, newest first, capped at `limit`. Kit makes the first new one
 * FEATURED. Ties break on title so two builds never disagree.
 */
export function selectDispatchEntries(
  articles: readonly DispatchArticleInput[],
  videos: readonly DispatchVideoInput[],
  siteUrl: string,
  limit: number = DISPATCH_FEED_LIMIT,
): DispatchEntry[] {
  const entries = [
    ...articles.map((a) => articleEntry(a, siteUrl)),
    ...videos.map((v) => videoEntry(v)),
  ].filter((e): e is DispatchEntry => e !== null);
  entries.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime() || a.title.localeCompare(b.title));
  return entries.slice(0, limit);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The image for an entry, as an absolute URL: its composed art, or the
 * branded fallback when it has none built yet. NEVER null, so every box,
 * the FEATURED one above all, opens on a full-width 16:9 image (owner's
 * call). Never the raw source either: see the header.
 */
export function dispatchImageUrl(
  entry: DispatchEntry,
  manifest: DispatchImageManifest,
  siteUrl: string,
): string {
  const image = entry.imageSource ? manifest[entry.imageSource] : undefined;
  const built =
    image?.src && image.width === DISPATCH_IMAGE_WIDTH && image.height === DISPATCH_IMAGE_HEIGHT;
  return absolute(siteUrl, built ? image.src : DISPATCH_FALLBACK_IMAGE);
}

/**
 * content:encoded for one item. The image MUST come first: it is the only way
 * Kit's Post Template can find it (see the header).
 */
export function dispatchContentHtml(entry: DispatchEntry, imageUrl: string): string {
  const img = `<img src="${escapeHtml(imageUrl)}" width="${DISPATCH_IMAGE_WIDTH}" height="${DISPATCH_IMAGE_HEIGHT}" alt="">`;
  const summary = entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : '';
  return img + summary;
}

/**
 * An entry as Kit's RSS Liquid would see it: what the Post Template
 * (email/hq-dispatch/post-template.liquid.html) is rendered with. Title and
 * summary are escaped here because the template prints them raw.
 */
export function dispatchKitPost(entry: DispatchEntry, imageUrl: string) {
  return {
    title: escapeHtml(entry.title),
    url: entry.link,
    summary: escapeHtml(entry.summary),
    content: dispatchContentHtml(entry, imageUrl),
    categories: entry.categories,
    /* The newsletter's separate fields. The Post Template prefers these
       whenever `newsletter` is set, and prints them whole. */
    newsletter: true,
    subtitle: entry.newsletter.subtitle ? escapeHtml(entry.newsletter.subtitle) : '',
    lede: entry.newsletter.lede ? escapeHtml(entry.newsletter.lede) : '',
    blurb: entry.newsletter.blurb ? escapeHtml(entry.newsletter.blurb) : '',
  };
}

/** One item of /dispatch.json, the machine twin of /dispatch.xml. */
export interface DispatchJsonItem {
  /** Stable identity across builds: the item's absolute link. */
  guid: string;
  kind: 'article' | 'video';
  title: string;
  link: string;
  summary: string;
  /** ISO 8601. */
  pubDate: string;
  /** [content type, section?], the same pair the RSS item carries. */
  categories: string[];
  /** Absolute URL of the composed 1200x675 image (or the branded fallback). */
  imageUrl: string;
  /** The story as the newsletter's FEATURED box (src/lib/dispatch-boxes.ts). */
  featuredHtml?: string;
  /** The story as a LATEST FROM THE HQ box, without the section heading. */
  latestHtml?: string;
  /** The story as an ALSO THIS WEEK line (a demoted duplicate, see the Kit Worker). */
  alsoHtml?: string;
  /** The newsletter's separate fields and what is missing (see NewsletterCopy). */
  newsletter: NewsletterCopy;
}

/**
 * /dispatch.json item. Workers (the social distribution engine, issue #282)
 * read this rather than parse the XML; the fields are the RSS item's, so the
 * two feeds can never disagree about a story.
 */
export function dispatchJsonItem(entry: DispatchEntry, imageUrl: string): DispatchJsonItem {
  return {
    guid: entry.link,
    kind: entry.kind,
    title: entry.title,
    link: entry.link,
    summary: entry.summary,
    pubDate: entry.pubDate.toISOString(),
    categories: entry.categories,
    imageUrl,
    newsletter: entry.newsletter,
  };
}
