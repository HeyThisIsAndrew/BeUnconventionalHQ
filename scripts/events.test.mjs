/**
 * Offline unit tests for src/lib/events.ts — the date-critical foundation.
 *
 * These guard the platform's most regression-prone invariants: calendar dates
 * are YYYY-MM-DD strings compared at equal precision, never round-tripped
 * through UTC (`new Date("YYYY-MM-DD")` shifts a day west of Greenwich).
 *
 * Run:  node scripts/events.test.mjs
 */
import assert from 'node:assert/strict';
import {
  parseEventDate,
  parseEventDateToLocal,
  formatEventDateRange,
  formatLocation,
  toYMD,
  getEventStatus,
} from '../src/lib/events.ts';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('events.ts');

// --- parseEventDate ---------------------------------------------------------
test('parseEventDate: splits a calendar date without Date/UTC involvement', () => {
  const p = parseEventDate('2026-07-22');
  assert.equal(p.year, 2026);
  assert.equal(p.month, 7);
  assert.equal(p.day, 22);
  assert.equal(p.monthShort, 'Jul');
});
test('parseEventDate: tolerates datetime strings by slicing the date part', () => {
  assert.equal(parseEventDate('2026-07-22T15:00:00Z').day, 22);
});
test('parseEventDate: null/undefined/garbage → null', () => {
  assert.equal(parseEventDate(null), null);
  assert.equal(parseEventDate(undefined), null);
  assert.equal(parseEventDate('not-a-date'), null);
});

// --- parseEventDateToLocal (the UTC-shift guard) -----------------------------
test('parseEventDateToLocal: local midnight, never the UTC-shifted prior day', () => {
  const d = parseEventDateToLocal('2026-07-22');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6); // 0-indexed July
  assert.equal(d.getDate(), 22); // new Date('2026-07-22') would give 21 in TZs west of UTC
  assert.equal(d.getHours(), 0);
});

// --- formatEventDateRange ----------------------------------------------------
test('range: single day', () => {
  assert.equal(formatEventDateRange('2026-07-22'), 'Jul 22, 2026');
});
test('range: same month', () => {
  assert.equal(formatEventDateRange('2026-07-22', '2026-07-26', { year: false }), 'Jul 22–26');
});
test('range: cross-month, same year', () => {
  assert.equal(formatEventDateRange('2026-07-30', '2026-08-02'), 'Jul 30 – Aug 2, 2026');
});
test('range: cross-year always shows both years', () => {
  assert.equal(
    formatEventDateRange('2025-12-30', '2026-01-02', { year: false }),
    'Dec 30, 2025 – Jan 2, 2026',
  );
});
test('range: end === start collapses to a single day', () => {
  assert.equal(formatEventDateRange('2026-07-22', '2026-07-22'), 'Jul 22, 2026');
});
test('range: missing start → Date TBD', () => {
  assert.equal(formatEventDateRange(null), 'Date TBD');
});

// --- formatLocation ----------------------------------------------------------
test('location: city + region', () => {
  assert.equal(formatLocation({ city: 'San Diego', region: 'CA' }), 'San Diego, CA');
});
test('location: partials degrade without stray commas', () => {
  assert.equal(formatLocation({ city: 'San Diego' }), 'San Diego');
  assert.equal(formatLocation({ country: 'Japan' }), 'Japan');
  assert.equal(formatLocation(null), '');
});
test('location: legacy string passes through (no [object Object])', () => {
  assert.equal(formatLocation('San Diego, CA'), 'San Diego, CA');
});
test('location: includeVenue prefixes the venue', () => {
  assert.equal(
    formatLocation({ venue: 'Hall H', city: 'San Diego', region: 'CA' }, { includeVenue: true }),
    'Hall H, San Diego, CA',
  );
});

// --- toYMD --------------------------------------------------------------------
test('toYMD: ISO-ordered calendar day in the reference timezone', () => {
  // 07:00 UTC on Jul 23 is Jul 23 00:00 in Los Angeles (PDT, UTC-7).
  assert.equal(toYMD(new Date('2026-07-23T07:00:00Z')), '2026-07-23');
  // One second earlier is still Jul 22 in LA — the UTC date would say 23.
  assert.equal(toYMD(new Date('2026-07-23T06:59:59Z')), '2026-07-22');
});

// --- getEventStatus ------------------------------------------------------------
const SDCC = { startDate: '2026-07-23', endDate: '2026-07-26' };
const at = (iso) => new Date(iso); // noon UTC = same calendar day in LA
test('status: before start → upcoming', () => {
  assert.equal(getEventStatus(SDCC, at('2026-07-20T12:00:00Z')), 'upcoming');
});
test('status: first day → live', () => {
  assert.equal(getEventStatus(SDCC, at('2026-07-23T12:00:00Z')), 'live');
});
test('status: LAST day still reads live, not completed', () => {
  assert.equal(getEventStatus(SDCC, at('2026-07-26T12:00:00Z')), 'live');
});
test('status: day after end → completed', () => {
  assert.equal(getEventStatus(SDCC, at('2026-07-27T12:00:00Z')), 'completed');
});
test('status: single-day event (no endDate) is live only on that day', () => {
  const oneDay = { startDate: '2026-07-23' };
  assert.equal(getEventStatus(oneDay, at('2026-07-23T12:00:00Z')), 'live');
  assert.equal(getEventStatus(oneDay, at('2026-07-24T12:00:00Z')), 'completed');
});
test('status: editorial cancelled/postponed always win over dates', () => {
  assert.equal(getEventStatus({ ...SDCC, status: 'cancelled' }, at('2026-07-24T12:00:00Z')), 'cancelled');
  assert.equal(getEventStatus({ ...SDCC, status: 'postponed' }, at('2026-07-24T12:00:00Z')), 'postponed');
});
test('status: no startDate defaults to upcoming', () => {
  assert.equal(getEventStatus({}, at('2026-07-24T12:00:00Z')), 'upcoming');
});
test('status: datetime-precision storage still compares correctly', () => {
  // If dates ever arrive as full ISO timestamps, slice(0,10) keeps the
  // comparison at equal precision instead of misclassifying today as past.
  const e = { startDate: '2026-07-23T00:00:00Z', endDate: '2026-07-26T00:00:00Z' };
  assert.equal(getEventStatus(e, at('2026-07-26T12:00:00Z')), 'live');
});

console.log(
  process.exitCode ? `FAILED (${passed} passed)` : `All ${passed} tests passed.`,
);
