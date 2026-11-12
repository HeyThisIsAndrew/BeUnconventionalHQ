import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLatestPosts,
  cleanHeadline,
  decodeHtmlEntities,
  formatLatestPostImage,
  toAbsoluteHttpsUrl,
} from '../src/lib/latest-posts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArticles = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/articles.json'), 'utf8'));
const rawVideos = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/videos.json'), 'utf8'));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failed++;
  }
}

console.log('Latest Posts API & Query:');

await test('cleanHeadline decodes HTML entities and strips tags cleanly', () => {
  assert.equal(
    cleanHeadline('Avengers: Doomsday &amp; The Multiverse'),
    'Avengers: Doomsday & The Multiverse',
  );
  assert.equal(
    cleanHeadline('You&apos;re Welcome &amp;apos; Double Encoded'),
    "You're Welcome ' Double Encoded",
  );
  assert.equal(
    cleanHeadline('Godzilla &#8217;Minus Zero&#8217; &quot;Exclusive&quot;'),
    'Godzilla ’Minus Zero’ "Exclusive"',
  );
  assert.equal(
    cleanHeadline('<b>Breaking:</b> New DCU <i>Trailer</i> &lt;Drop&gt;'),
    'Breaking: New DCU Trailer <Drop>',
  );
  assert.equal(cleanHeadline('   Collapsing    extra   whitespace   '), 'Collapsing extra whitespace');
});

await test('decodeHtmlEntities handles numeric, hex, and named entities', () => {
  assert.equal(decodeHtmlEntities('&amp;'), '&');
  assert.equal(decodeHtmlEntities('&#38;'), '&');
  assert.equal(decodeHtmlEntities('&#x26;'), '&');
  assert.equal(decodeHtmlEntities('&quot;Hello&quot;'), '"Hello"');
  assert.equal(decodeHtmlEntities('&#39;Single&#39;'), "'Single'");
});

await test('toAbsoluteHttpsUrl converts relative or http paths to https absolute URLs', () => {
  assert.equal(
    toAbsoluteHttpsUrl('/intel/test-slug', 'https://beunconventionalhq.com'),
    'https://beunconventionalhq.com/intel/test-slug',
  );
  assert.equal(
    toAbsoluteHttpsUrl('http://example.com/image.jpg', 'https://beunconventionalhq.com'),
    'https://example.com/image.jpg',
  );
  assert.equal(
    toAbsoluteHttpsUrl('', 'https://beunconventionalhq.com'),
    'https://beunconventionalhq.com/og-image.png',
  );
});

await test('formatLatestPostImage parses src and candidates', () => {
  const result = formatLatestPostImage(
    'https://i.ytimg.com/vi/twsiOG7P1jk/maxresdefault.jpg',
    'https://beunconventionalhq.com',
  );
  assert.ok(result.src.startsWith('https://'), 'src must be https');
  assert.ok(Array.isArray(result.candidates), 'candidates must be array');
  for (const candidate of result.candidates) {
    assert.ok(candidate.src.startsWith('https://'), 'candidate src must be https');
    assert.ok(Number.isInteger(candidate.width) && candidate.width > 0, 'candidate width must be positive int');
  }

  // Fallback test
  const empty = formatLatestPostImage('', 'https://beunconventionalhq.com');
  assert.equal(empty.src, 'https://beunconventionalhq.com/og-image.png');
  assert.deepEqual(empty.candidates, []);
});

await test('buildLatestPosts with real repository data returns exactly 2 newest items conforming to schema', async () => {
  const payload = await buildLatestPosts({
    siteUrl: 'https://beunconventionalhq.com',
    articles: rawArticles,
    videos: rawVideos,
  });

  assert.equal(payload.version, 1, 'payload version must be 1');
  assert.ok(Array.isArray(payload.items), 'items must be an array');
  assert.equal(payload.items.length, 2, 'items must have exactly 2 pieces');

  const kinds = payload.items.map((i) => i.kind);
  assert.ok(kinds.includes('article'), 'must identify latest Article');
  assert.ok(kinds.includes('video'), 'must identify latest Video');

  // Verify chronological sort descending
  const t0 = new Date(payload.items[0].publishedAt).getTime();
  const t1 = new Date(payload.items[1].publishedAt).getTime();
  assert.ok(t0 >= t1, 'items must be sorted chronologically descending by publishedAt');

  for (const item of payload.items) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0, 'id must be non-empty string');
    assert.ok(item.kind === 'article' || item.kind === 'video', 'kind must be article or video');
    assert.ok(typeof item.title === 'string' && item.title.length > 0, 'title must be non-empty string');
    assert.ok(item.url.startsWith('https://'), 'url must be absolute https URL');
    assert.ok(!Number.isNaN(Date.parse(item.publishedAt)), 'publishedAt must be valid date');
    assert.equal(item.publishedAt, new Date(item.publishedAt).toISOString(), 'publishedAt must be ISO 8601');

    assert.ok(item.image, 'image must exist');
    assert.ok(item.image.src.startsWith('https://'), 'image.src must be https');
    assert.ok(Array.isArray(item.image.candidates), 'image.candidates must be array');
  }
});

