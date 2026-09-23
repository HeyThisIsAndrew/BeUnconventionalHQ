/**
 * The homepage's content model — pure functions, no I/O.
 *
 * `src/data/homepage-feed.ts` binds these to the real stores (articles.json,
 * videos.json, the image manifest); this file only shapes and deals. It is
 * split that way so plain `node` can test it: a module that statically
 * imports JSON cannot be loaded there. See scripts/homepage-feed.test.mjs.
 *
 * ─── DEFENSIVE BY CONSTRUCTION ─────────────────────────────────────────────
 * The previous homepage attempt shipped a white screen, and one of the causes
 * was date math over an empty filtered array (`Math.max()` of nothing is
 * -Infinity, and `new Date(-Infinity)` is Invalid Date, which throws the moment
 * anything calls toISOString on it). Nothing here reduces over a list that may
 * be empty, every date goes through `toTime()` (which answers NaN-safe 0), and
 * every section builder returns an empty list or `null` rather than throwing.
 * The components render nothing for an empty section.
 *
 * ─── ONE POOL, DEALT ONCE ──────────────────────────────────────────────────
 * Every section takes from the same pool through `claim()`, so no story
 * appears twice on the page. The deal order is the editorial priority:
 * the featured world is pinned by an editor, so it claims first; the newest
 * story overall is next (it is the LATEST panel); then one per category for
 * the hero; then Intel; then the rail.
 */

export type HomeCategory = 'Film' | 'TV' | 'Games' | 'Events';
export const HOME_CATEGORIES: HomeCategory[] = ['Film', 'TV', 'Games', 'Events'];

export interface ImageSources {
  src: string;
  srcset: string;
}

export interface HomeStory {
  id: string;
  category: HomeCategory | null;
  /** The small label above a headline: the piece's kind (Review, Analysis…). */
  kicker: string;
  headline: string;
  deck: string;
  image: string;
  imageSrcset: string;
  url: string;
  /** True when `url` leaves the site. */
  external: boolean;
  /** ISO timestamp, or '' when the source had none that parses. */
  publishDate: string;
  /** "Sep 15, 2026", or ''. */
  displayDate: string;
  type: 'article' | 'video';
  /** "8 min read" for articles, '' otherwise. */
  readTime: string;
  /** "12:48" for videos, '' otherwise. */
  duration: string;
  /** YouTube id, videos only — drives the site's #video-modal. */
  videoId: string;
  /** Tags used for matching the featured world. Never rendered. */
  matchText: string;
  /** Opening paragraphs, articles only. Source of the pull quote. */
  paragraphs: string[];
  /** Out-of-N score for reviews that state one. */
  score: string;
}

/* ─── primitives ───────────────────────────────────────────────────────── */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

