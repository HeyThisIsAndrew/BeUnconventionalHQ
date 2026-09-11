/*
  Event and hub coverage matching — src/lib/hub-coverage.ts and the two pages
  that call it.

  Offline. No browser, no network, no build step: the matcher is exercised
  directly and the pages are read as source, in the style of the other guards
  in this directory.

  ─── WHAT THIS FILE EXISTS TO STOP ─────────────────────────────────────────
  Two page types answered one question — "what coverage belongs to this
  hub?" — with two hand-written implementations, and only one of them worked.
  The event page's version searched article prose for strings like
  "sdcc-2026" and returned ZERO articles for all nineteen events. It was
  reported as "I'm actually surprised that you're saying articles don't
  currently appear", which is exactly the right reaction: nothing on the page
  said so, it just looked like there was no coverage.
*/
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import {
  normalizeTag,
  getHubMatchTags,
  matchArticlesByTags,
  matchVideosByTags,
  collectHubCoverage,
  coverageTimestamp,
  COVERAGE_PAGE_LIMIT,
  COVERAGE_FEED_PAGE_SIZE,
} from '../src/lib/hub-coverage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');

/* Comments explain the very bugs the negative assertions search for. Strip. */
const stripComments = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    failed += 1;
  }
}

const article = (over = {}) => ({ title: 'a', date: '2026-01-02', tags: [], ...over });
const video = (over = {}) => ({ title: 'v', publishedAt: '2026-01-01', youtubeTags: [], ...over });

console.log('\nevent & hub coverage matching');

test('a tag match ignores case and punctuation, and nothing else', () => {
  assert.equal(normalizeTag('Marvel Studios'), 'marvel studios');
  assert.equal(normalizeTag('marvel-studios'), 'marvel studios');
  assert.equal(normalizeTag('  MARVEL   STUDIOS '), 'marvel studios');
  assert.equal(normalizeTag('San Diego Comic-Con'), 'san diego comic con');
  assert.equal(normalizeTag(undefined), '');
  assert.equal(normalizeTag(42), '');
  assert.equal(normalizeTag('   '), '');
});

test('a substring is NOT a match', () => {
  /*
    The whole reason the event page is being rewritten. Its matcher was

      a.title?.toLowerCase().includes(tag.toLowerCase())

    which claims any article whose prose happens to contain the run of
    characters. "Marvel" would take every article mentioning Marvel in a
    sentence, and "DC" would take "DCU", "abdication" and "Rockstar's
    DLC" alike.
  */
  const tags = ['dc'];
  assert.equal(matchArticlesByTags([article({ tags: ['DCU'] })], tags).length, 0,
    '"DCU" is a different tag from "DC" and must not match it');
  assert.equal(matchArticlesByTags([article({ title: 'All about DC Comics', tags: [] })], tags).length, 0,
    'prose is not a tag; matching it is what leaked');
  assert.equal(matchArticlesByTags([article({ tags: ['DC'] })], tags).length, 1,
    'the exact tag still matches');
});

test('an article matches on its tags or its category', () => {
  const tags = ['film'];
  assert.equal(matchArticlesByTags([article({ tags: ['Film'] })], tags).length, 1);
  assert.equal(matchArticlesByTags([article({ category: 'Film' })], tags).length, 1);
  assert.equal(matchArticlesByTags([article({ tags: ['TV'], category: 'TV' })], tags).length, 0);
});

test('a video matches on its YouTube tags, its own tags or its category', () => {
  const tags = ['marvel studios'];
  assert.equal(matchVideosByTags([video({ youtubeTags: ['Marvel Studios'] })], tags).length, 1);
  assert.equal(matchVideosByTags([video({ tags: ['marvel studios'] })], tags).length, 1);
  assert.equal(matchVideosByTags([video({ category: 'Marvel Studios' })], tags).length, 1);
  assert.equal(matchVideosByTags([video({ youtubeTags: ['Marvel'] })], tags).length, 0);
});

