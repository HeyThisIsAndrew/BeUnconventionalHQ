/**
 * The curated Feed: one pass, each item consumed once.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 * Every row on /feed used to filter the same unpartitioned list independently,
 * so an item appeared once per taxonomy relationship it had. Measured on the
 * built page before this pass: 41 unique items, 160 placements, 3.9 average,
 * and NOT ONE item appeared only once.
 *
 * The relationships were never wrong. Rendering them as placements was.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeFeed,
  selectSeries,
  meetsEditorialBar,
  inSeries,
  seriesOf,
  itemType,
  idOf,
  byEditorialRecency,
  DEFAULT_BUDGETS,
} from '../src/lib/feed-composition.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

const videos = JSON.parse(read('src', 'data', 'videos.json'))
  .filter((v) => (v.manualTypeOverride || v._type) === 'video' && (v.contentStatus === 'published' || !v.contentStatus))
  .map((v) => ({ ...v, type: 'video', date: v.publishedAt }));
const articles = JSON.parse(read('src', 'data', 'articles.json')).map((a) => ({ ...a, type: 'article' }));
const corpus = [...videos, ...articles];

/** Every placement the composition produces, as ids. */
function placements(c) {
  return [
    ...(c.hero ? [c.hero] : []),
    ...(c.series?.items ?? []),
    ...c.latest,
    ...c.videos,
    ...c.articles,
  ].map(idOf);
}

test('no item is placed twice, on the real corpus', () => {
  const c = composeFeed(corpus);
  const all = placements(c);
  const unique = new Set(all);

  assert.equal(
    all.length,
    unique.size,
    `${all.length - unique.size} duplicate placements: ${all.filter((id, i) => all.indexOf(id) !== i).join(', ')}`,
  );

  /* The headline number this pass exists to move. */
  assert.ok(all.length / unique.size === 1, 'average placements per item must be exactly 1');
});

test('nothing below the editorial bar fills a curated slot', () => {
  const c = composeFeed(corpus);
  for (const item of [c.hero, ...(c.series?.items ?? []), ...c.latest, ...c.videos, ...c.articles].filter(Boolean)) {
    assert.ok(
      meetsEditorialBar(item),
      `"${String(item.title).slice(0, 44)}" (${itemType(item) || 'unclassified'}) should not fill a curated slot`,
    );
  }
});

test('the bar is on format, not on age', () => {
  const old = { title: 'x', date: '2020-01-01', coverageType: 'REVIEW', type: 'video' };
  const recent = { title: 'y', date: '2026-09-15', coverageType: 'VLOG', type: 'video' };
  assert.ok(meetsEditorialBar(old), 'a 2020 review still belongs on the front door');
  assert.ok(!meetsEditorialBar(recent), 'a vlog published yesterday does not');
});

test('featured lifts an item over the bar without relabelling it', () => {
  const reaction = { title: 'x', date: '2026-09-03', coverageType: 'REACTION', type: 'video' };
  assert.ok(!meetsEditorialBar(reaction));
  assert.ok(meetsEditorialBar({ ...reaction, featured: true }));
  assert.equal(itemType({ ...reaction, featured: true }), 'REACTION', 'curation must not change what it IS');
});

test('below-the-bar work is demoted from the Feed, never removed from the corpus', () => {
  /*
    The whole creator-era question. These stay in /feed/videos, in their
    categories and in search. They simply do not fill the front door.
  */
  const below = corpus.filter((i) => !meetsEditorialBar(i));
  assert.ok(below.length > 0, 'the corpus should still contain below-bar work');
  const placed = new Set(placements(composeFeed(corpus)));
  for (const item of below) {
    assert.ok(!placed.has(idOf(item)), `"${String(item.title).slice(0, 40)}" should not be on the curated Feed`);
  }
});

