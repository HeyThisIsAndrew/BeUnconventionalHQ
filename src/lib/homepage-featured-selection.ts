/** Store-free selection shared by the homepage and publication regressions. */
import { inSeries, sortTime } from './feed-rails.ts';

export const HOME_FEATURED_LIMIT = 4;
export const HOME_FEATURED_SETTINGS_ID = 'homepage-featured-settings';

export interface HomeFeaturedSettings {
  mode: 'series' | 'mixed';
  series: string;
}

/** A missing setting must never silently select a series for the editor. */
export function readHomeFeaturedSettings(docs: readonly any[]): HomeFeaturedSettings {
  const doc = docs.find((item) => item?._id === HOME_FEATURED_SETTINGS_ID && item?._type === 'homeFeaturedSettings');
  return {
    mode: doc?.mode === 'series' ? 'series' : 'mixed',
    series: typeof doc?.series === 'string' ? doc.series.trim() : '',
  };
}

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

export function pickHomeFeatured(
  all: any[],
  settings: HomeFeaturedSettings = { mode: 'mixed', series: '' },
): HomeFeaturedSelection | null {
  const pool = (Array.isArray(all) ? all.filter(Boolean) : []).sort((a, b) => featuredTime(b) - featuredTime(a));
  const series = settings.series.trim();
  if (settings.mode === 'series' && series) {
    const members = pool.filter((i) => inSeries(i, series));
    const items = videosFirst(members).slice(0, HOME_FEATURED_LIMIT);
    if (items.length) return { kind: 'collection', title: series, members, total: members.length, items };
  }

  // Individual editorial picks first, newest within each group. A lead item's
  // series must not turn a mixed selection back into a single-show shelf.
  const isFeatured = (item: any) => item.featured === true || (item.type === 'article' && item.editorial?.featured === true);
  const base = [...pool.filter(isFeatured), ...pool.filter((item) => !isFeatured(item))];
  const items = base.slice(0, HOME_FEATURED_LIMIT);
  return items.length ? { kind: 'site', title: null, members: items, total: items.length, items } : null;
}
