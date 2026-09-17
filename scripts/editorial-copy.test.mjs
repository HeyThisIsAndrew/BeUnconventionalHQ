/**
 * The publication prints its own words, and its metadata keeps its slots.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 * Two defects that were invisible on screen and only showed up when the BUILT
 * page was measured, which is why they survived several passes over this code:
 *
 *   1. RAW SOURCE TEXT IN EVERY CARD. `data-preview` carried the whole YouTube
 *      description: 160 attributes averaging 1,990 characters on /feed, ~318KB
 *      or 26% of a 1.20MB page, 102 of them holding affiliate links, gear lists
 *      or subscribe CTAs, with `amzn.to` appearing 219 times. None of it was
 *      visible at rest, because the hero clamps to 3-4 lines. All of it shipped.
 *
 *      Articles were worse in a different direction: `preview` is an ARRAY of
 *      body paragraphs, so `item.preview || item.excerpt` never reached the
 *      Substack subtitle, and the array stringified into the attribute joining
 *      paragraphs on a bare comma.
 *
 *   2. COLLAPSING METADATA SLOTS. `getDisplayTags()` ended with
 *      `.filter(Boolean)`, so an item with no brand printed its editorial type
 *      in the brand's position, and the hero painted the brand accent onto it.
 *
 * Both are the kind of regression a screenshot cannot catch, so they are
 * asserted against the real store here rather than reviewed by eye.
 *
 * ─── NOTE ON WHAT IS NOT ASSERTED ───────────────────────────────────────────
 * Creator-era VOICE ("hit that play button to find out") is not tested. This
 * file is about structural boilerplate, which is mechanical. Voice is an
 * editorial judgement and its fix is `editorial.excerpt`, written by a human.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  editorialPreview,
  stripCreatorBoilerplate,
  EDITORIAL_PREVIEW_MAX,
} from '../src/lib/editorial-text.ts';
import {
  getDisplayTagSlots,
  getDisplayTags,
  COVERAGE_TYPES,
  coverageRank,
  normalizeCoverageType,
} from '../src/lib/tags.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

const store = JSON.parse(read('src', 'data', 'videos.json'));
const docs = Array.isArray(store) ? store : store.documents || store.items || [];
const videos = docs.filter((d) => d._type === 'video' && d.contentStatus === 'published');

const articleStore = JSON.parse(read('src', 'data', 'articles.json'));
const articles = Array.isArray(articleStore)
  ? articleStore
  : articleStore.articles || Object.values(articleStore)[0] || [];

const feedItems = [...videos, ...articles];

/*
  Structural boilerplate, not vocabulary. Every pattern here was read off the
  real store: the horizontal rule alone appears 61 times across 29 descriptions.
*/
const BOILERPLATE = [
  [/https?:\/\//, 'a bare URL'],
  [/amzn\.to|a\.co\/|rwrd\.io|fbuy\.me|inkind\.com|coinbase\.com/i, 'an affiliate link'],
  [/\b(subscribe|patreon|storefront|merch)\b/i, 'a monetisation CTA'],
  [/\b(chapters?|timestamps?)\b/i, 'a chapter list heading'],
  [/[▬━─]{3,}/, 'a horizontal rule'],
  [/[#@][A-Za-z][\w'-]{2,}/, 'a hashtag or handle'],
  [/[👉✅🎥⚬]/u, 'a boilerplate bullet glyph'],
];

test('no feed item prints creator-era boilerplate', () => {
  assert.ok(feedItems.length >= 30, 'the store should hold the real corpus, not a stub');

  for (const item of feedItems) {
    const preview = editorialPreview(item);
    for (const [pattern, what] of BOILERPLATE) {
      assert.ok(
        !pattern.test(preview),
        `"${String(item.title).slice(0, 48)}" prints ${what}: ${preview.slice(0, 120)}`,
      );
    }
  }
});

test('a preview is short enough to be a standfirst, and never cut mid-word', () => {
  for (const item of feedItems) {
    const preview = editorialPreview(item);
    if (!preview) continue;
    /* An authored `editorial.excerpt` is returned whole by design; nothing in
       the store has one yet, so every value here is a derived fallback. */
    if (item?.editorial?.excerpt) continue;
    assert.ok(
      preview.length <= EDITORIAL_PREVIEW_MAX + 4,
      `"${String(item.title).slice(0, 40)}" preview is ${preview.length} chars`,
    );
    assert.ok(!/\s\S{0,2}\.\.\.$/.test(preview), 'an ellipsis should not follow a stray fragment');
  }
});

test('an article prefers its own standfirst over its body', () => {
  /*
    `preview` is an array of paragraphs. Reading it before `excerpt` is what put
    a comma-joined article body into 49 cards on /feed, commas running the
    paragraphs together: "...its own distinct identity.,One of the things...".
  */
  const withBoth = articles.filter((a) => a.excerpt && Array.isArray(a.preview) && a.preview.length);
  assert.ok(withBoth.length > 0, 'the corpus should contain articles carrying both fields');

  for (const article of withBoth) {
    const preview = editorialPreview(article);
    assert.ok(!/\.,[A-Z“‘]/.test(preview), 'paragraphs must never be joined on a comma');
    assert.ok(
      preview.startsWith(String(article.excerpt).trim().slice(0, 24)),
      `"${String(article.title).slice(0, 40)}" should lead with its subtitle, not its body`,
    );
  }
});

test('an authored editorial excerpt outranks everything the platform supplied', () => {
  const authored = 'A deliberate standfirst, written for this site.';
  const item = {
    title: 'x',
    editorial: { excerpt: authored },
    excerpt: 'the substack subtitle',
    preview: ['the body'],
    description: 'the youtube description',
  };
  assert.equal(editorialPreview(item), authored);
});

test('the boilerplate cut keeps the paragraphs above it', () => {
  const raw = [
    '#Lanterns #DC #review',
    '',
    'Episode five is the best the DCU has produced. The stakes are massive.',
    '',
    'Hit subscribe and let me know your thoughts below.',
    '',
    '━━━━━━━━',
    '🎥 MY CINEMATIC FILMING GEAR',
    'Primary Camera | Sony A7IV: https://amzn.to/3RAmcEy',
  ].join('\n');

  const out = stripCreatorBoilerplate(raw);
  assert.equal(out, 'Episode five is the best the DCU has produced. The stakes are massive.');
});

test('an editorial type never occupies the brand slot', () => {
  /*
    THE ORIGINAL BUG, STATED DIRECTLY. Five of 41 items resolved no brand, and
    the filtered array moved REVIEW or ANALYSIS into position 0, where the hero
    styles the brand accent.
  */
  const types = new Set(COVERAGE_TYPES);
  for (const item of feedItems) {
    const { brand } = getDisplayTagSlots(item);
    assert.ok(
      !types.has(brand.toUpperCase()),
      `"${String(item.title).slice(0, 48)}" put the editorial type "${brand}" in the brand slot`,
    );
  }
});

test('an absent slot stays absent rather than being filled by its neighbour', () => {
  const slots = getDisplayTagSlots({ title: 'x', youtubeTags: ['moviereview'] });
  assert.equal(slots.brand, '', 'nothing identified a brand, so the brand slot is empty');
  assert.equal(slots.type, 'REVIEW', 'and the type stays in the type slot');
});

test('the CMS beats the classified field, which beats the pattern table', () => {
  const tagged = { title: 'x', youtubeTags: ['moviereview'] };
  assert.equal(getDisplayTagSlots(tagged).type, 'REVIEW', 'patterns are the floor');

  assert.equal(
    getDisplayTagSlots({ ...tagged, coverageType: 'REACTION' }).type,
    'REACTION',
    'coverageType must override a pattern match, or a wrong label cannot be corrected',
  );
  assert.equal(
    getDisplayTagSlots({ ...tagged, coverageType: 'REACTION', badge2: 'ANALYSIS' }).type,
    'ANALYSIS',
    "an editor's explicit badge is the last word",
  );
  assert.equal(
    getDisplayTagSlots({ ...tagged, badge1: 'NEON' }).brand,
    'NEON',
    'badge1 must be able to name a brand the pattern table has never heard of',
  );
});

test('the legacy list still carries the brand, which entity-resolver depends on', () => {
  /*
    `resolveEntity()` builds a Set from `getDisplayTags()` and asks whether a
    hub's title is in it, to pick which of an item's several hubs it is really
    about (a Lanterns item is hbo-max AND dc-comics AND warner-bros). Order does
    not matter there, MEMBERSHIP does, so the list must keep naming the brand.
  */
  const lanterns = videos.find((v) => /Lanterns Episode 5/i.test(String(v.title)));
  assert.ok(lanterns, 'the corpus should still hold the Lanterns episode 5 review');
  assert.ok(getDisplayTags(lanterns).includes('DC'), 'the brand must survive into the flat list');

  for (const item of feedItems) {
    const { brand, type, extra } = getDisplayTagSlots(item);
    assert.deepEqual(
      getDisplayTags(item),
      [brand, type, extra].filter(Boolean),
      'the flat list must stay derived from the slots, not computed a second way',
    );
  }
});

test('every type the renderer can emit is in the closed set', () => {
  for (const item of feedItems) {
    const { type } = getDisplayTagSlots(item);
    if (!type) continue;
    assert.ok(
      COVERAGE_TYPES.includes(type),
      `"${type}" is not one of the ${COVERAGE_TYPES.length} coverage types`,
    );
  }
});

test('coverage types rank by editorial weight, not by date', () => {
  assert.ok(coverageRank('REVIEW') < coverageRank('REACTION'));
  assert.ok(coverageRank('ANALYSIS') < coverageRank('VLOG'));
  assert.ok(coverageRank('EVENT') < coverageRank('VLOG'));
  assert.equal(coverageRank('NOT A TYPE'), COVERAGE_TYPES.length, 'unclassified sorts last');
  assert.equal(normalizeCoverageType('  review '), 'REVIEW');
  assert.equal(normalizeCoverageType('breakdown'), '', 'a word outside the set is not a type');
});

test('the renderers read slots, not a collapsed list', () => {
  const card = read('src', 'components', 'ContentCard.astro');
  assert.match(card, /getDisplayTagSlots/, 'the card must resolve slots');
  assert.match(card, /data-slot="brand"/, 'and render the brand in a brand slot');
  assert.match(card, /'data-tag-brand'/, 'and hand the hero each slot separately');
  assert.ok(
    !/'data-tags':/.test(card),
    'a joined string cannot tell the hero which chip is the brand',
  );

  const hero = read('src', 'components', 'FeedSpotlightHero.astro');
  assert.match(hero, /hero-meta-tag--brand/, 'the accent class must name the slot it marks');
  assert.ok(
    !/index === 0 \? ' hero-meta-tag--type'/.test(hero),
    'the brand accent must follow the brand, not whichever chip sorted first',
  );
});

test('both surfaces normalise their text through the same function', () => {
  /* ContentCard cleaned its text and the hero did not, so one item read two
     ways depending on where you saw it. */
  for (const file of ['ContentCard.astro', 'FeedSpotlightHero.astro']) {
    const source = read('src', 'components', file);
    assert.match(source, /editorialPreview\(/, `${file} must use the shared normaliser`);
  }
  const hero = read('src', 'components', 'FeedSpotlightHero.astro');
  assert.ok(
    !/latestVideo\.description \|\| latestVideo\.snippet/.test(hero),
    'the hero must not fall back to the raw description',
  );
});

console.log('\nEditorial copy and metadata slots: all assertions ran.');