/** Milliseconds, or 0 for anything that does not parse. Never NaN. */
export function toTime(value: unknown): number {
  const s = str(value);
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function formatDisplayDate(value: unknown, timeZone: string): string {
  const t = toTime(value);
  if (!t) return '';
  try {
    return new Date(t).toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

/** "12:48" or "1:02:03". '' for missing, zero or nonsense. */
export function formatDuration(seconds: unknown): string {
  const n = Math.floor(Number(seconds));
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const WORDS_PER_MINUTE = 230;

/** "8 min read" from an HTML body. '' when there is no body to count. */
export function readTimeFromHtml(html: unknown): string {
  const text = str(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return '';
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`;
}

/** Map the stores' category spellings onto the four the homepage shows. */
export function normalizeCategory(raw: unknown): HomeCategory | null {
  const s = str(raw).toLowerCase();
  if (s === 'film' || s === 'films' || s === 'movie' || s === 'movies') return 'Film';
  if (s === 'tv' || s === 'television' || s === 'series') return 'TV';
  if (s === 'games' || s === 'game' || s === 'gaming') return 'Games';
  if (s === 'events' || s === 'event') return 'Events';
  return null;
}

/** First sentence of a YouTube description, capped. Real copy, just shorter. */
export function firstSentence(text: unknown, max = 180): string {
  const s = str(text).split(/\n/)[0] ?? '';
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (m ? m[0] : s).trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s]+$/, '') + '…';
}

/* ─── mappers ──────────────────────────────────────────────────────────── */

export interface RawArticle {
  guid?: unknown;
  slug?: unknown;
  title?: unknown;
  excerpt?: unknown;
  preview?: unknown;
  image?: unknown;
  category?: unknown;
  contentType?: unknown;
  isoDate?: unknown;
  tags?: unknown;
  bodyHtml?: unknown;
  score?: { value?: unknown; best?: unknown } | null;
}

export interface RawVideo {
  youtubeId?: unknown;
  title?: unknown;
  description?: unknown;
  thumbnail?: unknown;
  category?: unknown;
  publishedAt?: unknown;
  durationSeconds?: unknown;
  youtubeTags?: unknown;
  tags?: unknown;
  isShort?: unknown;
  isLive?: unknown;
}

export interface MapDeps {
  timeZone: string;
  articleHref: (a: RawArticle) => string;
  isExternalArticle: (a: RawArticle) => boolean;
  articleImage: (raw: string) => ImageSources;
  videoImage: (raw: string) => ImageSources;
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export function mapArticle(a: RawArticle, deps: MapDeps): HomeStory | null {
  const headline = str(a?.title);
  const url = str(deps.articleHref(a));
  if (!headline || !url) return null;
  const rawImage = str(a.image);
  const img = rawImage ? deps.articleImage(rawImage) : { src: '', srcset: '' };
  const category = normalizeCategory(a.category);
  const score =
    a.score && Number(a.score.value) > 0 && Number(a.score.best) > 0
      ? `${Number(a.score.value)}/${Number(a.score.best)}`
      : '';
  const t = toTime(a.isoDate);
  return {
    id: `article:${str(a.guid) || str(a.slug) || headline}`,
    category,
    kicker: str(a.contentType) || category || 'Intel',
    headline,
    deck: str(a.excerpt),
    image: str(img.src),
    imageSrcset: str(img.srcset),
    url,
    external: Boolean(deps.isExternalArticle(a)),
    publishDate: t ? new Date(t).toISOString() : '',
    displayDate: formatDisplayDate(a.isoDate, deps.timeZone),
    type: 'article',
    readTime: readTimeFromHtml(a.bodyHtml),
    duration: '',
    videoId: '',
    matchText: [headline, ...strList(a.tags)].join(' ').toLowerCase(),
    paragraphs: strList(a.preview),
    score,
  };
}

export function mapVideo(v: RawVideo, deps: MapDeps): HomeStory | null {
  const id = str(v?.youtubeId);
  const headline = str(v?.title);
  if (!id || !headline) return null;
  if (v.isShort === true || v.isLive === true) return null;
  const rawImage = str(v.thumbnail) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const img = deps.videoImage(rawImage);
  const t = toTime(v.publishedAt);
  return {
    id: `video:${id}`,
    category: normalizeCategory(v.category),
    kicker: 'Video',
    headline,
    deck: firstSentence(v.description),
    image: str(img.src),
    imageSrcset: str(img.srcset),
    url: `https://www.youtube.com/watch?v=${id}`,
    external: true,
    publishDate: t ? new Date(t).toISOString() : '',
    displayDate: formatDisplayDate(v.publishedAt, deps.timeZone),
    type: 'video',
    readTime: '',
    duration: formatDuration(v.durationSeconds),
    videoId: id,
    matchText: [headline, ...strList(v.youtubeTags), ...strList(v.tags)].join(' ').toLowerCase(),
    paragraphs: [],
    score: '',
  };
}

/* ─── the deal ─────────────────────────────────────────────────────────── */

export interface FeaturedWorldConfig {
  /** Display title, e.g. "Lanterns". */
  title: string;
  /** Lowercase term a story's title or tags must contain as a whole word. */
  match: string;
}

export interface HeroPanel {
  key: 'film' | 'tv' | 'games' | 'events' | 'latest';
  label: string;
  isNew: boolean;
  story: HomeStory;
}

export interface FeaturedWorld {
  title: string;
  lead: HomeStory;
  items: HomeStory[];
  /** How many pieces of coverage the world has in total, lead included. */
  total: number;
}

export interface PullQuote {
  text: string;
  story: HomeStory;
}

export interface HomepageFeed {
  hero: HeroPanel[];
  intel: { lead: HomeStory | null; orbit: HomeStory[] };
  quote: PullQuote | null;
  featured: FeaturedWorld | null;
  rail: HomeStory[];
}

const newestFirst = (a: HomeStory, b: HomeStory) => toTime(b.publishDate) - toTime(a.publishDate);

function wordMatch(haystack: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

/**
 * A pull quote: one real sentence from an article's opening paragraphs.
 * Prefers a sentence that reads as a standalone line (60-190 chars) and skips
 * any carrying an em dash, per the house style for visitor-facing copy.
 */
export function pickPullQuote(stories: HomeStory[]): PullQuote | null {
  for (const story of stories) {
    if (!story || story.type !== 'article') continue;
    for (const para of story.paragraphs) {
      const sentences = para.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
      for (const raw of sentences) {
        const text = raw.trim();
        if (text.length >= 60 && text.length <= 190 && !text.includes('—')) {
          return { text, story };
        }
      }
    }
  }
  return null;
}

export const HERO_LABELS: Record<HeroPanel['key'], string> = {
  film: 'Film',
  tv: 'TV',
  games: 'Games',
  events: 'Events',
  latest: 'Latest',
};

export function buildHomepageFeed(
  articles: HomeStory[],
  videos: HomeStory[],
  opts: { featured?: FeaturedWorldConfig | null; intelOrbit?: number; railLimit?: number } = {},
): HomepageFeed {
  const intelOrbit = opts.intelOrbit ?? 3;
  const railLimit = opts.railLimit ?? 10;

  const safeArticles = (Array.isArray(articles) ? articles : []).filter(Boolean).sort(newestFirst);
  const safeVideos = (Array.isArray(videos) ? videos : []).filter(Boolean).sort(newestFirst);
  const all = [...safeArticles, ...safeVideos].sort(newestFirst);

  const used = new Set<string>();
  const claim = (s: HomeStory | undefined | null): HomeStory | null => {
    if (!s || used.has(s.id)) return null;
    used.add(s.id);
    return s;
  };
  const free = (s: HomeStory) => !used.has(s.id);

  /* 1. Featured world — pinned by an editor, so it claims first. The lead is
        the newest ARTICLE in the world with an image (the section's backdrop
        is its art); videos fill the cards. No lead, no section. */
  let featured: FeaturedWorld | null = null;
  const cfg = opts.featured;
  if (cfg && cfg.match) {
    const inWorld = all.filter((s) => wordMatch(s.matchText, cfg.match));
    const lead = inWorld.find((s) => s.type === 'article' && s.image) ?? inWorld.find((s) => s.image);
    if (lead) {
      claim(lead);
      /* Cards: the other articles first (they are the rarer kind), then the
         newest videos, three in all. */
      const rest = inWorld.filter(free);
      const picked = [...rest.filter((s) => s.type === 'article'), ...rest.filter((s) => s.type === 'video')]
        .slice(0, 3)
        .map(claim)
        .filter((s): s is HomeStory => s !== null)
        .sort(newestFirst);
      featured = { title: cfg.title, lead, items: picked, total: inWorld.length };
    }
  }

  /* 2. Hero. LATEST is the newest story left in the pool, so it is always
        true to its label; each category then takes its newest remaining
        story with art. A category with nothing to show drops its panel
        rather than rendering an empty one. */
  const withArt = (s: HomeStory) => Boolean(s.image);
  const latest = claim(all.find((s) => free(s) && withArt(s)));
  const hero: HeroPanel[] = [];
  const catKey: Record<HomeCategory, HeroPanel['key']> = { Film: 'film', TV: 'tv', Games: 'games', Events: 'events' };
  for (const cat of HOME_CATEGORIES) {
    /* Articles lead a category when one exists: the hero is editorial. */
    const pick =
      safeArticles.find((s) => free(s) && withArt(s) && s.category === cat) ??
      safeVideos.find((s) => free(s) && withArt(s) && s.category === cat);
    const story = claim(pick);
    if (story) hero.push({ key: catKey[cat], label: HERO_LABELS[catKey[cat]], isNew: false, story });
  }
  if (latest) hero.push({ key: 'latest', label: HERO_LABELS.latest, isNew: true, story: latest });

  /* 3. Intel — the written side, articles only. */
  const intelPool = safeArticles.filter(free);
  const intelLead = claim(intelPool.find(withArt) ?? intelPool[0]);
  const orbit = safeArticles
    .filter(free)
    .slice(0, intelOrbit)
    .map(claim)
    .filter((s): s is HomeStory => s !== null);

  /* 4. The pull quote between Intel and Featured leads INTO the featured
        world when it can, and otherwise quotes the Intel lead. It does not
        claim: quoting a story shown elsewhere is the point of a pull quote. */
  const quote = pickPullQuote([featured?.lead, intelLead, ...safeArticles].filter(Boolean) as HomeStory[]);

  /* 5. The rail — long-form video, newest first. */
  const rail = safeVideos
    .filter(free)
    .slice(0, railLimit)
    .map(claim)
    .filter((s): s is HomeStory => s !== null);

  return { hero, intel: { lead: intelLead, orbit }, quote, featured, rail };
}
