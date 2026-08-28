import { getVideosUnified } from '../../lib/videos-source';
import { getArticleItems } from '../../lib/feed-items';
import { getEventsLocal, getFeaturedBrandsLocal, urlFor } from '../../lib/local-content';
import { parseVideoId } from '../../lib/platforms/youtube';

export const prerender = true;

/**
 * One row of the palette's index.
 *
 * `date` is OPTIONAL and that is the point. Videos and articles are dated
 * content and sort by it. Hubs and section pages are places, not posts: they
 * were stamped with `new Date()` (the build time), which floated all 18 hubs
 * above every real article and made the palette open on nothing but hubs.
 * Undated rows sort last here and the default view curates a mix instead.
 */
interface SearchEntry {
  id: string;
  title: string;
  type: 'video' | 'article' | 'event' | 'hub' | 'page';
  url: string;
  image?: string | null;
  date?: string | null;
  tags?: string[];
}

export async function GET() {
  const videos = await getVideosUnified();
  const articles = getArticleItems();
  const events = getEventsLocal();
  const hubs = getFeaturedBrandsLocal();

  const resolveImage = (ref: any) => {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    try {
      return urlFor(ref).width(200).auto('format').url();
    } catch {
      return null;
    }
  };

  /* Undated for the same reason as hubs: a section index is a place, not a
     post, and stamping it with the build time floated it above real content. */
  const pages: SearchEntry[] = [
    { id: 'intel', title: 'Intel', type: 'page', url: '/intel' },
    { id: 'featured', title: 'Featured Hubs', type: 'page', url: '/featured' },
    { id: 'events', title: 'Events', type: 'page', url: '/events' },
    { id: 'media-kit', title: 'Media Kit', type: 'page', url: '/media-kit' },
  ];

  const entries: SearchEntry[] = [
    ...videos.map((v: any): SearchEntry => ({
      id: v.id,
      title: v.title,
      type: 'video',
      url: v.link || '#',
      image: v.thumbnail || v.image || (v.link && parseVideoId(v.link) ? `https://i.ytimg.com/vi/${parseVideoId(v.link)}/mqdefault.jpg` : null),
      date: v.publishedAt || v.date,
      tags: [...(v.tags || []), ...(v.hubs || [])].filter(Boolean)
    })),
    ...articles.map((a: any): SearchEntry => ({
      id: a.slug,
      title: a.title,
      type: 'article',
      url: a.link || `/intel/${a.slug}`,
      image: a.thumbnail || a.image,
      date: a.date,
      tags: a.tags || []
    })),
    ...events.map((e: any): SearchEntry => ({
      id: e.slug?.current || e._id,
      title: e.title,
      type: 'event',
      url: `/events/${e.slug?.current}`,
      image: resolveImage(e.heroImage),
      date: e.startDate,
      tags: []
    })),
    ...hubs.map((h: any): SearchEntry => ({
      id: h.slug?.current || h._id,
      title: `${h.title} Hub`,
      type: 'hub',
      url: `/featured/${h.slug?.current}`,
      image: resolveImage(h.logo || h.heroImage),
      /*
        NO DATE. Hubs were stamped `new Date()`, i.e. the build time, so all 18
        of them sorted above every article and video and the palette's default
        view was nothing but hubs. A hub is not dated content; it is a place.
        The default view curates a mix instead of taking the top of this sort.
      */
      tags: h.youtubeSyncKeywords || []
    })),
    ...pages
  ];

  /*
    Annotated on the literal above rather than on this chain: a type on the
    result of `.filter().sort()` does not flow backwards into the sort
    callback's parameters, so `a.date` would be checked against the inferred
    union instead — and that union has no `date` on the undated rows.

    Undated rows (hubs, section pages) fall to 0 and sort last. That is
    correct: they are places, not posts, and the palette's default view picks
    a mix rather than reading off the top of this sort.
  */
  const index = entries
    .filter((item) => item.title && item.url)
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

  return new Response(JSON.stringify(index), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
