/**
 * Offline unit tests for the Taxonomy-as-Code sync core (epic #34).
 *
 * Run:  node scripts/taxonomy.test.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeTag,
  buildTaxonomyDictionary,
  matchVideoTags,
  planVideoSync,
  toRefs,
  TIER1_TOPIC_SEEDS,
  UNCATEGORIZED_TOPIC_ID,
} from './sync-youtube.mjs';

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

// Dictionary fixture: the seeds + one brand + one event with keywords.
const DICT = buildTaxonomyDictionary({
  topics: TIER1_TOPIC_SEEDS.map((s) => ({
    _id: s._id,
    isTier1Category: s.isTier1Category,
    youtubeSyncKeywords: s.keywords,
  })),
  hubs: [
    { _id: 'brand-marvel', youtubeSyncKeywords: ['marvel'] },
    { _id: 'event-sdcc-2026', youtubeSyncKeywords: ['san diego comic-con', 'sdcc'] },
  ],
});

const VIDEO = {
  id: 'dQw4w9WgXcQ',
  title: 'Spider-Man Brand New Day Trailer Breakdown',
  description: 'desc',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  durationSeconds: 600,
  isShort: false,
  viewCount: 100,
  publishedAt: '2026-07-12T15:00:00Z',
  tags: [],
};

console.log('taxonomy (sync-youtube.mjs)');

// ── normalizeTag ─────────────────────────────────────────────────────────────
test('normalizeTag: case + punctuation insensitive', () => {
  assert.equal(normalizeTag('San Diego Comic-Con'), 'san diego comic con');
  assert.equal(normalizeTag('SAN  DIEGO   comic_con'), 'san diego comic con');
  assert.equal(normalizeTag('  Apple TV+ '), 'apple tv');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag(null), '');
});

// ── buildTaxonomyDictionary ──────────────────────────────────────────────────
test('dictionary: only Tier-1 topics contribute category keywords', () => {
  assert.equal(DICT.tier1.get('film'), 'topic-film');
  assert.equal(DICT.tier1.get('movies'), 'topic-film');
  // uncategorized has no keywords and is not tier1
  assert.equal([...DICT.tier1.values()].includes(UNCATEGORIZED_TOPIC_ID), false);
});

test('dictionary: hub keywords normalize at build time', () => {
  assert.equal(DICT.hubs.get('san diego comic con'), 'event-sdcc-2026');
  assert.equal(DICT.hubs.get('marvel'), 'brand-marvel');
});

test('dictionary: collisions keep first and are reported', () => {
  const d = buildTaxonomyDictionary({
    topics: [
      { _id: 'topic-a', isTier1Category: true, youtubeSyncKeywords: ['clash'] },
      { _id: 'topic-b', isTier1Category: true, youtubeSyncKeywords: ['Clash!'] },
    ],
    hubs: [],
  });
  assert.equal(d.tier1.get('clash'), 'topic-a');
  assert.equal(d.collisions.length, 1);
  assert.equal(d.collisions[0].ignored, 'topic-b');
});

// ── matchVideoTags ───────────────────────────────────────────────────────────
test('spec example 1: film + marvel → Film category + Marvel hub', () => {
  const m = matchVideoTags(['film', 'marvel', 'spiderman 4k reaction'], DICT);
  assert.deepEqual(m.topicIds, ['topic-film']);
  assert.deepEqual(m.hubIds, ['brand-marvel']);
  assert.equal(m.requiresReview, false);
});

test('spec example 2: film + marvel + SDCC → all three assignments', () => {
  const m = matchVideoTags(['Film', 'Marvel', 'San Diego Comic-Con'], DICT);
  assert.deepEqual(m.topicIds, ['topic-film']);
  assert.deepEqual(m.hubIds.sort(), ['brand-marvel', 'event-sdcc-2026']);
});

test('SEO pollution: 500 chars of junk tags are ignored, exact hits kept', () => {
  const m = matchVideoTags(
    ['spiderman 4k reaction', 'best trailer ever', 'GAMING', 'ps5 gameplay no commentary'],
    DICT,
  );
  assert.deepEqual(m.topicIds, ['topic-gaming']);
  assert.deepEqual(m.hubIds, []);
});

test('fallback protocol: zero Tier-1 hits → Uncategorized + requiresReview', () => {
  const m = matchVideoTags(['marvel', 'random seo'], DICT); // hub hit but no category
  assert.deepEqual(m.topicIds, [UNCATEGORIZED_TOPIC_ID]);
  assert.deepEqual(m.hubIds, ['brand-marvel']);
  assert.equal(m.requiresReview, true);
});

test('no tags at all → fallback protocol, never dropped', () => {
  const m = matchVideoTags(undefined, DICT);
  assert.deepEqual(m.topicIds, [UNCATEGORIZED_TOPIC_ID]);
  assert.equal(m.requiresReview, true);
});

test('duplicate tags do not duplicate refs', () => {
  const m = matchVideoTags(['film', 'FILM', 'movie'], DICT);
  assert.deepEqual(m.topicIds, ['topic-film']);
});

// ── toRefs ───────────────────────────────────────────────────────────────────
test('toRefs: reference shape with _key (Studio array requirement)', () => {
  assert.deepEqual(toRefs(['topic-film']), [{ _type: 'reference', _ref: 'topic-film', _key: 'topic-film' }]);
});

// ── planVideoSync: the three field classes ───────────────────────────────────
const cleanMatch = matchVideoTags(['film', 'marvel'], DICT);
const reviewMatch = matchVideoTags(['nothing useful'], DICT);

test('new video, clean match → created PUBLISHED with derived taxonomy (auto-publish)', () => {
  const p = planVideoSync(VIDEO, cleanMatch, null);
  assert.equal(p.createIfNotExists.contentStatus, 'published');
  assert.equal(p.createIfNotExists.requiresReview, false);
  assert.deepEqual(p.createIfNotExists.topics, toRefs(['topic-film']));
  assert.deepEqual(p.createIfNotExists.hubs, toRefs(['brand-marvel']));
  assert.equal(p.createIfNotExists.manualTaxonomyOverride, false);
});

test('new video, no match → created NEEDS-REVIEW as Uncategorized', () => {
  const p = planVideoSync(VIDEO, reviewMatch, null);
  assert.equal(p.createIfNotExists.contentStatus, 'needs-review');
  assert.equal(p.createIfNotExists.requiresReview, true);
  assert.deepEqual(p.createIfNotExists.topics, toRefs([UNCATEGORIZED_TOPIC_ID]));
});

test('existing unlocked doc → patch rewrites derived taxonomy every run', () => {
  const p = planVideoSync(VIDEO, cleanMatch, { contentStatus: 'published', manualTaxonomyOverride: false });
  assert.deepEqual(p.patch.set.topics, toRefs(['topic-film']));
  assert.deepEqual(p.patch.set.hubs, toRefs(['brand-marvel']));
  assert.equal(p.patch.set.requiresReview, false);
});

test('SYNC LOCK: locked doc patch contains factual fields ONLY', () => {
  const p = planVideoSync(VIDEO, cleanMatch, { contentStatus: 'published', manualTaxonomyOverride: true });
  assert.equal('topics' in p.patch.set, false);
  assert.equal('hubs' in p.patch.set, false);
  assert.equal('requiresReview' in p.patch.set, false);
  assert.equal('contentStatus' in p.patch.set, false);
  assert.equal(p.patch.set.title, VIDEO.title); // stats/metadata still flow
  assert.equal(p.patch.set.viewCount, VIDEO.viewCount);
});

test('promotion: needs-review doc + newly clean match → contentStatus published', () => {
  const p = planVideoSync(VIDEO, cleanMatch, { contentStatus: 'needs-review', manualTaxonomyOverride: false });
  assert.equal(p.patch.set.contentStatus, 'published');
});

test('no demotion: published doc + bad tags stays published (status untouched)', () => {
  const p = planVideoSync(VIDEO, reviewMatch, { contentStatus: 'published', manualTaxonomyOverride: false });
  assert.equal('contentStatus' in p.patch.set, false);
  assert.equal(p.patch.set.requiresReview, true); // flagged, but not unpublished
});

test('human archive is final: archived doc never promoted', () => {
  const p = planVideoSync(VIDEO, cleanMatch, { contentStatus: 'archived', manualTaxonomyOverride: false });
  assert.equal('contentStatus' in p.patch.set, false);
});

test('editorial fields never appear in any patch', () => {
  for (const existing of [null, { contentStatus: 'needs-review', manualTaxonomyOverride: false }]) {
    const p = planVideoSync(VIDEO, cleanMatch, existing);
    for (const key of ['featured', 'franchises', 'characters', 'editorialNotes', 'coverageType', 'series', 'manualTaxonomyOverride']) {
      assert.equal(key in p.patch.set, false, `${key} leaked into patch.set`);
    }
  }
});

console.log(
  process.exitCode ? `FAILED (${passed} passed)` : `All ${passed} tests passed.`,
);
