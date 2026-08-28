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

  const pages = [
    { id: 'intel', title: 'Intel', type: 'page', url: '/intel', date: new Date().toISOString() },
    { id: 'featured', title: 'Featured Hubs', type: 'page', url: '/featured', date: new Date().toISOString() },
    { id: 'events', title: 'Events', type: 'page', url: '/events', date: new Date().toISOString() },
    { id: 'media-kit', title: 'Media Kit', type: 'page', url: '/media-kit', date: new Date().toISOString() },
  ];

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
      title: `${h.title} Hub`,
      type: 'hub',
      url: `/featured/${h.slug?.current}`,
      image: resolveImage(h.logo || h.heroImage),
      date: new Date().toISOString(), // Hubs stay relatively fresh in the index
      tags: h.youtubeSyncKeywords || []
    })),
    ...pages
  ].filter(item => item.title && item.url)
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
