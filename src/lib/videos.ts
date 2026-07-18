/**
 * Video read-path: Sanity `video` documents → the shape pages already render.
 * (Frontend Video Migration, Phase A — #21.)
 *
 * Today every page renders videos from the legacy RSS/scrape cache
 * (src/data/feeds.js → src/data/cache/videos.json), and the Sanity `video`
 * documents written by scripts/sync-youtube.mjs are read by nothing. This
 * module is the bridge: it maps Sanity docs into the EXACT legacy cache shape
 * (title/link/thumbnail/category/date/isUpload) so pages can switch sources
 * without markup changes, and merges the two sources so the cutover can be
 * gradual.
 *
 * Adoption plan (Phase B, after the first live sync populates the dataset):
 *   1. Pages call getUnifiedVideos(sanityClient, getVideos()) instead of
 *      getVideos() — Sanity docs win, legacy fills the gaps.
 *   2. Once coverage is complete, drop the legacy argument and deprecate
 *      fetchVideos* in content-source.js (articles keep their RSS path).
 *
 * Editorial gate: only contentStatus == "published" docs are surfaced, so
 * ingesting the whole channel never floods the site — editors promote videos
 * deliberately.
 */
import { parseVideoId } from './platforms/youtube.ts';

/** The legacy cache entry shape every page currently renders. */
export interface LegacyVideo {
  title: string;
  link: string;
  thumbnail: string;
  category: string;
  date: string;
  isUpload: boolean;
}

/** Sanity-sourced entries keep the legacy shape and add richer fields. */
export interface UnifiedVideo extends LegacyVideo {
  youtubeId?: string;
  durationSeconds?: number;
  featured?: boolean;
  /** Raw ISO publish timestamp (Sanity only) — the Dispatch Log needs a real
   *  instant, not the display-string `date`. Absent on legacy-cache entries. */
  publishedAt?: string;
  /** Marks which pipeline produced the entry — useful during the cutover. */
  source: 'sanity' | 'legacy';
}

/** Published videos, newest first. Kept minimal: pages do their own slicing. */
export const PUBLISHED_VIDEOS_QUERY = `*[_type == "video" && contentStatus == "published"] | order(publishedAt desc) {
  youtubeId, title, thumbnailUrl, durationSeconds, isShort, publishedAt,
  "topics": topics[]->slug.current, featured
}`;

/** The four site categories; topics outside this set fall through. */
const SITE_CATEGORIES: Record<string, string> = {
  film: 'Film',
  tv: 'TV',
  gaming: 'Gaming',
  events: 'Events',
};

export interface MapOptions {
  /**
   * Fallback categorizer for docs whose editorial topics don't name a site
   * category — Phase B can pass content-source.js's categorize() to keep
   * today's behavior exactly. Defaults to 'General'.
   */
  categorize?: (text: string) => string;
}

/**
 * Map one Sanity `video` doc to the page-facing shape. Editorial topics win
 * over any heuristic: an editor tagging "gaming" beats title-regex guessing.
 */
export function mapSanityVideo(doc: any, { categorize }: MapOptions = {}): UnifiedVideo | null {
  const id: string | null = doc?.youtubeId ?? null;
  if (!id || !doc?.title) return null;

  const topicMatch = (doc.topics ?? [])
    .map((t: unknown) => SITE_CATEGORIES[String(t).toLowerCase()])
    .find(Boolean);

  const published = doc.publishedAt ? new Date(doc.publishedAt) : null;
  const date =
    published && !Number.isNaN(published.getTime())
      ? // Same long form the legacy cache stores ("July 12, 2026").
        published.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '';

  return {
    title: doc.title,
    // Shorts keep the /shorts/ URL form, matching the legacy cache.
    link: doc.isShort
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`,
    thumbnail: doc.thumbnailUrl || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    category: topicMatch ?? categorize?.(doc.title) ?? 'General',
    date,
    // Legacy semantics: isUpload=true means long-form; Shorts are false.
    isUpload: !doc.isShort,
    youtubeId: id,
    durationSeconds: doc.durationSeconds,
    featured: doc.featured ?? false,
    publishedAt: doc.publishedAt ?? undefined,
    source: 'sanity',
  };
}

/**
 * Merge Sanity-sourced videos with the legacy cache, deduped by video id —
 * Sanity wins because it carries editorial curation. Order: Sanity entries
 * first (already newest-first from GROQ), then unmatched legacy entries in
 * their cache order. Pages that need a strict date sort keep doing their own
 * sort, same as today.
 */
export function mergeVideoSources(
  sanityVideos: UnifiedVideo[],
  legacyVideos: LegacyVideo[],
): UnifiedVideo[] {
  const seen = new Set(sanityVideos.map((v) => v.youtubeId).filter(Boolean));
  const legacyOnly: UnifiedVideo[] = [];
  for (const v of legacyVideos) {
    const id = parseVideoId(v.link);
    if (id && seen.has(id)) continue;
    legacyOnly.push({ ...v, youtubeId: id ?? undefined, source: 'legacy' });
  }
  return [...sanityVideos, ...legacyOnly];
}

/**
 * Phase-B entry point: Sanity-primary with legacy fallback. A Sanity failure
 * (network, auth, empty project) degrades to the legacy list — never a crash,
 * mirroring how pages already try/catch their Sanity fetches.
 */
export async function getUnifiedVideos(
  client: { fetch: (query: string) => Promise<any[]> },
  legacyVideos: LegacyVideo[] = [],
  options: MapOptions = {},
): Promise<UnifiedVideo[]> {
  let sanityVideos: UnifiedVideo[] = [];
  try {
    const docs = (await client.fetch(PUBLISHED_VIDEOS_QUERY)) ?? [];
    sanityVideos = docs
      .map((d) => mapSanityVideo(d, options))
      .filter((v): v is UnifiedVideo => v !== null);
  } catch (e) {
    console.error('[videos] Sanity fetch failed; serving legacy cache only', e);
  }
  return mergeVideoSources(sanityVideos, legacyVideos);
}
