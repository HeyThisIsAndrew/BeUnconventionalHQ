/** Store-free selection shared by the homepage and publication regressions. */
import { selectCollections, inSeries, sortTime } from './feed-rails.ts';

export const HOME_FEATURED_LIMIT = 4;

/** Stable keys also used when reserving Featured stories from the hero. */
export const featuredKey = (item: any): string =>
  item?.youtubeId ? `video:${item.youtubeId}` : String(item?.link ?? '');

const videosFirst = (items: any[]) => [
  ...items.filter((i) => i?.type === 'video' || i?.youtubeId),
  ...items.filter((i) => !(i?.type === 'video' || i?.youtubeId)),
];

// Video `date` is a display label without a time. Use its actual publication
// timestamp so two uploads on the same day still have a definite newest item.
// Keep the shared editorial sortDate override and the displayed record intact.
const featuredTime = (item: any) => sortTime({
  sortDate: item.sortDate, isoDate: item.publishedAt || item.isoDate, date: item.date,
});

export interface HomeFeaturedSelection {
  kind: 'collection' | 'site';
  title: string | null;
  members: any[];
  total: number;
  items: any[];
}

export function pickHomeFeatured(all: any[]): HomeFeaturedSelection | null {
  const pool = (Array.isArray(all) ? all.filter(Boolean) : []).sort((a, b) => featuredTime(b) - featuredTime(a));
  const chosen = selectCollections(pool)[0];
  if (chosen) {
    const members = pool.filter((i) => inSeries(i, chosen.name));
    const items = videosFirst(members).slice(0, HOME_FEATURED_LIMIT);
    if (items.length) return { kind: 'collection', title: chosen.name, members, total: members.length, items };
  }

  let base = [...pool.filter((i) => i.featured === true), ...pool.filter((i) => i.featured !== true)];
  const leadSeries = base[0]?.series;
  if (leadSeries) base = base.filter((i) => inSeries(i, leadSeries));
  const items = videosFirst(base.slice(0, HOME_FEATURED_LIMIT));
  return items.length ? { kind: 'site', title: null, members: items, total: items.length, items } : null;
}
