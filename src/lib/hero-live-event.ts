/**
 * ─── THE HOMEPAGE EVENTS TILE, WHILE AN EVENT IS ON ───────────────────────
 *
 * The hero's Events tile links to an ARTICLE by default (owner's call,
 * 2026-10-31: a tile titled as the article opens the article). While an event
 * is actively going on, that EVENT takes the tile over and links to its event
 * page; when it ends, the tile is the article again.
 *
 * "Actively going on" is getEventStatus() === 'live', the site's one
 * definition: today, in America/Los_Angeles, is on or between the event's
 * `startDate` and `endDate` (both inclusive, whole days, since no event
 * carries a time), and the event is not cancelled or postponed.
 *
 * WHY THE BROWSER DECIDES, NOT THE BUILD. The homepage is static, and the
 * deploy job skips the rebuild when `main` has not changed, so a choice made
 * at build time could outlive the event by days. The build emits each
 * candidate event's tile with its dates; the reader's browser asks
 * getEventStatus() on every load and swaps the tile in only while it is live.
 * That is what makes the revert automatic. It is the same reason the hero's
 * NEW chip is decided in the browser (HeroAccordion.astro).
 *
 * Plain module, no JSON imports, so `node` can test it and the browser can
 * bundle it.
 */
import { getEventStatus, toYMD, REFERENCE_TZ } from './events.ts';

/**
 * How far ahead of the build an event may START and still be emitted. A
 * built page is normally replaced within hours (every content sync commits
 * and redeploys), so this only covers a quiet spell with no rebuild. An
 * event starting beyond it simply waits for the next build to be emitted.
 */
export const LIVE_EVENT_LOOKAHEAD_DAYS = 14;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface EventWindow {
  slug: string;
  start: string;
  end: string;
}

/**
 * The event's active window, or null when the data does not state a clear
 * one: both dates must be present as calendar days and the end must not be
 * before the start. A missing `endDate` is NOT treated as a one-day event
 * here (getEventStatus does that for display); an event that does not say
 * when it ends never takes over the tile.
 */
export function eventWindow(event: any): EventWindow | null {
  const slug = event?.slug?.current;
  const start = typeof event?.startDate === 'string' ? event.startDate.slice(0, 10) : '';
  const end = typeof event?.endDate === 'string' ? event.endDate.slice(0, 10) : '';
  if (!slug || !YMD.test(start) || !YMD.test(end) || end < start) return null;
  return { slug, start, end };
}

/** Events with no clear window: listed for the owner, never shown on the tile. */
export function eventsWithoutClearWindow(events: any[]): string[] {
  return (events ?? [])
    .filter((e) => e?.slug?.current && !eventWindow(e))
    .map((e) => e.slug.current);
}

/**
 * The events a page built `now` should carry: a clear window, not cancelled
 * or postponed, not already over, and starting within the lookahead. Sorted
 * by start date, then slug, so overlapping events resolve the same way on
 * every build and in every browser (the earliest-starting one wins).
 */
export function heroLiveEventCandidates(
  events: any[],
  now: Date = new Date(),
  lookaheadDays: number = LIVE_EVENT_LOOKAHEAD_DAYS,
  timeZone: string = REFERENCE_TZ,
): Array<{ event: any; window: EventWindow }> {
  const today = toYMD(now, timeZone);
  const horizon = toYMD(new Date(now.getTime() + lookaheadDays * 86_400_000), timeZone);
  return (events ?? [])
    .map((event) => ({ event, window: eventWindow(event) }))
    .filter((c): c is { event: any; window: EventWindow } => c.window !== null)
    .filter(({ event }) => event.status !== 'cancelled' && event.status !== 'postponed')
    .filter(({ window }) => window.end >= today && window.start <= horizon)
    .sort((a, b) => a.window.start.localeCompare(b.window.start) || a.window.slug.localeCompare(b.window.slug));
}

/**
 * The first window that is live `now`, or -1. Called in the browser with the
 * windows the build emitted, so the answer is today's, not the build's.
 */
export function pickLiveWindow(
  windows: Array<{ start: string; end: string }>,
  now: Date = new Date(),
  timeZone: string = REFERENCE_TZ,
): number {
  return windows.findIndex((w) => getEventStatus({ startDate: w.start, endDate: w.end }, now, timeZone) === 'live');
}
