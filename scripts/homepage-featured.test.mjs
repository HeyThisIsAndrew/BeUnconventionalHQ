import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickHomeFeatured, featuredKey, readHomeFeaturedSettings, HOME_FEATURED_SETTINGS_ID } from '../src/lib/homepage-featured-selection.ts';
import { buildHomepageFeed, mapVideo, mapArticle } from '../src/lib/homepage-feed.ts';
import { inSeries, byNewest } from '../src/lib/feed-rails.ts';

const episode = number => ({
  type: 'video', youtubeId: `episode-${number}`, title: `Lanterns Episode ${number} Review`,
  publishedAt: new Date(Date.UTC(2026, 9, 21 + number, 18)).toISOString(),
  thumbnail: `https://images.test/${number}.jpg`, category: 'TV', durationSeconds: 600,
  // The sync preserves editorial fields; new uploads do not inherit them.
  series: number <= 5 ? 'Lanterns' : '', featuredSeries: number === 5,
  youtubeTags: ['TV', 'lanterns', 'Review'],
});
const SERIES = { mode: 'series', series: 'Lanterns' };
const pickSeries = items => pickHomeFeatured(items, SERIES);
const ids = selection => selection.items.map(item => item.youtubeId);
const deps = {
  timeZone: 'America/Los_Angeles', articleHref: a => `/intel/${a.slug}`,
  isExternalArticle: () => false,
  articleImage: src => ({ src, srcset: '' }), videoImage: src => ({ src, srcset: '' }),
};

test('two consecutive new releases take the lead and evict only the oldest displayed episode', () => {
  const uploads = [1, 2, 3, 4, 5, 6].map(episode);
  assert.deepEqual(ids(pickSeries(uploads)), ['episode-6', 'episode-5', 'episode-4', 'episode-3']);
  uploads.push(episode(7));
  assert.deepEqual(ids(pickSeries(uploads)), ['episode-7', 'episode-6', 'episode-5', 'episode-4']);
  uploads.unshift(episode(8));
  assert.deepEqual(ids(pickSeries(uploads)), ['episode-8', 'episode-7', 'episode-6', 'episode-5']);
  assert.equal(pickSeries(uploads).total, 8, 'older episodes remain in the full collection');
});

test('new tag-matched uploads need no manual series or Featured flag', () => {
  const old = { ...episode(5), featured: true };
  const fresh = { ...episode(7), youtubeTags: ['TV', 'LANTERNS', 'Review'] };
  const unrelated = { ...episode(8), title: 'Other TV review', youtubeTags: ['TV'], series: '' };
  const result = pickSeries([old, unrelated, fresh]);
  assert.equal(result.title, 'Lanterns');
  assert.deepEqual(ids(result), ['episode-7', 'episode-5']);
});

test('two uploads on the same day use their real timestamps rather than display dates', () => {
  const earlier = { ...episode(7), date: 'October 28, 2026', publishedAt: '2026-10-28T18:00:00Z' };
  const later = { ...episode(8), date: 'October 28, 2026', publishedAt: '2026-10-28T20:00:00Z' };
  assert.deepEqual(ids(pickSeries([episode(5), earlier, later])), ['episode-8', 'episode-7', 'episode-5']);
  assert.equal(later.date, 'October 28, 2026', 'sorting must not change the date shown on the card');
});

test('the latest four videos stay ahead of articles in the selected series', () => {
  const article = { type: 'article', title: 'Lanterns analysis', link: '/intel/lanterns', tags: ['Lanterns'], date: '2026-11-01' };
  assert.deepEqual(ids(pickSeries([article, ...[1, 2, 3, 4, 5, 6].map(episode)])),
    ['episode-6', 'episode-5', 'episode-4', 'episode-3']);
});

test('Featured reservations survive both new releases without duplication in hero or rail', () => {
  for (const latest of [6, 7, 8]) {
    const uploads = Array.from({ length: latest }, (_, i) => episode(i + 1));
    const featured = pickSeries(uploads);
    const reservedKeys = new Set(featured.items.map(featuredKey));
    const videos = [...uploads, { ...episode(1), youtubeId: 'another-tv-story', title: 'Another TV story', youtubeTags: ['TV'], series: '' }]
      .map(item => mapVideo(item, deps));
    const feed = buildHomepageFeed([], videos, {
      reservedKeys, heroPicks: [`video:episode-${latest}`],
    });
    assert.ok(feed.hero.length > 0, 'the hero must choose another available story');
    for (const item of [...feed.hero.map(panel => panel.story), ...feed.rail]) {
      assert.ok(!reservedKeys.has(`video:${item.videoId}`), 'a Featured item was claimed again');
    }
    assert.equal(featured.items[0].youtubeId, `episode-${latest}`);
  }
});

