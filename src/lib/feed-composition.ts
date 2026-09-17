/**
 * What the Feed shows, decided once.
 *
 * ─── THE PROBLEM THIS REPLACES ──────────────────────────────────────────────
 * Every row on /feed filtered the SAME unpartitioned list independently, so an
 * item belonged to as many rows as it had taxonomy relationships. Measured on
 * the built page: 41 unique items, 160 tile placements, 3.9 average, and NOT
 * ONE item appeared only once. Eight appeared six times. A Lanterns review is
 * genuinely TV, DC, Lanterns, HBO Max, a review and recent, and the page
 * printed it once for each.
 *
 * Those relationships are correct and they stay. They are for discovery and
 * filtering. They are not a rendering instruction.
 *
 * ─── THE CONSUMING PASS ─────────────────────────────────────────────────────
 * Levels are filled in editorial order and each one CONSUMES what it takes, so
 * a lower level never re-shows it. Budgets are ceilings, never quotas: a level
 * that runs out of material that belongs there renders short, because an empty
 * slot costs less than a weak story in a curated position.
 *
 * ─── THE EDITORIAL BAR ──────────────────────────────────────────────────────
 * The front door is filled from substantive coverage: REVIEW, ANALYSIS, NEWS,
 * EVENT, INTERVIEW. Reactions, first impressions and vlogs are below the bar
 * and are never used to FILL a slot.
 *
 * This is a bar on FORMAT, deliberately not on age. A 2025 film review outranks
 * a 2024 vlog because of what it is, and a date cut would bury the first with
 * the second. Nothing is hidden: everything below the bar stays in /feed/videos,
 * in its category pages and in search, exactly as before.
 *
 * `featured` lifts an item over the bar. That is what it is for: the Resident
 * Evil early screening is honestly a REACTION and is also the best access story
 * on the site, and the fix for that is curation, not relabelling the content.
 */
import { coverageRank, getDisplayTagSlots } from './tags.ts';
import { compactTag } from './hub-coverage.ts';

export interface ComposeOptions {
  featuredSeries?: number;
  latest?: number;
  videos?: number;
  articles?: number;
}

export interface FeedComposition {
  hero: any | null;
  series: { name: string; reason: string; items: any[] } | null;
  latest: any[];
  videos: any[];
  articles: any[];
  /** Every level that stopped short of its budget, and why. */
  underCapacity: Array<{ level: string; shown: number; budget: number }>;
}

export const DEFAULT_BUDGETS: Required<ComposeOptions> = {
  featuredSeries: 6,
  latest: 8,
  videos: 6,
  articles: 6,
};

/**
 * The lowest coverage type that may FILL a front-door slot.
 *
 * Named rather than written as a number so the bar moves when COVERAGE_TYPES is
 * reordered, instead of silently pointing at whatever now sits at index 4.
 */
const BAR = 'INTERVIEW';

/** The editorial format of an item, however it came by one. */
export function itemType(item: any): string {
  return getDisplayTagSlots(item).type;
}

/**
 * Whether an item is substantive enough to fill a curated slot.
 *
 * `featured` is an override and not a bypass: an editor has said this one
 * belongs on the front door, which is a judgement the format cannot make.
 */
export function meetsEditorialBar(item: any): boolean {
  if (item?.featured === true) return true;
  const type = itemType(item);
  if (!type) return false;
  return coverageRank(type) <= coverageRank(BAR);
}

/**
 * The series an item belongs to, or ''.
 *
 * TWO SOURCES, AND THE SECOND IS NOT A SHORTCUT. `series` is written by an
 * editor on a video. Articles sync from Substack and carry no such field, so a
 * series driven by `series` alone would be video-only, and the Lanterns package
 * would silently lose both of its articles. That is the same defect the row
 * filters had before `matchesHub()` learned to read article tags.
 *
 * So an article joins its series through its own tags, compared with the site's
 * `compactTag` normalisation like every other tag match here. `editorial.series`
 * is read first and is the upgrade path: set it and the tag match stops mattering
 * for that item.
 */
export function seriesOf(item: any): string {
  const explicit = String(item?.series ?? item?.editorial?.series ?? '').trim();
  if (explicit) return explicit;
  return '';
}

/** True when `item` belongs to the named series, by field or by tag. */
export function inSeries(item: any, name: string): boolean {
  const wanted = compactTag(name);
  if (!wanted) return false;
  if (compactTag(seriesOf(item)) === wanted) return true;
  const pools = [item?.youtubeTags, item?.tags];
  return pools.some((pool) => Array.isArray(pool) && pool.some((t: any) => compactTag(t) === wanted));
}

/**
 * Newest first, honouring the editorial ordering overrides.
 *
 * `isoDate` is preferred over `date` because on an article `date` is a DISPLAY
 * string, "September 15, 2026", parsed only by the host's own date heuristics.
 * `isoDate` is a real instant. Videos carry neither and use `publishedAt`
 * through `date`, which the feed mapping has already normalised.
 */
function sortTime(item: any): number {
  const candidates = [item?.sortDate, item?.isoDate, item?.date, item?.publishedAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t)) return t;
  }
  /* Unparseable sorts last rather than to the top of the Feed. */
  return 0;
}

/**
 * Chronological, with the article sort weight ahead of it.
 *
 * `getAllArticles()` sorts by `editorial.sortWeight` and then by date, and that
 * ordering was then thrown away the moment articles were merged with videos and
 * re-sorted on date alone. Honoured here so an editor's weight survives into the
 * Feed. Videos have no weight and sort as 0, which is the neutral value.
 */
