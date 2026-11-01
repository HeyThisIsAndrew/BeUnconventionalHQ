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
import { buildImageSet, getEventsLocal } from '../lib/local-content';
import { formatEventDateRange, formatLocation, getEventTypeLabel } from '../lib/events';
import { heroLiveEventCandidates } from '../lib/hero-live-event';
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

/*
  An event as a hero tile: the event's own name, art and dates, linking to its
  event page. Only ever offered to the Events tile, and only shown there by the
  browser while the event is live (src/lib/hero-live-event.ts).

  The art is the event's key art at its NATIVE aspect (buildImageSet with no
  `aspect`): cropping it to 16:9 at the CDN would cut the name off wide
  banners like L.A. Comic Con's 2.35:1, and the panel's own `cover` already
  frames it. Widths reach 1600 so the open panel is covered at 2x.
*/
const EVENT_TILE_WIDTHS = [400, 800, 1200, 1600];
function eventTileStory(event: any): HomeStory {
  const slug = event.slug.current;
  const art = buildImageSet(event.heroImage, { widths: EVENT_TILE_WIDTHS });
  /* The description's first sentence, if it is short and clean; the place
     otherwise. Never an em dash (house style, and the QA sweep checks it). */
  const first = String(event.description ?? '').match(/^[^.!?]+[.!?]/)?.[0]?.trim() ?? '';
  const deck = first && first.length <= 200 && !first.includes('\u2014') ? first : formatLocation(event.location);
  return {
    id: `event:${slug}`,
    category: 'Events',
    kicker: 'Live now',
    brand: getEventTypeLabel(event),
    headline: String(event.title ?? ''),
    deck,
    image: art?.src ?? '',
    imageSrcset: art?.srcset ?? '',
    url: `/events/${slug}`,
    external: false,
    publishDate: '',
    displayDate: formatEventDateRange(event.startDate, event.endDate),
    type: 'article',
    readTime: '',
    duration: '',
    videoId: '',
    matchText: '',
    paragraphs: [],
    score: '',
    ctaLabel: 'Explore Event',
  };
}

/** The Events tile's live-event candidates for a page built now. */
function liveEventTiles(): NonNullable<HeroPanel['liveEvents']> {
  try {
    return heroLiveEventCandidates(getEventsLocal())
      .filter(({ event }) => event.heroImage)
      .map(({ event, window }) => ({ start: window.start, end: window.end, story: eventTileStory(event) }));
  } catch (err) {
    console.error('[homepage-feed] live events unavailable:', err);
    return [];
  }
}

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
    /* The Events tile ALONE carries live-event candidates. Its `story` stays
       the article: that is the default, and what shows without JS. */
    const liveEvents = liveEventTiles();
    return {
      ...feed,
      hero: feed.hero.map((panel) => ({
        ...panel,
        ...(panel.key === 'events' && liveEvents.length ? { liveEvents } : {}),
        story: { ...panel.story, imageSrcset: firstPartyHeroSrcset(panel.story.imageSrcset) },
      })),
    };
  })();
  cache.set(key, result);
  return result;
}

export type { HomeStory, HomepageFeed };
