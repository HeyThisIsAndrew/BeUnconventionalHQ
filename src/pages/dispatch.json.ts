/**
 * JSON twin of /dispatch.xml (issue #273). Read by the social distribution
 * Worker (workers/social-blast, issue #282) through its service binding;
 * readers never see it. Same selection, same images, same order as the RSS
 * route, because both go through selectDispatchEntries(). Item shape:
 * dispatchJsonItem() in src/lib/dispatch-feed.ts.
 */
import { getPublishedArticles, RESERVED_SLUGS } from '../lib/articles.ts';
import { getVideosUnified } from '../lib/videos-source.ts';
import {
  selectDispatchEntries,
  dispatchImageUrl,
  dispatchJsonItem,
  type DispatchImageManifest,
} from '../lib/dispatch-feed.ts';
import manifest from '../data/dispatch-images.json';
import { site } from '../data/site.js';

export async function GET(context: { site?: URL | string }) {
  const siteUrl = context.site?.toString() ?? site.url;

  /* Same eligibility as dispatch.xml.ts (and rss.xml.ts before it). */
  const articles = getPublishedArticles().filter((post) => !RESERVED_SLUGS.has(post.slug));
  const videos = await getVideosUnified();
  const entries = selectDispatchEntries(articles, videos, siteUrl);
  const images = manifest as DispatchImageManifest;

  const body = {
    version: 1,
    items: entries.map((entry) => dispatchJsonItem(entry, dispatchImageUrl(entry, images, siteUrl))),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
