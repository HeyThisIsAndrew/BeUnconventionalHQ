/**
 * ONE matcher for "what coverage belongs to this hub", shared by the two page
 * types that ask the question: /featured/[slug] (a featuredBrand) and
 * /events/[slug] (an event).
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * The two pages answered it differently, and only one of them worked.
 *
 *   /featured/[slug]  exact match on NORMALIZED tags (article.tags,
 *                     article.category, video.youtubeTags, video.tags)
 *   /events/[slug]    substring match on article.title / article.excerpt
 *                     and video.title / video.description
 *
 * Substring matching is the leaky one: an event keyed "d23 2026" would claim
 * any article whose body happened to contain that run of characters, and,
 * far worse in practice, claimed nothing at all. Measured against the
 * shipped store, the event-page matcher returned ZERO articles for all 19
 * events, because it was searching prose for strings like "sdcc-2026" and
 * "paxwest26" that only ever appear as YouTube metadata.
 *
 * ─── WHY EVENTS NEED coverageTags AND BRANDS DO NOT ────────────────────────
 * Both document types already carry `youtubeSyncKeywords`, but they carry
 * very different things in it, because that field has one job: matching
 * YouTube tags during the sync (CLAUDE.md hard rule 5).
 *
 *   featuredBrand  ["marvel", "mcu", "marvel studios"]   <- brand names,
 *                  which are also what a writer tags an article with, so
 *                  brand hubs match articles by accident of vocabulary.
 *   event          ["sdcc 2026", "sdcc-2026", "sdcc2026"] <- year-scoped
 *                  sync tokens. No human tags an article "sdcc2026".
 *
 * Widening `youtubeSyncKeywords` to fix this would be actively wrong: those
 * keywords also drive `extractHubSeeds()` in scripts/sync-youtube.mjs, so
 * adding "marvel studios" to the Doomsday premiere would hub-tag every
 * Marvel video on the channel to one red-carpet night.
 *
 * `coverageTags` is therefore a separate, purely EDITORIAL field, read here
 * and nowhere else. The sync never writes it and never reads it.
 */

export type CoverageItem = Record<string, any> & { contentType: 'article' | 'video' };

/**
 * Tag comparison is case- and punctuation-insensitive but NOT fuzzy:
 * "Marvel Studios", "marvel studios" and "Marvel-Studios" are the same tag,
 * "marvel" is a different one. Substring containment is deliberately not a
 * match — see the header.
 */
export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The tag vocabulary a hub document matches content against: its editorial
 * `coverageTags` first, then its `youtubeSyncKeywords`. Both are optional and
 * either may be missing, a non-array, or contain non-strings — hub documents
 * are hand-edited through the local CMS.
 */
export function getHubMatchTags(hub: any): string[] {
  const raw = [
    ...(Array.isArray(hub?.coverageTags) ? hub.coverageTags : []),
    ...(Array.isArray(hub?.youtubeSyncKeywords) ? hub.youtubeSyncKeywords : []),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** True when any of `candidates` normalizes to a tag in `tags`. */
function hasAnyTag(candidates: unknown[], tags: string[]): boolean {
  for (const candidate of candidates) {
    const normalized = normalizeTag(candidate);
    if (normalized && tags.includes(normalized)) return true;
  }
  return false;
}

export function matchArticlesByTags(articles: any[], tags: string[]): any[] {
  if (!tags.length) return [];
  return (articles ?? []).filter((article) =>
    hasAnyTag([...(article?.tags ?? []), article?.category], tags)
  );
}

export function matchVideosByTags(videos: any[], tags: string[]): any[] {
  if (!tags.length) return [];
  return (videos ?? []).filter((video) =>
    hasAnyTag([...(video?.youtubeTags ?? []), ...(video?.tags ?? []), video?.category], tags)
  );
}

/** Newest first, tolerating both the article (`date`) and video (`publishedAt`) field. */
export function coverageTimestamp(item: any): number {
  const value = item?.date ?? item?.publishedAt ?? item?.isoDate ?? 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export interface CoverageInput {
  hub: any;
  videos: any[];
  articles: any[];
}

export interface CoverageResult {
  items: CoverageItem[];
  articleCount: number;
  videoCount: number;
  /** Both kinds present, so an ARTICLES/VIDEOS filter has something to do. */
  showFilters: boolean;
}

/**
 * Videos come from hub tagging first (`video.hubs` contains the hub slug —
 * deterministic and editor-controlled) and fall back to tag matching only
 * when nothing is hub-tagged yet. Articles have no `hubs` field at all (they
 * sync from Substack, which knows nothing about this site's hubs), so they
 * are always tag-matched.
 *
 * Shorts and live streams are excluded by the CALLER, by not passing them in.
 * Both page types now pass long-form video only: a hub page always did, an
 * event page used to merge shorts and live in, and one of the two had to
 * give. The coverage grid is the long-form reading list; shorts have their
 * own surfaces.
 */
export function collectHubCoverage({ hub, videos, articles }: CoverageInput): CoverageResult {
  const slug = hub?.slug?.current;
  const tags = getHubMatchTags(hub);

  const hubTagged = (videos ?? [])
    .filter((v: any) => slug && Array.isArray(v?.hubs) && v.hubs.includes(slug));

  const matchedVideos = hubTagged.length > 0 ? hubTagged : matchVideosByTags(videos ?? [], tags);
  const matchedArticles = matchArticlesByTags(articles ?? [], tags);

  const items: CoverageItem[] = [
    ...matchedArticles.map((a: any) => ({ ...a, contentType: 'article' as const })),
    ...matchedVideos.map((v: any) => ({ ...v, contentType: 'video' as const })),
  ].sort((a, b) => coverageTimestamp(b) - coverageTimestamp(a));

  return {
    items,
    articleCount: matchedArticles.length,
    videoCount: matchedVideos.length,
    showFilters: matchedArticles.length > 0 && matchedVideos.length > 0,
  };
}

/**
 * How many coverage tiles a hub or event page shows before the rest moves to
 * its own paginated feed. Six, to match the "Past Event Archive" cap on
 * /events — the same display-cap-plus-overflow-route pattern, so the site
 * behaves the same way everywhere it has more than it wants to show.
 */
export const COVERAGE_PAGE_LIMIT = 6;

/** Page size for the overflow feed. 12 matches /intel, /feed and /events/archive. */
export const COVERAGE_FEED_PAGE_SIZE = 12;