test('article link reservations also protect the hero and Intel sections', () => {
  const article = mapArticle({ guid: 'reserved', slug: 'reserved', title: 'Reserved article', category: 'Film',
    isoDate: '2026-10-27T18:00:00Z', image: 'https://images.test/article.jpg', bodyHtml: '<p>Article</p>' }, deps);
  const feed = buildHomepageFeed([article], [mapVideo(episode(1), deps)], {
    reservedKeys: new Set(['/intel/reserved']),
  });
  assert.ok(feed.hero.every(panel => panel.story.id !== article.id));
  assert.equal(feed.intel.lead, null);
  assert.deepEqual(feed.intel.orbit, []);
});

test('the current published collection leads with its newest matching upload', () => {
  const store = JSON.parse(fs.readFileSync(new URL('../src/data/videos.json', import.meta.url), 'utf8'));
  const videos = store.filter(item => item._type === 'video' && item.contentStatus === 'published')
    .map(item => ({ ...item, type: 'video' }));
  const selected = pickHomeFeatured(videos, readHomeFeaturedSettings(store));
  assert.ok(selected);
  if (selected.kind === 'collection') {
    const matching = videos.filter(item => inSeries(item, selected.title)).sort(byNewest);
    assert.equal(selected.items[0].youtubeId, matching[0].youtubeId);
  }
  assert.ok(selected.items.length <= 4);
});

test('the site fallback and an empty store remain supported', () => {
  assert.equal(pickHomeFeatured([]), null);
  const items = [1, 2].map(n => ({ ...episode(n), series: '', youtubeTags: [], featuredSeries: false }));
  assert.equal(pickHomeFeatured(items).kind, 'site');
  assert.deepEqual(ids(pickHomeFeatured(items)), ['episode-2', 'episode-1']);
});


test('switching to a mix ignores Featured Series flags and never restricts picks to the lead series', () => {
  const uploads = [1, 2, 3, 4, 5, 6].map(episode);
  const highlight = { ...episode(1), featured: true };
  const other = { ...episode(7), youtubeId: 'film-highlight', series: 'Another show', youtubeTags: ['Film'], featured: true };
  const article = { type: 'article', title: 'Featured article', link: '/intel/pick', isoDate: '2026-10-29T18:00:00Z',
    editorial: { featured: true } };
  const pool = [...uploads, highlight, other, article];
  const result = pickHomeFeatured(pool, { mode: 'mixed', series: 'Lanterns' });
  assert.equal(result.kind, 'site');
  assert.equal(result.title, null);
  assert.deepEqual(result.items.map(featuredKey), ['/intel/pick', 'video:film-highlight', 'video:episode-1', 'video:episode-6']);
  assert.equal(pickSeries(pool).title, 'Lanterns', 'switching back restores automatic series rotation');
});

test('a different explicitly chosen series overrides all Feed flags and supports tag-only membership', () => {
  const newShow = [7, 8].map(n => ({ ...episode(n), series: '', youtubeTags: ['New Show'] }));
  const result = pickHomeFeatured([...newShow, episode(5)], { mode: 'series', series: ' New Show ' });
  assert.equal(result.title, 'New Show');
  assert.deepEqual(ids(result), ['episode-8', 'episode-7']);
});

test('blank or unavailable series falls back to a mix without selecting another series', () => {
  const pool = [episode(5), { ...episode(1), youtubeId: 'curated', featured: true, series: '', youtubeTags: [] }];
  for (const series of ['', '  ', 'Missing show']) {
    const result = pickHomeFeatured(pool, { mode: 'series', series });
    assert.equal(result.kind, 'site');
    assert.equal(result.items[0].youtubeId, 'curated');
  }
  assert.equal(pickHomeFeatured(pool).kind, 'site', 'no settings means a mix even with a flagged series');
});

test('the settings document survives serialization and preserves the chosen series while in mixed mode', () => {
  const doc = { _id: HOME_FEATURED_SETTINGS_ID, _type: 'homeFeaturedSettings', mode: 'mixed', series: ' Lanterns ' };
  assert.deepEqual(readHomeFeaturedSettings(JSON.parse(JSON.stringify([doc]))), { mode: 'mixed', series: 'Lanterns' });
  assert.deepEqual(readHomeFeaturedSettings([{ ...doc, mode: 'series' }]), SERIES);
  assert.deepEqual(readHomeFeaturedSettings([{ ...doc, mode: 'invalid', series: null }]), { mode: 'mixed', series: '' });
  assert.deepEqual(readHomeFeaturedSettings([]), { mode: 'mixed', series: '' });
});

test('mixed mode caps editorial picks at four and fills an uncurated section newest first', () => {
  const pool = [1, 2, 3, 4, 5, 6].map(n => ({ ...episode(n), featured: true }));
  assert.deepEqual(ids(pickHomeFeatured(pool)), ['episode-6', 'episode-5', 'episode-4', 'episode-3']);
  assert.deepEqual(ids(pickHomeFeatured(pool.map(item => ({ ...item, featured: false })))),
    ['episode-6', 'episode-5', 'episode-4', 'episode-3']);
});
