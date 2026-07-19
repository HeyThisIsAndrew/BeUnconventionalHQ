/**
 * Video read-path: Sanity `video` documents → the shape pages already render.
 *
 * This module fetches UnifiedVideo directly from Sanity.
 * The legacy caching system has been completely removed to ensure all videos
 * strictly adhere to the network-verified `isShort` tagging system.
 *
 * Editorial gate: only contentStatus == "published" docs are surfaced, so
 * ingesting the whole channel never floods the site — editors promote videos
 * deliberately.
 */

/** Sanity-sourced entries. */
export interface UnifiedVideo {
  title: string;
  link: string;
  thumbnail: string;
  category: string;
  tags?: string[];
  youtubeTags?: string[];
  date: string;
  isShort: boolean;
  isLive: boolean;
  isEvent: boolean;
  contentType: 'video';
  youtubeId?: string;
  durationSeconds?: number;
  featured?: boolean;
  /** Raw ISO publish timestamp (Sanity only) — the Dispatch Log needs a real
   *  instant, not the display-string `date`. */
  publishedAt?: string;
  /** Marks which pipeline produced the entry. */
  source: 'sanity';
}

/** Published queries. Kept minimal: pages do their own slicing. */
export function buildPublishedQuery(docType: string = 'video') {
  return `*[_type == "${docType}" && contentStatus == "published"] | order(publishedAt desc) {
    youtubeId, title, thumbnailUrl, durationSeconds, isShort, isLive, isEvent, publishedAt,
    youtubeTags, "topics": topics[]->slug.current, featured
  }`;
}

/** The four site categories; topics outside this set fall through. */
const SITE_CATEGORIES: Record<string, string> = {
  film: 'Film',
  tv: 'TV',
  gaming: 'Gaming',
};

export interface MapOptions {
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
    link: doc.isShort
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`,
    thumbnail: doc.thumbnailUrl || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    category: topicMatch ?? categorize?.(doc.title) ?? 'General',
    tags: (doc.topics ?? []).map(String),
    youtubeTags: doc.youtubeTags ?? [],
    date,
    isShort: doc.isShort ?? false,
    isLive: doc.isLive ?? false,
    isEvent: doc.isEvent ?? false,
    contentType: 'video',
    youtubeId: id,
    durationSeconds: doc.durationSeconds,
    featured: doc.featured ?? false,
    publishedAt: doc.publishedAt ?? undefined,
    source: 'sanity',
  };
}

/**
 * Entry point: Sanity-only fetch. 
 */
export async function getUnifiedVideos(
  client: { fetch: (query: string) => Promise<any[]> },
  options: MapOptions = {},
  query: string = buildPublishedQuery('video'),
): Promise<UnifiedVideo[]> {
  try {
    const docs = (await client.fetch(query)) ?? [];
    return docs
      .map((d) => mapSanityVideo(d, options))
      .filter((v): v is UnifiedVideo => v !== null);
  } catch (e) {
    console.error('[videos] Sanity fetch failed.', e);
    return [];
  }
}
