import { getVideosUnified } from '../../lib/videos-source';
import { getArticleItems } from '../../lib/feed-items';
import { getEventsLocal, getFeaturedBrandsLocal, urlFor } from '../../lib/local-content';
import { parseVideoId } from '../../lib/platforms/youtube';

export const prerender = true;

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

  const index = [
    ...videos.map((v: any) => ({
      id: v.id,
      title: v.title,
      type: 'video',
      url: v.link || '#',
      image: v.thumbnail || v.image || (v.link && parseVideoId(v.link) ? `https://i.ytimg.com/vi/${parseVideoId(v.link)}/mqdefault.jpg` : null),
      date: v.publishedAt || v.date,
      tags: [...(v.tags || []), ...(v.hubs || [])].filter(Boolean)
    })),
    ...articles.map((a: any) => ({
      id: a.slug,
      title: a.title,
      type: 'article',
      url: a.link || `/intel/${a.slug}`,
      image: a.thumbnail || a.image,
      date: a.date,
      tags: a.tags || []
    })),
    ...events.map((e: any) => ({
      id: e.slug?.current || e._id,
      title: e.title,
      type: 'event',
      url: `/events/${e.slug?.current}`,
      image: resolveImage(e.heroImage),
      date: e.startDate,
      tags: []
    })),
    ...hubs.map((h: any) => ({
      id: h.slug?.current || h._id,
      title: h.title,
      type: 'hub',
      url: `/featured/${h.slug?.current}`,
      image: resolveImage(h.logo || h.heroImage),
      date: null,
      tags: h.youtubeSyncKeywords || []
    }))
  ].filter(item => item.title && item.url);

  return new Response(JSON.stringify(index), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
