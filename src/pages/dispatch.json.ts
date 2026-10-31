/**
 * JSON twin of /dispatch.xml (issue #273). Read through service bindings by
 * the social distribution Worker (social-blast-worker/, issue #282) and the
 * Kit draft Worker (dispatch-kit-worker/, issue #272); readers never see it.
 * Same selection, same images, same order as the RSS route, because both go
 * through selectDispatchEntries(). Item shape: dispatchJsonItem() in
 * src/lib/dispatch-feed.ts.
 *
 * Each item also carries its newsletter story boxes, rendered here at build
 * time from email/hq-dispatch/post-template.liquid.html, so the Kit Worker
 * only ever joins them (src/lib/dispatch-boxes.ts explains how).
 */
import { getPublishedArticles, RESERVED_SLUGS } from '../lib/articles.ts';
import { getVideosUnified } from '../lib/videos-source.ts';
import {
  selectDispatchEntries,
  dispatchImageUrl,
  dispatchJsonItem,
  dispatchKitPost,
  type DispatchImageManifest,
} from '../lib/dispatch-feed.ts';
import { createBoxRenderer } from '../lib/dispatch-boxes.ts';
import postTemplate from '../../email/hq-dispatch/post-template.liquid.html?raw';
import manifest from '../data/dispatch-images.json';
import { site } from '../data/site.js';

export async function GET(context: { site?: URL | string }) {
  const siteUrl = context.site?.toString() ?? site.url;

  /* Same eligibility as dispatch.xml.ts (and rss.xml.ts before it). */
  const articles = getPublishedArticles().filter((post) => !RESERVED_SLUGS.has(post.slug));
  const videos = await getVideosUnified();
  const entries = selectDispatchEntries(articles, videos, siteUrl);
  const images = manifest as DispatchImageManifest;
  const renderer = createBoxRenderer(postTemplate);

  const items = [];
  for (const entry of entries) {
    const imageUrl = dispatchImageUrl(entry, images, siteUrl);
    items.push({ ...dispatchJsonItem(entry, imageUrl), ...(await renderer.boxes(dispatchKitPost(entry, imageUrl))) });
  }
  const body = { version: 1, latestHeadingHtml: await renderer.latestHeading(), items };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