test('no tags means no match, never everything', () => {
  /*
    A hub with an empty vocabulary is the common case: ten of the nineteen
    shipped events carry no youtubeSyncKeywords at all. `[].some(...)` is
    false, so this holds by construction — but an "optimisation" that treats
    an empty filter as "match all" would silently put the entire catalogue
    on every one of those pages.
  */
  assert.equal(matchArticlesByTags([article({ tags: ['Film'] })], []).length, 0);
  assert.equal(matchVideosByTags([video({ youtubeTags: ['Film'] })], []).length, 0);
});

test('a hub\'s vocabulary is coverageTags plus youtubeSyncKeywords, deduped', () => {
  const tags = getHubMatchTags({
    coverageTags: ['Doomsday', 'Avengers', 'doomsday'],
    youtubeSyncKeywords: ['AVENGERS', 'sdcc-2026', null, 7, '   '],
  });
  assert.deepEqual(tags, ['doomsday', 'avengers', 'sdcc 2026']);

  assert.deepEqual(getHubMatchTags({}), []);
  assert.deepEqual(getHubMatchTags(null), []);
  assert.deepEqual(getHubMatchTags({ coverageTags: 'not-an-array' }), []);
});

test('hub-tagged videos win outright; tag matching is only the fallback', () => {
  /*
    `video.hubs` is the deterministic, editor-controlled path (the sync writes
    it, or a human does in the local CMS). Once anything is hub-tagged, the
    heuristic stops running entirely — otherwise a curated list would quietly
    grow a tail of things nobody chose.
  */
  const hub = { slug: { current: 'sdcc-2026' }, coverageTags: ['Film'] };
  const tagged = video({ title: 'chosen', hubs: ['sdcc-2026'], youtubeTags: [] });
  const merelyMatching = video({ title: 'guessed', youtubeTags: ['Film'] });

  const withTagging = collectHubCoverage({ hub, videos: [tagged, merelyMatching], articles: [] });
  assert.deepEqual(withTagging.items.map((i) => i.title), ['chosen']);

  const withoutTagging = collectHubCoverage({ hub, videos: [merelyMatching], articles: [] });
  assert.deepEqual(withoutTagging.items.map((i) => i.title), ['guessed']);
});

test('articles are always tag-matched, because they have no hubs field', () => {
  /*
    Articles sync from Substack, which knows nothing about this site's hubs.
    Not one of the shipped articles carries a `hubs` array, so there is no
    deterministic path for them and the tag vocabulary is the only path.
  */
  const raw = JSON.parse(readSrc('src', 'data', 'articles.json'));
  const articles = raw.articles || raw.items || raw;
  assert.ok(articles.length > 0, 'the article store must not be empty');
  const withHubs = articles.filter((a) => Array.isArray(a.hubs) && a.hubs.length > 0);
  assert.equal(withHubs.length, 0,
    'an article grew a hubs[] field. If that is deliberate, collectHubCoverage should use it.');
});

test('coverage is newest first across two different date fields', () => {
  /*
    Articles date on `date`, videos on `publishedAt`. The old unified sort
    read `new Date(a.date)` for both, so every video sorted as NaN and the
    order of the video half was whatever the engine did with a comparator
    that returns NaN. Which is: nothing reliable.
  */
  assert.equal(coverageTimestamp({ date: '2026-03-01' }), Date.parse('2026-03-01'));
  assert.equal(coverageTimestamp({ publishedAt: '2026-03-01' }), Date.parse('2026-03-01'));
  assert.equal(coverageTimestamp({}), 0);
  assert.equal(coverageTimestamp({ date: 'not a date' }), 0);

  const hub = { slug: { current: 'x' }, coverageTags: ['Film'] };
  const { items } = collectHubCoverage({
    hub,
    videos: [
      video({ title: 'video-older', youtubeTags: ['Film'], publishedAt: '2026-01-01' }),
      video({ title: 'video-newest', youtubeTags: ['Film'], publishedAt: '2026-05-01' }),
    ],
    articles: [article({ title: 'article-middle', tags: ['Film'], date: '2026-03-01' })],
  });
  assert.deepEqual(items.map((i) => i.title), ['video-newest', 'article-middle', 'video-older']);
});

