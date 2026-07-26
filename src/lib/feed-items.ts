/**
 * Shared item-shaping for the feed routes.
 *
 * Every feed surface previously rebuilt this merge/normalise/sort inline —
 * and twice per file, since `getStaticPaths()` runs in its own isolated scope
 * and cannot see frontmatter helpers. Keeping it here means the feed's notion
 * of "an item" is defined once.
 *
 * The shape is deliberately generic — `{ title, link, date, image, category }`
 * plus a `type` discriminator — which is why articles already slot into the
 * same <ContentCard /> as videos with no visual variant.
 */
import { getArticles } from '../data/feeds.js';
import { getVideosUnified } from './videos-source.ts';

export interface FeedItem {
  title: string;
  link: string;
  date: string;
  image?: string;
  category?: string;
  tags?: string[];
  type: 'article' | 'video';
  [key: string]: any;
}

/** Newest first. Items with unparseable dates sort last rather than throwing. */
function byNewest(a: FeedItem, b: FeedItem) {
  const at = new Date(a.date).getTime();
  const bt = new Date(b.date).getTime();
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

export function getArticleItems(): FeedItem[] {
  return getArticles()
    .map((a: any) => ({ ...a, type: 'article' as const }))
    .sort(byNewest);
}

export async function getVideoItems(): Promise<FeedItem[]> {
  const videos = await getVideosUnified();
  return videos
    .map((v: any) => ({ ...v, type: 'video' as const, image: v.thumbnail }))
    .sort(byNewest);
}

/** Articles and videos interleaved by date — the main `/feed`. */
export async function getAllFeedItems(): Promise<FeedItem[]> {
  const [articles, videos] = [getArticleItems(), await getVideoItems()];
  return [...articles, ...videos].sort(byNewest);
}
