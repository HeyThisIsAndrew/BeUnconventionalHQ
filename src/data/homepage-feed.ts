/**
 * THE homepage's single source of content.
 *
 * Every homepage section reads from `getHomepageFeed()`. Nothing on the page
 * types a headline, deck or date of its own: they all come from
 * src/data/articles.json and src/data/videos.json through the mappers in
 * src/lib/homepage-feed.ts, which is where the shaping and the dealing live
 * (and where scripts/homepage-feed.test.mjs tests them).
 *
 * This file is only the binding to the real stores, plus the one editorial
 * choice the page makes: which story world the Featured section spotlights.
 */
import { getAllArticles, articleHref, isExternalArticle, type ArticleRecord } from '../lib/articles';
import { getVideosUnified } from '../lib/videos-source';
import { localArticleImage } from '../lib/article-images';
import { getCardImageSources } from '../lib/card-images';
import { PUBLISH_TIME_ZONE } from '../lib/publish-timezone.js';
import {
  buildHomepageFeed,
  mapArticle,
  mapVideo,
  type FeaturedWorldConfig,
  type HomepageFeed,
  type HomeStory,
  type MapDeps,
  type RawArticle,
} from '../lib/homepage-feed';

/**
 * The Featured section's story world. Change `match` (a whole word found in
 * a story's title or tags) and `title` to spotlight a different campaign.
 * If nothing matches, the section simply does not render.
 */
export const FEATURED_WORLD: FeaturedWorldConfig = {
  title: 'Lanterns',
  match: 'lanterns',
};

const deps: MapDeps = {
  timeZone: PUBLISH_TIME_ZONE,
  articleHref: (a) => articleHref(a as ArticleRecord),
  isExternalArticle: (a) => isExternalArticle(a as ArticleRecord),
  /* Committed renditions first (the article path's rule, see
     lib/article-images.ts), the card proxy ladder otherwise. */
  articleImage: (raw) => localArticleImage(raw) ?? getCardImageSources(raw),
  videoImage: (raw) => getCardImageSources(raw),
};

let cached: Promise<HomepageFeed> | null = null;

export function getHomepageFeed(): Promise<HomepageFeed> {
  cached ??= (async () => {
    let articles: HomeStory[] = [];
    let videos: HomeStory[] = [];
    try {
      articles = getAllArticles()
        .map((a) => mapArticle(a as unknown as RawArticle, deps))
        .filter((s): s is HomeStory => s !== null);
    } catch (err) {
      console.error('[homepage-feed] articles unavailable:', err);
    }
    try {
      videos = (await getVideosUnified())
        .map((v) => mapVideo(v, deps))
        .filter((s): s is HomeStory => s !== null);
    } catch (err) {
      console.error('[homepage-feed] videos unavailable:', err);
    }
    return buildHomepageFeed(articles, videos, { featured: FEATURED_WORLD });
  })();
  return cached;
}

export type { HomeStory, HomepageFeed };
