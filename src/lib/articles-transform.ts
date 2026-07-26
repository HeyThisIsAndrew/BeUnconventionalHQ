/**
 * Substack RSS → article record pipeline.
 *
 * Build-time only. Imported by `scripts/sync-articles.mjs` and its test suite,
 * never by a page — the snapshot stores already-sanitized HTML, so
 * `sanitize-html` stays out of the site bundle entirely.
 *
 * Every function here is pure so the whole pipeline is testable offline
 * against a fixture feed, with no network.
 */
import sanitizeHtml from 'sanitize-html';
import { CATEGORIES } from '../data/constants.js';

/** Semantic tags only. No styling, no embeds, no scripts. */
const ALLOWED_TAGS = [
  'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'hr',
  'a', 'img', 'figure', 'figcaption', 'em', 'strong', 'code', 'pre', 'br',
];

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title', 'rel', 'target'],
  img: ['src', 'alt', 'title', 'width', 'height'],
};

/**
 * Demote in-body headings by one level.
 *
 * The page's own <h1> is the article title, so a Substack body that opens with
 * an h1 would produce two. h1→h2, h2→h3, h3→h4; h4 and below are clamped at
 * h4 rather than pushed to h5/h6, which keeps the outline shallow and valid.
 *
 * Runs BEFORE sanitization so the allowlist (which has no h1) sees the
 * already-demoted markup rather than silently dropping the heading text.
 */
export function demoteHeadings(html: string): string {
  if (!html) return '';
  return html.replace(
    /<(\/?)h([1-6])\b([^>]*)>/gi,
    (_m, slash: string, level: string, rest: string) => {
      const demoted = Math.min(Number(level) + 1, 4);
      return `<${slash}h${demoted}${rest}>`;
    },
  );
}

/** Sanitize imported HTML down to the semantic allowlist. */
export function sanitizeArticleHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtml(demoteHeadings(html), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    // Strip Substack's tracking/CDN query junk but keep the URL usable.
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // Force safe rel on every anchor that leaves the site.
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const isExternal = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: isExternal
            ? { ...attribs, rel: 'noopener noreferrer', target: '_blank' }
            : attribs,
        };
      },
    },
    // Drop empty paragraphs Substack leaves behind between blocks.
    exclusiveFilter: (frame) =>
      frame.tag === 'p' && !frame.text.trim() && !frame.mediaChildren.length,
  }).trim();
}

