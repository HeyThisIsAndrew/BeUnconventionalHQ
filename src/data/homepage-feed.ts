/**
 * THE homepage's single source of content.
 *
 * Every homepage section reads from `getHomepageFeed()`. Nothing on the page
 * types a headline, deck or date of its own: they all come from
 * src/data/articles.json and src/data/videos.json through the mappers in
 * src/lib/homepage-feed.ts, which is where the shaping and the dealing live
 * (and where scripts/homepage-feed.test.mjs tests them).
 *
 * This file is only the binding to the real stores. (Featured is dealt
 * separately and reserved first: src/data/homepage-featured.ts.)
 */
import { getAllArticles, getPublishedArticles, articleHref, isExternalArticle, type ArticleRecord } from '../lib/articles';
import { pickFeaturedHighlights } from '../lib/featured-highlights';
import { getVideosUnified } from '../lib/videos-source';
import { getEventsLocal } from '../lib/local-content';
import { findEventForArticle } from '../lib/hub-coverage';
import { localArticleImage } from '../lib/article-images';
import { getCardImageSources } from '../lib/card-images';
import { PUBLISH_TIME_ZONE } from '../lib/publish-timezone.js';
import {
  buildHomepageFeed,
  firstPartyHeroSrcset,
  mapArticle,
  mapVideo,
  type HeroPanel,
  type HomepageFeed,
  type HomeStory,
  type MapDeps,
  type RawArticle,
} from '../lib/homepage-feed';

const deps: MapDeps = {
  timeZone: PUBLISH_TIME_ZONE,
  articleHref: (a) => articleHref(a as ArticleRecord),
  isExternalArticle: (a) => isExternalArticle(a as ArticleRecord),
  /* Committed renditions first (the article path's rule, see
     lib/article-images.ts), the card proxy ladder otherwise. */
  articleImage: (raw) => localArticleImage(raw) ?? getCardImageSources(raw),
  videoImage: (raw) => getCardImageSources(raw),
};

const cache = new Map<string, Promise<HomepageFeed>>();

export function getHomepageFeed(reservedKeys: ReadonlySet<string> = new Set()): Promise<HomepageFeed> {
  const reserved = new Set(reservedKeys);
  const key = JSON.stringify([...reserved].sort());
  const cached = cache.get(key);
  if (cached) return cached;
  const result = (async () => {
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
    /* The hero's category panels open on the production Featured
       Highlights mix. Ids in HomeStory's own format (see mapArticle /
       mapVideo), so the builder can match them without the raw records. */
    let heroPicks: string[] = [];
    try {
      heroPicks = pickFeaturedHighlights(await getVideosUnified(), getPublishedArticles(), (a) => articleHref(a))
        .map((item: any) => (item.youtubeId ? `video:${item.youtubeId}` : `article:${item.guid || item.slug || item.title}`));
    } catch (err) {
      console.error('[homepage-feed] highlight picks unavailable:', err);
    }
    /* No `featured` world here: the Featured section uses its own CMS setting (src/data/homepage-featured.ts), reserved before the
       hero by the page. */
    const feed = buildHomepageFeed(articles, videos, { heroPicks, reservedKeys: reserved });
    /* The hero's art (the page's LCP image) comes from our own origin; see
       firstPartyHeroSrcset(). Copies, so no other section's story changes. */
    /* A hero panel showing an article that is coverage of an event opens
       that event's hub: the tile is a way into the event, and the article
       is one tap further, in its COVERAGE grid. findEventForArticle() is
       the event page's own matcher run backwards, so the hub always lists
       the story the tile showed. Videos keep playing in place. */
    const events = getEventsLocal();
    let rawByUrl = new Map<string, ArticleRecord>();
    try {
      rawByUrl = new Map(getAllArticles().map((a) => [articleHref(a), a]));
    } catch {
      /* Articles already failed above and logged; no panel is an article. */
    }
    const eventFor = (story: HomeStory): HeroPanel['event'] => {
      if (story.type !== 'article' || story.external) return undefined;
      const event = findEventForArticle(rawByUrl.get(story.url), events);
      const slug = event?.slug?.current;
      return slug ? { href: `/events/${slug}`, title: String(event.title ?? '') } : undefined;
    };
    return {
      ...feed,
      hero: feed.hero.map((panel) => {
        const event = eventFor(panel.story);
        return {
          ...panel,
          ...(event ? { event } : {}),
          story: { ...panel.story, imageSrcset: firstPartyHeroSrcset(panel.story.imageSrcset) },
        };
      }),
    };
  })();
  cache.set(key, result);
  return result;
}

export type { HomeStory, HomepageFeed };
