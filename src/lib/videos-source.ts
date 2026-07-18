/**
 * The one place pages get their video list (Frontend Video Migration Phase B).
 *
 * Wires the pure merge logic in ./videos.ts to the app's real sources:
 * Sanity-primary, legacy-cache fallback. With the video dataset still empty
 * (or Sanity unreachable) this returns exactly the legacy cache list — pages
 * render byte-identical to the pre-migration site. The day the sync runs and
 * docs are published, curated Sanity entries take over automatically, with no
 * further code changes.
 *
 * categorize() keeps legacy entries' behavior identical; Sanity entries only
 * consult it when their editorial topics don't name a site category.
 */
// @ts-ignore - sanity:client is a virtual module resolved by @sanity/astro
import { sanityClient } from 'sanity:client';
// @ts-ignore - untyped JS modules
import { categorize } from '../data/content-source.js';
import { getUnifiedVideos, buildPublishedQuery, type UnifiedVideo } from './videos.ts';

export async function getVideosUnified(): Promise<UnifiedVideo[]> {
  const query = `*[_type == "video" && contentStatus == "published" && !(_id in path("shorts.*")) && !(_id in path("live.*"))] | order(publishedAt desc) {
    youtubeId, title, thumbnailUrl, durationSeconds, isShort, isLive, isEvent, publishedAt,
    youtubeTags, "topics": topics[]->slug.current, featured
  }`;
  return await getUnifiedVideos(sanityClient, { categorize }, query);
}

export async function getShortsUnified(): Promise<UnifiedVideo[]> {
  return await getUnifiedVideos(sanityClient, { categorize }, buildPublishedQuery('short'));
}

export async function getLiveStreamsUnified(): Promise<UnifiedVideo[]> {
  return await getUnifiedVideos(sanityClient, { categorize }, buildPublishedQuery('live'));
}