/**
 * Map a post to one of the site's canonical categories.
 *
 * Tag-driven by design: the owner tags Substack posts with matching keywords,
 * so this reads tags first and only falls back to title/description text when
 * a post carries no usable tag. Note the site's film category is `Film`, not
 * `Movies` — see src/data/constants.js.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // Deliberately excludes 'review' and 'trailer': TV and games get reviewed and
  // trailered too, so those words carry no category signal and, being checked
  // first, would have swallowed everything into Film.
  Film: ['film', 'films', 'movie', 'movies', 'cinema', 'boxoffice'],
  TV: ['tv', 'television', 'series', 'season', 'episode', 'streaming', 'show'],
  Gaming: ['gaming', 'game', 'games', 'videogame', 'playstation', 'xbox', 'nintendo', 'steam'],
  Events: ['event', 'events', 'convention', 'con', 'comiccon', 'comic-con', 'sdcc', 'd23', 'premiere', 'expo'],
};

const FALLBACK_CATEGORY = 'General';

function normalizeToken(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function mapCategory(tags: string[] = [], text = ''): string {
  const normalizedTags = tags.map(normalizeToken).filter(Boolean);

  // 1. Exact tag match against a canonical category name (Film, TV, ...).
  for (const category of CATEGORIES) {
    if (normalizedTags.includes(normalizeToken(category))) return category;
  }

  // 2. Tag match against that category's keyword set.
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (normalizedTags.some((t) => keywords.map(normalizeToken).includes(t))) {
      return category;
    }
  }

  // 3. Last resort: keyword scan of title/description. Weakest signal, which
  //    is exactly why tagging posts is the documented workflow.
  const haystack = ` ${String(text).toLowerCase()} `;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => haystack.includes(` ${k} `))) return category;
  }

  return FALLBACK_CATEGORY;
}

/** URL-safe slug. Derived from the Substack permalink when possible. */
export function toSlug(link: string, title: string): string {
  const fromLink = String(link ?? '').match(/\/p\/([^/?#]+)/);
  const raw = fromLink ? fromLink[1] : String(title ?? '');
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Strip tags/entities down to plain text, for excerpts and alt fallbacks. */
export function toPlainText(html: string): string {
  return sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImage(html: string): string {
  const match = String(html ?? '').match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

/**
 * Substack sometimes truncates a paid post's `content:encoded` to a teaser.
 * This is a safety net against that, NOT a paywall feature — every article is
 * meant to render in full. A record that trips this keeps its metadata (so it
 * still appears in the Feed, linking out to Substack) but is not given a local
 * page, rather than publishing a stub that reads as broken.
 */
const MIN_BODY_CHARS = 400;

export function looksTruncated(bodyHtml: string): boolean {
  const text = toPlainText(bodyHtml);
  if (text.length < MIN_BODY_CHARS) return true;
  return /subscribe to (keep reading|read more)|this post is for (paid|paying)|upgrade to continue/i.test(text);
}

export interface RawFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  contentEncoded?: string;
  categories?: string[];
  enclosureUrl?: string;
}

export interface ArticleRecord {
  guid: string;
  slug: string;
  title: string;
  link: string;
  date: string;
  isoDate: string;
  excerpt: string;
  image: string;
  category: string;
  tags: string[];
  bodyHtml: string;
  hasBody: boolean;
  firstSeen: string;
  lastUpdated: string;
}

/** Display date in the format the existing cache and cards already use. */
function formatDisplayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Build a durable record from one feed item.
 * Returns null for items too malformed to be useful (no title, or no
 * guid/link to key on) so the caller can skip and log them.
 */
export function buildArticleRecord(item: RawFeedItem, now = new Date()): ArticleRecord | null {
  const title = toPlainText(item.title ?? '');
  const link = String(item.link ?? '').trim();
  const guid = String(item.guid ?? link).trim();

  if (!title || !guid) return null;

  const parsedDate = new Date(item.pubDate ?? '');
  const isoDate = Number.isNaN(parsedDate.getTime())
    ? now.toISOString()
    : parsedDate.toISOString();

  const bodyHtml = sanitizeArticleHtml(item.contentEncoded ?? '');
  const tags = (item.categories ?? []).map((t) => String(t).trim()).filter(Boolean);
  const excerptSource = item.description ?? bodyHtml;

  return {
    guid,
    slug: toSlug(link, title),
    title,
    link,
    date: formatDisplayDate(isoDate),
    isoDate,
    excerpt: toPlainText(excerptSource).slice(0, 280),
    image: item.enclosureUrl || firstImage(item.contentEncoded ?? ''),
    category: mapCategory(tags, `${title} ${toPlainText(item.description ?? '')}`),
    tags,
    bodyHtml,
    hasBody: Boolean(bodyHtml) && !looksTruncated(bodyHtml),
    firstSeen: now.toISOString(),
    lastUpdated: now.toISOString(),
  };
}

/**
 * Merge freshly parsed records into the durable snapshot.
 *
 * Semantics, per the epic: new GUIDs are appended, existing GUIDs are updated
 * in place, and **records are never deleted**. Substack's /feed returns only a
 * rolling window, so anything that ages out of it must survive here or its
 * live URL 404s on the next deploy.
 *
 * Editorial fields a human may have set (`editorial`) are preserved across
 * updates; feed-derived fields are refreshed.
 */
export function mergeSnapshot(
  existing: ArticleRecord[],
  incoming: ArticleRecord[],
): { merged: ArticleRecord[]; added: number; updated: number } {
  const byGuid = new Map<string, ArticleRecord>();
  for (const record of existing ?? []) {
    if (record?.guid) byGuid.set(record.guid, record);
  }

  let added = 0;
  let updated = 0;

  for (const record of incoming) {
    const prior = byGuid.get(record.guid);
    if (!prior) {
      byGuid.set(record.guid, record);
      added += 1;
      continue;
    }
    byGuid.set(record.guid, {
      ...prior,
      ...record,
      // Never let a re-sync rewrite when we first saw a post.
      firstSeen: prior.firstSeen ?? record.firstSeen,
      // A feed that stops returning bodies must not blank an archived one.
      bodyHtml: record.bodyHtml || prior.bodyHtml,
      hasBody: record.hasBody || prior.hasBody,
      // Editorial overrides win over anything the feed says.
      ...(prior as any).editorial ? { editorial: (prior as any).editorial } : {},
    });
    updated += 1;
  }

  return {
    merged: [...byGuid.values()].sort(
      (a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime(),
    ),
    added,
    updated,
  };
}