await test('buildLatestPosts fallback when only one type is available', async () => {
  const mockArticles = [
    {
      slug: 'older-article',
      title: 'Older Article',
      date: '2026-11-01T00:00:00.000Z',
      hasBody: true,
      image: 'https://beunconventionalhq.com/img1.jpg',
    },
    {
      slug: 'newer-article',
      title: 'Newer Article',
      date: '2026-11-05T00:00:00.000Z',
      hasBody: true,
      image: 'https://beunconventionalhq.com/img2.jpg',
    },
  ];

  // No videos
  const payloadOnlyArticles = await buildLatestPosts({
    articles: mockArticles,
    videos: [],
    now: Date.parse('2026-11-08T00:00:00.000Z'),
  });

  assert.equal(payloadOnlyArticles.items.length, 2);
  assert.equal(payloadOnlyArticles.items[0].id, 'newer-article');
  assert.equal(payloadOnlyArticles.items[1].id, 'older-article');
});

await test('buildLatestPosts filters out hidden articles, reserved slugs, future dates, shorts, and livestreams', async () => {
  const mockArticles = [
    { slug: 'topic', title: 'Reserved Topic', date: '2026-11-05T00:00:00Z', hasBody: true },
    { slug: 'hidden-art', title: 'Hidden', date: '2026-11-05T00:00:00Z', hasBody: true, editorial: { hidden: true } },
    { slug: 'future-art', title: 'Future', date: '2026-11-20T00:00:00Z', hasBody: true },
    { slug: 'valid-art', title: 'Valid Article', date: '2026-11-02T00:00:00Z', hasBody: true },
  ];

  const mockVideos = [
    { youtubeId: 'short1', title: 'Short', publishedAt: '2026-11-06T00:00:00Z', isShort: true },
    { youtubeId: 'live1', title: 'Live', publishedAt: '2026-11-06T00:00:00Z', isLive: true },
    { youtubeId: 'future-vid', title: 'Future Video', publishedAt: '2026-11-20T00:00:00Z' },
    { youtubeId: 'valid-vid', title: 'Valid Video', publishedAt: '2026-11-01T00:00:00Z' },
  ];

  const payload = await buildLatestPosts({
    articles: mockArticles,
    videos: mockVideos,
    now: Date.parse('2026-11-08T00:00:00.000Z'),
  });

  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].id, 'valid-art');
  assert.equal(payload.items[1].id, 'valid-vid');
});

await test('src/pages/api/latest-posts.json.ts exports prerender=true and GET with required headers', () => {
  const routeSource = fs.readFileSync(path.join(ROOT, 'src/pages/api/latest-posts.json.ts'), 'utf8');
  assert.match(routeSource, /export\s+const\s+prerender\s*=\s*true/, 'endpoint must export prerender = true');
  assert.match(routeSource, /export\s+const\s+GET/, 'endpoint must export GET handler');
  assert.match(routeSource, /'Content-Type':\s*'application\/json'/, 'must set Content-Type: application/json');
  assert.match(routeSource, /'Access-Control-Allow-Origin':\s*'\*'/, 'must set Access-Control-Allow-Origin: *');
  assert.match(
    routeSource,
    /'Cache-Control':\s*'public,\s*max-age=3600,\s*stale-while-revalidate=86400'/,
    'must set Cache-Control: public, max-age=3600, stale-while-revalidate=86400',
  );
});

await test('public/_headers configures /api/latest-posts.json correctly', () => {
  const headersSource = fs.readFileSync(path.join(ROOT, 'public/_headers'), 'utf8');
  assert.match(headersSource, /\/api\/latest-posts\.json/, '_headers must include /api/latest-posts.json');
  assert.match(headersSource, /Access-Control-Allow-Origin:\s*\*/, '_headers must set Access-Control-Allow-Origin: *');
  assert.match(
    headersSource,
    /Cache-Control:\s*public,\s*max-age=3600,\s*stale-while-revalidate=86400/,
    '_headers must set Cache-Control: public, max-age=3600, stale-while-revalidate=86400',
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
