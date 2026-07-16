/**
 * Pure, framework-agnostic helpers for event data.
 *
 * Nothing in here imports Astro or Sanity, and nothing constructs a `Date`
 * from a calendar string — that is the whole point. Event dates are stored as
 * plain "YYYY-MM-DD" strings (see schema/event.ts). The instant you do
 * `new Date("2026-07-22")` the runtime reads it as midnight UTC and then
 * renders it in the viewer's timezone, so anyone west of UTC sees "Jul 21".
 * We avoid that by treating the calendar date as text: split it, look the
 * month name up in a table, and compare dates as strings (ISO dates sort
 * chronologically as plain text, as long as both operands are the same
 * precision — see toYMD/getEventStatus).
 *
 * Because these are pure functions they can be unit-tested with plain Node,
 * with no build step and no network — which is how they are verified.
 */

export type EventStatus = 'upcoming' | 'live' | 'completed' | 'cancelled' | 'postponed';

/** The editorial-only status stored on the document (see schema). */
export type EventStatusOverride = 'scheduled' | 'cancelled' | 'postponed';

export interface EventLocation {
  venue?: string;
  city?: string;
  region?: string;
  country?: string;
}

export interface EventLike {
  startDate?: string | null;
  endDate?: string | null;
  status?: EventStatusOverride | string | null;
  location?: EventLocation | string | null;
}

export interface ParsedDate {
  year: number;
  /** 1-12 (human month, not the 0-11 a Date would give). */
  month: number;
  day: number;
  /** Short English month name, e.g. "Jul". */
  monthShort: string;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Reference timezone for deciding "what day is it" when deriving status. The
 * brand is US/California-based; a few hours' skew at the midnight boundary is
 * immaterial for an upcoming/live/completed decision. Injectable for tests.
 */
export const REFERENCE_TZ = 'America/Los_Angeles';

/**
 * Split a "YYYY-MM-DD" (or a longer "YYYY-MM-DDThh:mm:ssZ") string into its
 * parts WITHOUT constructing a Date. Any time component is ignored. Returns
 * null for anything that isn't a valid calendar date so callers can fall back.
 */
export function parseEventDate(value?: string | null): ParsedDate | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, monthShort: MONTHS_SHORT[month - 1] };
}

export interface DateRangeOptions {
  /** Include the year in the output. Default true. */
  year?: boolean;
  /** Separator between days/dates. Default en-dash "–". */
  dash?: string;
}

/**
 * Format a calendar date range for display, Date-free.
 *
 *   formatEventDateRange("2026-07-22", "2026-07-26")               -> "Jul 22–26, 2026"
 *   formatEventDateRange("2026-07-22", "2026-07-26", {year:false}) -> "Jul 22–26"
 *   formatEventDateRange("2026-07-22")                             -> "Jul 22, 2026"
 *   formatEventDateRange("2026-07-30", "2026-08-02")               -> "Jul 30 – Aug 2, 2026"
 *   formatEventDateRange("2025-12-30", "2026-01-02")               -> "Dec 30, 2025 – Jan 2, 2026"
 */
export function formatEventDateRange(
  start?: string | null,
  end?: string | null,
  options: DateRangeOptions = {}
): string {
  const { year = true, dash = '–' } = options;
  const s = parseEventDate(start);
  if (!s) return 'Date TBD';
  const e = end ? parseEventDate(end) : null;
  const yr = year ? `, ${s.year}` : '';

  // Single day (no end, or end === start).
  if (!e || (e.year === s.year && e.month === s.month && e.day === s.day)) {
    return `${s.monthShort} ${s.day}${yr}`;
  }
  // Same month & year: "Jul 22–26".
  if (s.year === e.year && s.month === e.month) {
    return `${s.monthShort} ${s.day}${dash}${e.day}${yr}`;
  }
  // Same year, crossing months: "Jul 30 – Aug 2, 2026".
  if (s.year === e.year) {
    return `${s.monthShort} ${s.day} ${dash} ${e.monthShort} ${e.day}${yr}`;
  }
  // Crossing years: always show both years regardless of the `year` option,
  // otherwise the range is ambiguous.
  return `${s.monthShort} ${s.day}, ${s.year} ${dash} ${e.monthShort} ${e.day}, ${e.year}`;
}

/**
 * Format a structured location for display. Falls back gracefully when parts
 * are missing (no trailing comma), and passes a legacy string through
 * untouched so a not-yet-migrated document never renders "[object Object]".
 *
 *   formatLocation({ city: "San Diego", region: "CA" })          -> "San Diego, CA"
 *   formatLocation({ city: "San Diego" })                        -> "San Diego"
 *   formatLocation({ country: "Japan" })                         -> "Japan"
 *   formatLocation({ venue:"Hall H", city:"San Diego", region:"CA" }, { includeVenue:true })
 *                                                                 -> "Hall H, San Diego, CA"
 */
export function formatLocation(
  location?: EventLocation | string | null,
  options: { includeVenue?: boolean } = {}
): string {
  if (!location) return '';
  if (typeof location === 'string') return location; // legacy / un-migrated
  const primary =
    [location.city, location.region].filter(Boolean).join(', ') ||
    location.country ||
    '';
  if (options.includeVenue && location.venue) {
    return primary ? `${location.venue}, ${primary}` : location.venue;
  }
  return primary;
}

/**
 * Today's date as "YYYY-MM-DD" in the given timezone. The `en-CA` locale emits
 * ISO-ordered date parts, so this is a clean way to get a comparable calendar
 * day for "now" without hand-assembling it. Injectable `date` for tests.
 */
export function toYMD(date: Date = new Date(), timeZone: string = REFERENCE_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Resolve an event's DISPLAYED lifecycle status.
 *
 * Editorial states (cancelled / postponed) are stored on the document and win.
 * Everything else is derived from the calendar dates vs. today — so no one has
 * to hand-flip an event from "upcoming" to "live" to "completed" as time
 * passes. Comparison is string-based on same-precision "YYYY-MM-DD" values,
 * which is why an event whose last day is *today* correctly reads as "live"
 * rather than "completed".
 */
export function getEventStatus(
  event: EventLike,
  now: Date = new Date(),
  timeZone: string = REFERENCE_TZ
): EventStatus {
  if (event?.status === 'cancelled') return 'cancelled';
  if (event?.status === 'postponed') return 'postponed';

  const start = typeof event?.startDate === 'string' ? event.startDate.slice(0, 10) : null;
  if (!start) return 'upcoming'; // no date yet — safest default is "not over"

  const end =
    typeof event?.endDate === 'string' && event.endDate ? event.endDate.slice(0, 10) : start;
  const today = toYMD(now, timeZone);

  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'live';
}