test('the featured series is chosen without knowing it is Lanterns', () => {
  const chosen = selectSeries(corpus);
  assert.ok(chosen, 'a series should be selectable from the real corpus');
  assert.equal(chosen.name, 'Lanterns');
  /* Either route is valid and the store decides which: Lanterns is explicitly
     flagged today, and was selected by the fallback before it was. The point of
     this test is that NEITHER route is a name written in the code. */
  assert.match(chosen.reason, /marked as the featured series|qualifying series/);

  /*
    CHECK THE CODE, NOT THE FILE. The comments in feed-composition.ts explain
    the bug they fixed using the real example, and naming it there is the point
    of a comment. What must not exist is a LINE OF CODE that knows the answer.
    Same trap headers-integrity.test.mjs documents: assert against the thing,
    not against a string that also appears in prose above it.
  */
  const code = read('src', 'lib', 'feed-composition.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(!/lanterns/i.test(code), 'no code in the composition may name the current series');

  /* And the same for the component that renders it. */
  const view = read('src', 'components', 'FeedGrid.astro')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.ok(!/lanterns/i.test(view), 'nor may the component that renders it');
  assert.ok(!/PRESTIGE_ROW/.test(view), 'the hardcoded tentpole row must be gone');
});

test('an explicit flag outranks recency, for any series', () => {
  /*
    §15: proved against all three series in the store, not only the one that
    happens to win today. The flag mirrors `forceSpotlightHero` on the events
    page: an editor marks one, and there is a sane default when nobody has.
  */
  for (const name of ['The Umbrella Academy', 'X-Men ’97']) {
    const members = corpus.filter((i) => inSeries(i, name));
    assert.ok(members.length > 0, `the corpus should contain ${name}`);
    /* CLEAR THE STORE'S OWN FLAG FIRST. The corpus carries a real one, and a
       test that plants a second proves only that two flags fight, not that the
       flag works. */
    const flagged = corpus.map((i) => ({
      ...i,
      featuredSeries: idOf(i) === idOf(members[0]),
    }));
    const chosen = selectSeries(flagged);
    assert.equal(chosen.name, name, `flagging a ${name} item should make it the featured series`);
    assert.match(chosen.reason, /marked as the featured series/);

    const c = composeFeed(flagged);
    assert.equal(c.series.name, name);
    assert.ok(c.series.items.length > 0, `${name} should render at least one piece`);
  }
});

test('a series needs a run and some substance, not just a name', () => {
  const single = [
    { _id: 'a', title: 'only one', date: '2026-09-15', coverageType: 'REVIEW', series: 'Solo', type: 'video' },
  ];
  assert.equal(selectSeries(single), null, 'one piece is not a series');

  const weak = [
    { _id: 'a', title: 'v1', date: '2026-09-15', coverageType: 'VLOG', series: 'Weak', type: 'video' },
    { _id: 'b', title: 'v2', date: '2026-09-14', coverageType: 'VLOG', series: 'Weak', type: 'video' },
  ];
  assert.equal(selectSeries(weak), null, 'two vlogs sharing a name must not take the most prominent shelf');
});

test('an article joins its series by tag, so a package is not video-only', () => {
  /*
    `series` is written on videos. Articles sync from Substack and carry no
    such field, so a series driven by that field alone would silently drop both
    Lanterns articles, which is the same defect the row filters had before
    matchesHub() learned to read article tags.
  */
  const c = composeFeed(corpus);
  const kinds = new Set(c.series.items.map((i) => i.type));
  assert.ok(kinds.has('video') && kinds.has('article'), 'the featured series must carry both media');

  const article = articles.find((a) => (a.tags ?? []).some((t) => String(t).toLowerCase() === 'lanterns'));
  assert.ok(article, 'the corpus should contain a tagged Lanterns article');
  assert.equal(seriesOf(article), '', 'it carries no series field');
  assert.ok(inSeries(article, 'Lanterns'), 'and still belongs to the series');
});

test('the whole series is consumed, so no overflow member reappears below it', () => {
  /*
    Lanterns has seven pieces and the shelf holds six. The seventh used to fall
    through into Latest and print a Lanterns review directly under a shelf
    headed Lanterns. No item repeated; the page did.
  */
  const c = composeFeed(corpus);
  const belowSeries = [...c.latest, ...c.videos, ...c.articles];
  for (const item of belowSeries) {
    assert.ok(
      !inSeries(item, c.series.name),
      `"${String(item.title).slice(0, 44)}" belongs to the featured series and must not repeat it`,
    );
  }
});

test('budgets are ceilings, never quotas', () => {
  const thin = [
    { _id: 'a', title: 'one', date: '2026-09-15', coverageType: 'REVIEW', type: 'article' },
    { _id: 'b', title: 'two', date: '2026-09-14', coverageType: 'VLOG', type: 'video' },
  ];
  const c = composeFeed(thin);
  assert.equal(c.hero.title, 'one', 'the one substantive piece leads');
  assert.deepEqual(c.latest, [], 'nothing left that belongs, so nothing is shown');
  assert.deepEqual(c.videos, [], 'the vlog is NOT used to fill the video rail');
  assert.deepEqual(c.articles, []);
  assert.ok(c.underCapacity.length > 0, 'and the shortfall is reported rather than hidden');
});

test('an empty corpus composes to nothing rather than throwing', () => {
  const c = composeFeed([]);
  assert.equal(c.hero, null);
  assert.equal(c.series, null);
  assert.deepEqual([c.latest, c.videos, c.articles], [[], [], []]);
  assert.deepEqual(composeFeed(null).latest, [], 'a null list must not throw either');
});

test('no featured series at all still composes a Feed', () => {
  const noSeries = corpus.map((i) => {
    const { series, ...rest } = i;
    return { ...rest, tags: (i.tags ?? []).filter((t) => String(t).toLowerCase() !== 'lanterns'),
             youtubeTags: (i.youtubeTags ?? []).filter((t) => String(t).toLowerCase() !== 'lanterns') };
  });
  const c = composeFeed(noSeries);
  assert.equal(c.series, null, 'no series qualifies');
  assert.ok(c.hero, 'the hero still fills');
  assert.ok(c.latest.length > 0, 'and Latest picks up what the shelf would have taken');
  const all = placements(c);
  assert.equal(all.length, new Set(all).size, 'still no duplicates');
});

test('a featured item with no series does not invent one', () => {
  const c = composeFeed(corpus);
  assert.equal(seriesOf(c.hero), '', 'today the featured item is a standalone piece');
  assert.ok(c.series, 'which must not stop a series being selected for the shelf');
  assert.notEqual(c.series.name, '', 'nor produce an unnamed shelf');
});

test('items with no brand, no excerpt or only a coverage type still place', () => {
  const sparse = [
    { _id: 'a', title: 'only a coverage type', date: '2026-09-15', coverageType: 'REVIEW', type: 'video' },
    { _id: 'b', title: 'no brand and no excerpt', date: '2026-09-14', coverageType: 'ANALYSIS', type: 'article' },
  ];
  const c = composeFeed(sparse);
  assert.equal(idOf(c.hero), 'a');
  assert.equal(c.articles.length + c.latest.length, 1, 'the second places exactly once');
});

test('an editor sort weight survives into the Feed', () => {
  /*
    getAllArticles() sorts by editorial.sortWeight, and that ordering used to be
    discarded the moment articles were merged with videos and re-sorted on date.
  */
  const older = { _id: 'old', title: 'weighted', date: '2026-01-01', coverageType: 'REVIEW', type: 'article', editorial: { sortWeight: 10 } };
  const newer = { _id: 'new', title: 'unweighted', date: '2026-09-15', coverageType: 'REVIEW', type: 'article' };
  assert.deepEqual([older, newer].sort(byEditorialRecency).map(idOf), ['old', 'new']);
  assert.equal(composeFeed([newer, older]).hero.title, 'weighted');
});

test('retired and unpublished content never reaches the composition', () => {
  /*
    Guarded at the SOURCE, not here: the feed item builders filter on
    contentStatus before composition ever sees a document. Asserted so that a
    change to that filter fails loudly rather than leaking a retired duplicate.
  */
  const store = JSON.parse(read('src', 'data', 'videos.json'));
  const retired = store.filter((v) => v._type === 'video' && v.contentStatus !== 'published');
  assert.ok(retired.length > 0, 'the store should still hold the retired duplicate');
  const ids = new Set(corpus.map((i) => i._id));
  for (const doc of retired) assert.ok(!ids.has(doc._id), 'retired content must not enter the feed corpus');

  const source = read('src', 'lib', 'videos-source.ts');
  assert.match(source, /contentStatus === "published"/, 'the published gate must stay at the source');
});

test('budgets are the documented ones', () => {
  assert.deepEqual(DEFAULT_BUDGETS, { featuredSeries: 6, latest: 8, videos: 6, articles: 6 });
});

test('each mode is asked about its own content', () => {
  /*
    The empty state read `!hasRows`, and `hasRows` is false on the curated Feed
    BY DESIGN: that mode builds no archive sections at all. A fully populated
    front door printed "No content found" under its last row.
  */
  const grid = read('src', 'components', 'FeedGrid.astro');
  assert.match(
    grid,
    /\{\(isCurated \? !hasCuratedContent : !hasRows\) && \(/,
    'the empty state must ask the question that fits the mode it is in',
  );
  assert.match(grid, /const hasRows = !isCurated &&/, 'archive rows are not built in curated mode');
});

test('the archive routes keep every row, and the curated Feed builds none of them', () => {
  /*
    §7: the Feed becomes curated, the archives stay comprehensive. Those are two
    jobs, so they are two modes rather than one render with a filter.
  */
  const grid = read('src', 'components', 'FeedGrid.astro');
  assert.match(grid, /mode\?: 'rows' \| 'curated'/, 'the two jobs are declared');
  assert.match(grid, /SECTION_DEFS/, 'the archive section definitions must survive');

  for (const route of ['videos', 'articles']) {
    const page = read('src', 'pages', 'feed', route, 'index.astro');
    assert.ok(!/mode="curated"/.test(page), `/feed/${route} must stay a complete archive`);
  }
  const feed = read('src', 'pages', 'feed', 'index.astro');
  assert.match(feed, /mode="curated"/, '/feed must be the curated one');
  assert.match(feed, /composeFeed\(allItems\)/, 'and must compose rather than query');
});

test('the hero is inside the consuming pass', () => {
  /*
    It used to pick `videos[0]` itself, so the largest element on the page was
    chosen by one rule and every row below it by another, and the item it chose
    was free to appear again below. It also meant the hero could never lead with
    an article, because it only ever looked at the video list.
  */
  const feed = read('src', 'pages', 'feed', 'index.astro');
  assert.match(feed, /item=\{composition\.hero\}/, '/feed must hand the hero its item');

  const hero = read('src', 'components', 'FeedSpotlightHero.astro');
  assert.match(hero, /item \|\| videos\[0\]/, 'and the hero must prefer it, keeping the old default elsewhere');
});

test('the shelf is themed for the SHOW, with two real fallbacks under it', () => {
  /*
    A series is not its hub. Lanterns is a DC property and DC's brandColor is
    blue, but the show's identity is emerald and this shelf IS the show. The
    accent resolves seriesAccent -> hub brandColor -> site accent, and the last
    rung exists so the featured shelf is ALWAYS lit: an unlit row is correct for
    an ordinary row whose brand is white, and wrong under a banner and a lockup.
  */
  const grid = read('src', 'components', 'FeedGrid.astro');

  assert.match(grid, /const fromSeries = seriesRow\?\.items/, 'rung 1: the series own accent');
  assert.match(grid, /const hex = fromSeries \|\| usableHub \|\| SITE_ACCENT;/, 'in that order');
  assert.match(grid, /const SITE_ACCENT = '#cc0000';/, 'rung 3 is a real colour, not undefined');
  assert.match(
    grid,
    /hubHex\.toLowerCase\(\) !== '#ffffff'/,
    'a white brandColor is skipped: over near-black it is fog, not an accent',
  );
  /* The shelf is unconditionally accented now, so no data shape can produce the
     half-state of a banner and lockup with no wash under them. */
  assert.match(grid, /class="feed-row feed-row--prestige feed-row--accented"/);
  assert.ok(
    !/'feed-row--accented': Boolean\(seriesAccent/.test(grid),
    'the featured shelf must not be conditionally lit',
  );

  /* And the accent must be read from ANY member, so it survives the flagged
     item changing or being retired. */
  const members = corpus.filter((i) => inSeries(i, 'Lanterns') && i.seriesAccent);
  assert.ok(members.length > 1, 'the accent should be on the series, not on one document');
});

test('the type tint is derived from the accent, not written for one show', () => {
  /*
    The eyebrow, title, divider and hub link carried literal mint hexes
    (#d7f7e6, #eafff4) sampled from ONE show's key art. A shelf that can point
    anywhere cannot keep a colour that suits only one series: the day it pointed
    elsewhere, the mint would have stayed and read as a bug with no cause.
  */
  /* CHECK THE CODE, NOT THE FILE: the comment above these rules names the hexes
     it removed, and naming them there is the point of a comment. */
  const grid = read('src', 'components', 'FeedGrid.astro')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  for (const dead of ['#d7f7e6', '#eafff4', '215, 247, 230', '16, 185, 129']) {
    assert.ok(!grid.includes(dead), `${dead} is one show's colour hardcoded into the shelf`);
  }
  assert.ok(grid.split('color-mix').length - 1 >= 4, 'the tint should derive from --row-accent-rgb');
  /* Every color-mix must be preceded by a plain fallback declaration, or a
     browser without color-mix inherits instead of reading. */
  for (const line of grid.split('\n')) {
    if (!line.includes('color-mix')) continue;
    assert.match(line, /--row-accent-rgb, 204, 0, 0/, 'and must carry its own rgb fallback');
  }
});

test('featuredSeries selects a series and nothing else', () => {
  /*
    Strictly scoped. It must never become a second `featured`: one says this
    PIECE deserves placement, the other says this piece's SERIES owns the shelf.
  */
  const flagged = { _id: 'a', title: 'flagged', date: '2020-01-01', coverageType: 'REVIEW', type: 'video', series: 'Old', featuredSeries: true };
  const partner = { _id: 'b', title: 'partner', date: '2020-01-02', coverageType: 'REVIEW', type: 'video', series: 'Old' };
  const newer = { _id: 'c', title: 'newer', date: '2026-09-15', coverageType: 'REVIEW', type: 'video' };
  const c = composeFeed([flagged, partner, newer]);

  assert.equal(c.series.name, 'Old', 'an old series still wins when it is flagged');
  assert.equal(c.hero.title, 'newer', 'but the flag must NOT promote its item to the hero');
  assert.ok(!meetsEditorialBar({ ...flagged, coverageType: 'VLOG' }), 'nor lift it over the editorial bar');
});

test('the fallback does not require the flag to exist anywhere', () => {
  /* The documented hierarchy: explicit selection when one exists, otherwise the
     fallback, and never a hardcoded name. */
  const unflagged = corpus.map((i) => {
    const { featuredSeries, ...rest } = i;
    return rest;
  });
  assert.ok(!unflagged.some((i) => i.featuredSeries), 'no flag anywhere');
  const chosen = selectSeries(unflagged);
  assert.ok(chosen, 'a series is still selected');
  assert.match(chosen.reason, /no series is flagged/);
  assert.ok(composeFeed(unflagged).series.items.length > 0, 'and the shelf still renders');
});

console.log('\nFeed composition: all assertions ran.');
