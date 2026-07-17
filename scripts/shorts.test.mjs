/**
 * Offline unit tests for src/lib/shorts.ts (Discovery Row daily selection).
 *
 * Run:  node scripts/shorts.test.mjs
 */
import assert from 'node:assert/strict';
import { hashSeed, seededShuffle, pickDailyShorts } from '../src/lib/shorts.ts';

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

const POOL = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
  id,
  title: `Short ${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
}));
// Noon UTC = same calendar day in the brand timezone — no midnight edge.
const JUL16 = new Date('2026-07-16T19:00:00Z');
const JUL17 = new Date('2026-07-17T19:00:00Z');

console.log('shorts.ts');

test('hashSeed is deterministic and category/date sensitive', () => {
  assert.equal(hashSeed('gaming-2026-07-16'), hashSeed('gaming-2026-07-16'));
  assert.notEqual(hashSeed('gaming-2026-07-16'), hashSeed('gaming-2026-07-17'));
  assert.notEqual(hashSeed('gaming-2026-07-16'), hashSeed('events-2026-07-16'));
});

test('seededShuffle: same seed → identical order; does not mutate input', () => {
  const before = [...POOL];
  const s1 = seededShuffle(POOL, 12345);
  const s2 = seededShuffle(POOL, 12345);
  assert.deepEqual(s1, s2);
  assert.deepEqual(POOL, before, 'input array mutated');
});

test('seededShuffle: different seeds → different order (fixture-verified)', () => {
  const s1 = seededShuffle(POOL, 12345).map((x) => x.id).join('');
  const s2 = seededShuffle(POOL, 54321).map((x) => x.id).join('');
  assert.notEqual(s1, s2);
});

test('seededShuffle is a permutation (no loss, no dupes)', () => {
  const ids = seededShuffle(POOL, 999).map((x) => x.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('pickDailyShorts: stable across calls within the same day', () => {
  const p1 = pickDailyShorts(POOL, 'gaming', 4, JUL16);
  const p2 = pickDailyShorts(POOL, 'gaming', 4, JUL16);
  assert.deepEqual(p1, p2);
  assert.equal(p1.length, 4);
});

test('pickDailyShorts: rotates on the next calendar day', () => {
  const today = pickDailyShorts(POOL, 'gaming', 4, JUL16).map((x) => x.id).join('');
  const tomorrow = pickDailyShorts(POOL, 'gaming', 4, JUL17).map((x) => x.id).join('');
  assert.notEqual(today, tomorrow);
});

test('pickDailyShorts: different categories differ on the same day', () => {
  const g = pickDailyShorts(POOL, 'gaming', 4, JUL16).map((x) => x.id).join('');
  const e = pickDailyShorts(POOL, 'events', 4, JUL16).map((x) => x.id).join('');
  assert.notEqual(g, e);
});

test('pickDailyShorts: day-level seeding — time of day is irrelevant', () => {
  const morning = pickDailyShorts(POOL, 'gaming', 4, new Date('2026-07-16T14:05:00Z'));
  const evening = pickDailyShorts(POOL, 'gaming', 4, new Date('2026-07-17T02:00:00Z')); // still Jul 16 in LA
  assert.deepEqual(morning, evening);
});

test('pickDailyShorts: empty / missing pools → []', () => {
  assert.deepEqual(pickDailyShorts([], 'gaming'), []);
  assert.deepEqual(pickDailyShorts(undefined, 'gaming'), []);
  assert.deepEqual(pickDailyShorts(null, 'gaming'), []);
});

test('pickDailyShorts: pool smaller than count returns the whole pool', () => {
  assert.equal(pickDailyShorts(POOL.slice(0, 2), 'gaming', 4, JUL16).length, 2);
});

console.log(
  process.exitCode ? `FAILED (${passed} passed)` : `All ${passed} tests passed.`,
);
