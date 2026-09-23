/**
 * The homepage content model (src/lib/homepage-feed.ts).
 *
 * The previous homepage attempt white-screened on date math over an empty
 * array. These assert the builder survives every empty or malformed input it
 * can be handed, never repeats a story, and only ever emits copy it was given.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHomepageFeed,
  mapArticle,
  mapVideo,
  toTime,
  formatDuration,
  readTimeFromHtml,
  normalizeCategory,
  pickPullQuote,
} from '../src/lib/homepage-feed.ts';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    process.exitCode = 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
};

const deps = {
  timeZone: 'America/Los_Angeles',
  articleHref: (a) => (a.slug ? `/intel/${a.slug}` : ''),
  isExternalArticle: () => false,
  articleImage: (raw) => ({ src: raw, srcset: '' }),
  videoImage: (raw) => ({ src: raw, srcset: '' }),
};

const art = (n, over = {}) =>
  mapArticle(
    {
      guid: `g${n}`,
      slug: `a${n}`,
      title: `Article ${n}`,
      excerpt: `Deck ${n}`,
      image: `https://img/${n}.jpg`,
      category: 'Film',
      contentType: 'Review',
      isoDate: `2026-09-${String(10 + n).padStart(2, '0')}T12:00:00Z`,
      tags: [],
      bodyHtml: '<p>word</p>',
      ...over,
    },
    deps,
  );
const vid = (n, over = {}) =>
  mapVideo(
    {
      youtubeId: `v${n}`,
      title: `Video ${n}`,
      description: 'First line here. Second line.',
      thumbnail: `https://i.ytimg.com/vi/v${n}/hqdefault.jpg`,
      category: 'TV',
      publishedAt: `2026-08-${String(10 + n).padStart(2, '0')}T12:00:00Z`,
      durationSeconds: 768,
      ...over,
    },
    deps,
  );

test('empty stores build an empty page, not a crash', () => {
  const feed = buildHomepageFeed([], [], { featured: { title: 'Lanterns', match: 'lanterns' } });
  assert.deepEqual(feed.hero, []);
  assert.equal(feed.intel.lead, null);
  assert.deepEqual(feed.intel.orbit, []);
  assert.equal(feed.featured, null);
  assert.equal(feed.quote, null);
  assert.deepEqual(feed.rail, []);
});

test('non-array and null inputs are tolerated', () => {
  assert.doesNotThrow(() => buildHomepageFeed(undefined, null));
  assert.doesNotThrow(() => buildHomepageFeed([null, undefined], [null]));
});

test('unparseable dates never produce Invalid Date', () => {
  assert.equal(toTime('not a date'), 0);
  assert.equal(toTime(undefined), 0);
  assert.equal(toTime(''), 0);
  const a = art(1, { isoDate: 'garbage' });
  assert.equal(a.publishDate, '');
  assert.equal(a.displayDate, '');
  assert.doesNotThrow(() => buildHomepageFeed([a], []));
});

test('mappers reject records with no title or no destination', () => {
  assert.equal(art(1, { title: '' }), null);
  assert.equal(art(1, { slug: '' }), null);
  assert.equal(vid(1, { youtubeId: '' }), null);
  assert.equal(vid(1, { isShort: true }), null, 'the rail is long-form only');
});

test('no story appears in two sections', () => {
  const articles = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    art(n, { category: ['Film', 'TV', 'Games', 'Events'][n % 4], tags: n < 3 ? ['Lanterns'] : [] }),
  );
  const videos = [1, 2, 3, 4, 5, 6].map((n) => vid(n, { title: n < 3 ? `Lanterns ep ${n}` : `Video ${n}` }));
  const feed = buildHomepageFeed(articles, videos, { featured: { title: 'Lanterns', match: 'lanterns' } });
  const ids = [
    ...feed.hero.map((p) => p.story.id),
    feed.intel.lead?.id,
    ...feed.intel.orbit.map((s) => s.id),
    feed.featured?.lead.id,
    ...(feed.featured?.items ?? []).map((s) => s.id),
    ...feed.rail.map((s) => s.id),
  ].filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `duplicate in ${ids.join(', ')}`);
});

test('hero panels keep the fixed order and LATEST is the newest story', () => {
  const articles = [
    art(1, { category: 'Film' }),
    art(2, { category: 'TV' }),
    art(3, { category: 'Games' }),
    art(4, { category: 'Events' }),
    art(5, { category: 'Film' }),
  ];
  const feed = buildHomepageFeed(articles, []);
  assert.deepEqual(feed.hero.map((p) => p.key), ['film', 'tv', 'games', 'events', 'latest']);
  const latest = feed.hero.at(-1);
  assert.equal(latest.story.id, 'article:g5');
  assert.equal(latest.isNew, true);
});

test('a category with no stories drops its panel instead of rendering empty', () => {
  const feed = buildHomepageFeed([art(1, { category: 'Film' }), art(2, { category: 'Film' })], []);
  assert.deepEqual(feed.hero.map((p) => p.key), ['film', 'latest']);
});

test('featured world matches whole words only and needs art for its lead', () => {
  const articles = [art(1, { title: 'Lanternsmith weekly' }), art(2, { tags: ['Lanterns'] })];
  const feed = buildHomepageFeed(articles, [], { featured: { title: 'Lanterns', match: 'lanterns' } });
  assert.equal(feed.featured.lead.id, 'article:g2');
  assert.equal(feed.featured.total, 1);
  const none = buildHomepageFeed([art(3)], [], { featured: { title: 'Lanterns', match: 'lanterns' } });
  assert.equal(none.featured, null, 'no matching story means no section');
});

test('pull quote is a verbatim sentence from the source, never with an em dash', () => {
  const long = 'This sentence is long enough to be a pull quote on the homepage for sure.';
  const s = art(1, { preview: [`Short. Here is one — with a dash that is long enough to qualify as a quote. ${long}`] });
  const q = pickPullQuote([s]);
  assert.equal(q.text, long);
  assert.ok(s.paragraphs[0].includes(q.text));
  assert.equal(pickPullQuote([art(2, { preview: ['Too short.'] })]), null);
});

test('formatting helpers', () => {
  assert.equal(formatDuration(768), '12:48');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration('x'), '');
  assert.equal(readTimeFromHtml(''), '');
  assert.equal(readTimeFromHtml('<p>' + 'word '.repeat(460) + '</p>'), '2 min read');
  assert.equal(normalizeCategory('Gaming'), 'Games');
  assert.equal(normalizeCategory('General'), null);
});

test('the homepage sources its copy from the content module, not literals', () => {
  const page = fs.readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(page, /getHomepageFeed/, 'index.astro must read from src/data/homepage-feed.ts');
});

test('the homepage does not mount the splash hero', () => {
  const page = fs.readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /import Hero from/, 'the splash is sunset; Hero.astro stays on disk, unmounted');
});

console.log(process.exitCode ? `FAILED (${passed} passed)` : `All ${passed} tests passed.`);
