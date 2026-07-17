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
import { getVideos } from '../data/feeds.js';
// @ts-ignore - untyped JS modules
import { categorize } from '../data/content-source.js';
import { getUnifiedVideos, type UnifiedVideo } from './videos.ts';

export async function getVideosUnified(): Promise<UnifiedVideo[]> {
  return getUnifiedVideos(sanityClient, getVideos(), { categorize });
}