test('every item is labelled with what it is, or the filter has nothing to read', () => {
  const hub = { slug: { current: 'x' }, coverageTags: ['Film'] };
  const { items, articleCount, videoCount } = collectHubCoverage({
    hub,
    videos: [video({ youtubeTags: ['Film'] })],
    articles: [article({ tags: ['Film'] })],
  });
  assert.deepEqual(items.map((i) => i.contentType).sort(), ['article', 'video']);
  assert.equal(articleCount, 1);
  assert.equal(videoCount, 1);
});

test('the shipped event store still needs coverageTags, and one event proves it', () => {
  /*
    ─── THE MEASUREMENT THAT JUSTIFIES THE FIELD ───────────────────────────

    `youtubeSyncKeywords` on an event is year-scoped sync tokens —
    ["sdcc 2026", "sdcc-2026", "sdcc2026"] — because its one job is matching
    YouTube tags during the sync. No writer tags an article "sdcc2026", so
    an event matching on that field alone matches no articles at all. On a
    brand hub the same field happens to hold brand names ("marvel", "mcu"),
    which IS what a writer tags a post with, which is why hub pages appeared
    to work and event pages did not.

    Widening youtubeSyncKeywords instead would be worse than the bug:
    extractHubSeeds() in scripts/sync-youtube.mjs reads it, so "marvel
    studios" on the Doomsday premiere would hub-tag every Marvel video on
    the channel to one red-carpet night.

    This asserts the measurement both ways: an event with no coverageTags
    still matches nothing, and the one event that has them matches something.
  */
  const docs = JSON.parse(readSrc('src', 'data', 'videos.json'));
  const rawArticles = JSON.parse(readSrc('src', 'data', 'articles.json'));
  const articles = rawArticles.articles || rawArticles.items || rawArticles;
  const events = docs.filter((d) => d._type === 'event');
  assert.ok(events.length > 0, 'the event store must not be empty');

  for (const event of events) {
    if (Array.isArray(event.coverageTags) && event.coverageTags.length > 0) continue;
    const syncOnly = matchArticlesByTags(articles, getHubMatchTags(event));
    assert.equal(syncOnly.length, 0,
      `${event.slug?.current} matched an article from youtubeSyncKeywords alone. If sync ` +
        'keywords have become broad enough to match prose tags, they are now feeding ' +
        'extractHubSeeds() the same breadth — check what that pulls into the hub.');
  }

  const seeded = events.filter((e) => Array.isArray(e.coverageTags) && e.coverageTags.length > 0);
  assert.ok(seeded.length > 0,
    'no event carries coverageTags, so no event page can show an article. Seed at least one, ' +
      'or the field is shipped dead.');
  for (const event of seeded) {
    const matched = matchArticlesByTags(articles, getHubMatchTags(event));
    assert.ok(matched.length > 0,
      `${event.slug?.current} has coverageTags that match nothing. Tags are compared exactly ` +
        'after normalizing — check them against the article tags actually in the store.');
  }
});

console.log('\nthe six-item cap and its overflow feed');

test('the cap is six, and the feed pages twelve', () => {
  /*
    Six matches the "Past Event Archive" cap on /events, twelve matches
    /intel, /feed and /events/archive. Both numbers are shared constants so
    the two ends of the same journey cannot drift apart.
  */
  assert.equal(COVERAGE_PAGE_LIMIT, 6);
  assert.equal(COVERAGE_FEED_PAGE_SIZE, 12);
});