export function byEditorialRecency(a: any, b: any): number {
  const weight = (i: any) => Number(i?.editorial?.sortWeight ?? 0);
  if (weight(b) !== weight(a)) return weight(b) - weight(a);
  return sortTime(b) - sortTime(a);
}

/**
 * Which series leads the Feed.
 *
 * EXPLICIT FIRST, exactly like `forceSpotlightHero` on the events page: an
 * editor marks one item and its series takes the position. The fallback is the
 * qualifying series with the most recent item, so the shelf is never empty
 * because nobody has been into the CMS this week.
 *
 * A series QUALIFIES on two counts, and the pair is the point: it has to be a
 * run rather than a single piece, and at least one of those pieces has to be
 * substantive. Otherwise two old vlogs sharing a name would take the most
 * prominent shelf on the page.
 */
export function selectSeries(
  items: any[],
): { name: string; reason: string } | null {
  const flagged = items
    .filter((i) => i?.featuredSeries === true && seriesOf(i))
    .sort(byEditorialRecency)[0];
  if (flagged) {
    return { name: seriesOf(flagged), reason: `marked as the featured series on "${flagged.title}"` };
  }

  const names = [...new Set(items.map(seriesOf).filter(Boolean))];
  const qualifying = names
    .map((name) => {
      const members = items.filter((i) => inSeries(i, name)).sort(byEditorialRecency);
      return { name, members, newest: members.length > 0 ? sortTime(members[0]) : 0 };
    })
    .filter((s) => s.members.length >= 2 && s.members.some(meetsEditorialBar))
    .sort((a, b) => b.newest - a.newest);

  const winner = qualifying[0];
  if (!winner) return null;
  return {
    name: winner.name,
    reason:
      `no series is flagged, so the most recently updated qualifying series was chosen ` +
      `(${winner.members.length} pieces, newest ${new Date(winner.newest).toISOString().slice(0, 10)})`,
  };
}

/** A stable identity for an item across levels. */
export function idOf(item: any): string {
  return String(item?._id ?? item?.youtubeId ?? item?.guid ?? item?.slug ?? item?.link ?? item?.title ?? '');
}

/**
 * Fill the Feed, once, in editorial order.
 *
 * Returns whole items rather than ids so the caller renders what it is given
 * and cannot re-query. That is the property being protected: a component that
 * can still reach `allItems` can still duplicate.
 */
export function composeFeed(allItems: any[], options: ComposeOptions = {}): FeedComposition {
  const budgets = { ...DEFAULT_BUDGETS, ...options };
  const items = (Array.isArray(allItems) ? allItems : []).slice().sort(byEditorialRecency);

  const consumed = new Set<string>();
  const available = () => items.filter((i) => !consumed.has(idOf(i)));
  const take = (list: any[], n: number) => {
    const taken = list.slice(0, n);
    for (const item of taken) consumed.add(idOf(item));
    return taken;
  };

  const underCapacity: FeedComposition['underCapacity'] = [];
  const note = (level: string, shown: number, budget: number) => {
    if (shown < budget) underCapacity.push({ level, shown, budget });
  };

  /* 1. HERO. A curated pick outranks recency; otherwise the most recent piece
        that clears the bar. Never a below-bar item, even if it is newest. */
  const heroPool = available().filter(meetsEditorialBar);
  const hero =
    take(heroPool.filter((i) => i.featured === true), 1)[0] ??
    take(heroPool, 1)[0] ??
    null;
  note('hero', hero ? 1 : 0, 1);

  /* 2. FEATURED SERIES. Chosen from the WHOLE list, not from what is left: the
        hero having taken one of its pieces must not change which series leads
        the page. The row itself then renders only what the hero did not take. */
  const selected = selectSeries(items);
  let series: FeedComposition['series'] = null;
  if (selected) {
    const members = available().filter((i) => inSeries(i, selected.name));
    const taken = take(members, budgets.featuredSeries);
    if (taken.length > 0) {
      series = { name: selected.name, reason: selected.reason, items: taken };
      note('series', taken.length, budgets.featuredSeries);
    }
    /*
      THE WHOLE SERIES IS CONSUMED, NOT JUST THE SLICE THAT FITS.

      Lanterns has seven pieces and the shelf holds six, so the seventh fell
      through to Latest and printed a Lanterns review immediately under a shelf
      headed Lanterns. No item repeated, but the PAGE repeated, which is the
      thing this whole pass is about.

      The overflow is not lost. It is in /feed/videos, in its categories, in
      search and behind the shelf's own hub link. It is simply not a second
      announcement of the series on the front door.
    */
    for (const member of members) consumed.add(idOf(member));
  }

  /* 3. LATEST. Chronological, and the only thing the bar does here is keep old
        reaction and vlog material from filling a newsroom slot. Not a ranking:
        within the bar it is date order, with an editor's sortWeight ahead of it. */
  const latest = take(available().filter(meetsEditorialBar), budgets.latest);
  note('latest', latest.length, budgets.latest);

  /* 4 and 5. The two media rails, from whatever the levels above did not use. */
  const videos = take(available().filter((i) => i.type === 'video' && meetsEditorialBar(i)), budgets.videos);
  note('videos', videos.length, budgets.videos);

  const articles = take(available().filter((i) => i.type === 'article' && meetsEditorialBar(i)), budgets.articles);
  note('articles', articles.length, budgets.articles);

  return { hero, series, latest, videos, articles, underCapacity };
}