test('the event page shows at most six, and counts the rest', () => {
  const page = stripComments(readSrc('src', 'pages', 'events', '[slug].astro'));

  assert.match(page, /const unifiedContent = coverage\.items\.slice\(0, COVERAGE_PAGE_LIMIT\)/,
    'the grid must be capped by the shared constant, not by a number typed here');
  assert.match(page, /const coverageTotal = coverage\.items\.length/,
    'the page must know the true total, or the overflow link cannot say how many are behind it');
  assert.match(page, /const coverageHref = `\/events\/\$\{event\.slug\?\.current\}\/coverage`/,
    'the overflow link must point at the per-event feed route');
});

test('the overflow link appears only when something is behind it', () => {
  for (const rel of ['EventAnnouncement.astro', 'EventFeatured.astro']) {
    const code = stripComments(readSrc('src', 'components', rel));
    assert.match(code, /\{coverageTotal > unifiedContent\.length && \(/,
      `${rel} must gate the "All coverage" link on there actually being more. A link to a ` +
        'page showing the same six items is a dead end with extra steps.');
    assert.match(code, /href=\{coverageHref\}/, `${rel} must use the href the page computed`);
  }
});

test('the overflow route exists, and is generated only where there is coverage', () => {
  const rel = join('src', 'pages', 'events', '[slug]', 'coverage', '[...page].astro');
  assert.ok(existsSync(join(here, '..', rel)), `${rel} is missing; every "All coverage" link 404s`);

  const route = stripComments(readSrc(rel));
  assert.match(route, /if \(items\.length === 0\) return \[\]/,
    'an event with no coverage must not build an empty, indexable page');
  assert.match(route, /pageSize: COVERAGE_FEED_PAGE_SIZE/,
    'the feed must page at the shared size');
  assert.match(route, /collectHubCoverage\(/,
    'the feed must list what the event page capped, via the same matcher');
  assert.match(route, /params: \{ slug \}/,
    'each event needs its own coverage feed, not one shared route');
});

console.log('\none matcher, two callers');

test('neither page hand-rolls its own matching any more', () => {
  const pages = [
    ['events/[slug].astro', join('src', 'pages', 'events', '[slug].astro')],
    ['featured/[slug].astro', join('src', 'pages', 'featured', '[slug].astro')],
  ];
  for (const [label, rel] of pages) {
    const code = stripComments(readSrc(rel));
    assert.match(code, /collectHubCoverage\(\{/, `${label} must use the shared matcher`);
    assert.ok(
      !/\.toLowerCase\(\)\.includes\(/.test(code),
      `${label} is substring-matching again. That is the leak: it claims any item whose prose ` +
        'happens to contain the tag, and it is why event pages showed zero articles.',
    );
  }
});

test('shorts and live streams are excluded at every call site, visibly', () => {
  /*
    The hub page always excluded them; the event page merged them in. One had
    to give, and the coverage grid is the long-form reading list. The
    exclusion lives at the CALL SITE rather than inside collectHubCoverage so
    it stays a visible decision — and so the overflow feed cannot quietly
    list something the page it overflows from would not have shown.
  */
  const sites = [
    ['featured/[slug].astro', join('src', 'pages', 'featured', '[slug].astro')],
    ['events/[slug].astro', join('src', 'pages', 'events', '[slug].astro')],
    ['events/[slug]/coverage/[...page].astro',
      join('src', 'pages', 'events', '[slug]', 'coverage', '[...page].astro')],
  ];

  /*
    The event page and its overflow feed MUST build the same list, or page 2
    of the feed starts in the wrong place: the page slices the first six off
    a set the feed then re-derives. Identical inputs is the only thing
    keeping those two derivations in step.
  */
  for (const [label, rel] of sites) {
    const code = stripComments(readSrc(rel));
    assert.match(code, /!v\.isShort && !v\.isLive/,
      `${label} must filter shorts and live streams out before matching`);
  }

  const eventPage = stripComments(readSrc('src', 'pages', 'events', '[slug].astro'));
  assert.ok(
    !/getShortsUnified|getLiveStreamsUnified/.test(eventPage),
    'the event page is merging shorts and live streams into coverage again, which is the ' +
      'inconsistency with /featured/[slug] this replaced',
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
