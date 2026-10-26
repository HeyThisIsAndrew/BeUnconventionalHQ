import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePostHtml, fetchPostsApi, fetchPostsHtml, fetchAllPosts } from './substack-source.mjs';
import { relayPosts } from './substack-relay.mjs';
import { runArticleSync, planArticleSync, parsePostsResponse } from './sync-articles.mjs';

const POST = {
  id: 222226709, slug: 'clayface-review', title: 'Clayface Review',
  canonical_url: 'https://beunconventionalhq.substack.com/p/clayface-review',
  post_date: '2026-10-26T18:00:00.000Z', subtitle: 'A film review.',
  postTags: [{ name: 'Movie' }, { name: 'Review' }, { name: 'DCU' }],
  body_html: `<p>${'This is the full public article body. '.repeat(100)}</p>`,
};
const LOG = { log() {}, warn() {}, error() {} };
const response = posts => JSON.stringify(posts);
const payload = post => JSON.stringify({ post });

test('extracts the current preloads-json format that broke the real scraper', () => {
  const html = `<script nonce="abc" id="preloads-json" type="application/json">${payload(POST)}</script>
    <script>window._preloads = JSON.parse(document.querySelector('script#preloads-json[type="application/json"]').textContent)</script>`;
  assert.deepEqual(parsePostHtml(html), POST);
});

test('legacy JSON.parse supports whitespace, quotes, backslashes and a trailing backslash', () => {
  const post = { ...POST, subtitle: 'A "quoted" title ending with \\' };
  const html = `<script>window._preloads   = JSON.parse( ${JSON.stringify(payload(post))} )</script>`;
  assert.deepEqual(parsePostHtml(html), post);
});

test('HTML challenges, invalid JSON and executable lookalikes fail without executing code', () => {
  for (const html of [
    '<title>Just a moment...</title>',
    '<script id="preloads-json">broken</script>',
    '<script id="preloads-json">{}</script>',
    'window._preloads = JSON.parse(globalThis.shouldNeverRun = true)',
  ]) assert.throws(() => parsePostHtml(html));
  assert.equal(globalThis.shouldNeverRun, undefined);
});

test('posts API walks the archive beyond the RSS window using offset', async () => {
  const urls = [];
  const result = await fetchPostsApi({ request: async url => {
    urls.push(new URL(url));
    return response(urls.length === 1 ? Array.from({ length: 50 }, (_, i) => ({ ...POST, id: i + 1 })) : [{ ...POST, id: 51 }]);
  } });
  assert.equal(result.posts.length, 51);
  assert.equal(result.pages, 2);
  assert.deepEqual(urls.map(u => u.searchParams.get('offset')), ['0', '50']);
});

test('empty, incomplete, repeated and mid-pagination failures cannot masquerade as success', async () => {
  for (const body of [[], {}, [{ ...POST, postTags: undefined }], [{ ...POST, post_date: 'bad' }]]) {
    await assert.rejects(fetchPostsApi({ request: async () => response(body) }));
  }
  await assert.rejects(fetchPostsApi({ request: async () => response(Array.from({ length: 50 }, () => POST)) }), /repeated/);
  let calls = 0;
  await assert.rejects(fetchPostsApi({ request: async () => {
    if (calls++) throw new Error('network unavailable');
    return response(Array.from({ length: 50 }, (_, i) => ({ ...POST, id: i + 1 })));
  } }), /network unavailable/);
});

test('GitHub 403 falls back to the owned relay with full tags and body', async () => {
  const urls = [];
  const result = await fetchAllPosts({ warn() {}, request: async url => {
    urls.push(url);
    if (url.includes('.substack.com/')) throw new Error('HTTP 403');
    return response([POST]);
  } });
  assert.equal(result.source, 'Cloudflare relay');
  assert.deepEqual(result.posts, [POST]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\/posts\?offset=0$/);
});

test('RSS + HTML fallback uses complete metadata, never tagless RSS bodies', async () => {
  const result = await fetchPostsHtml({ request: async url => url.endsWith('/feed')
    ? `<rss><channel><item><link>${POST.canonical_url}</link></item></channel></rss>`
    : `<script type='application/json' id='preloads-json'>${payload(POST)}</script>`,
  });
  assert.deepEqual(result.posts, [POST]);
  await assert.rejects(fetchPostsHtml({ request: async () => '<rss><channel/></rss>' }), /no items/);
  await assert.rejects(fetchPostsHtml({ request: async () => '<rss><channel><item><link>https://evil.example/p/x</link></item></channel></rss>' }), /unexpected/);
});

test('all sources failing rejects, including 200 HTML challenges from a relay', async () => {
  await assert.rejects(fetchAllPosts({ warn() {}, request: async () => '<title>Just a moment...</title>' }), /All article sources failed/);
});

test('relay accepts only bounded fixed-publication requests and never forwards credentials', async () => {
  let calls = 0;
  for (const [url, status] of [
    ['https://relay.test/other', 404], ['https://relay.test/posts?url=https://evil.test', 400],
    ['https://relay.test/posts?offset=-1', 400], ['https://relay.test/posts?offset=1', 400],
    ['https://relay.test/posts?offset=5050', 400], ['https://relay.test/posts?offset=0&offset=50', 400],
  ]) {
    const result = await relayPosts(new Request(url), { fetchUpstream: async () => { calls++; } });
    assert.equal(result.status, status);
  }
  assert.equal(calls, 0);
  const result = await relayPosts(new Request('https://relay.test/posts?offset=50', {
    headers: { Authorization: 'secret', Cookie: 'secret' },
  }), { fetchUpstream: async (url, options) => {
    assert.equal(url, 'https://beunconventionalhq.substack.com/api/v1/posts?limit=50&offset=50');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    return Response.json([POST]);
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), [POST]);
});

test('relay caches valid public posts and never caches blocked or invalid responses', async () => {
  const writes = [];
  const cache = { match: async () => undefined, put: async (...args) => { writes.push(args); } };
  const request = new Request('https://relay.test/posts');
  const ok = await relayPosts(request, { cache, fetchUpstream: async () => Response.json([POST]) });
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(writes.length, 1);
  for (const upstream of [new Response('Blocked', { status: 403 }), Response.json({ error: 'bad' })]) {
    const failed = await relayPosts(request, { cache, fetchUpstream: async () => upstream });
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
  }
  assert.equal(writes.length, 1);
  const cached = await relayPosts(request, { cache: { match: async () => ok }, fetchUpstream: async () => { throw new Error('must use cache'); } });
  assert.equal(cached, ok);
});

test('snapshot updates publish new articles, preserve archive/editorial data, and are idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-article-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshotFile = path.join(dir, 'articles.json');
  const existing = planArticleSync(parsePostsResponse([{ ...POST, id: 1, slug: 'older', canonical_url: 'https://beunconventionalhq.substack.com/p/older' }]), []).merged;
  existing[0].editorial = { featured: true };
  fs.writeFileSync(snapshotFile, response(existing));
  const fetchPosts = async () => ({ posts: [POST], pages: 1, source: 'fixture' });
  const first = await runArticleSync({ execute: true, snapshotFile, fetchPosts, log: LOG, now: new Date('2026-10-26T18:00:00Z') });
  assert.equal(first.ok, true);
  assert.equal(first.added, 1);
  const saved = fs.readFileSync(snapshotFile, 'utf8');
  const records = JSON.parse(saved);
  assert.equal(records.length, 2);
  assert.deepEqual(records.find(r => r.slug === 'older').editorial, { featured: true });
  assert.equal(records.find(r => r.slug === POST.slug).hasBody, true);
  assert.deepEqual(records.find(r => r.slug === POST.slug).tags, ['Movie', 'Review', 'DCU']);
  const stat = fs.statSync(snapshotFile).mtimeMs;
  const second = await runArticleSync({ execute: true, snapshotFile, fetchPosts, log: LOG, now: new Date('2026-10-27T18:00:00Z') });
  assert.equal(second.updated, 0);
  assert.equal(fs.readFileSync(snapshotFile, 'utf8'), saved);
  assert.equal(fs.statSync(snapshotFile).mtimeMs, stat);
});

test('sync failure and zero extracted posts leave snapshots byte-identical and report failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-article-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshotFile = path.join(dir, 'articles.json');
  for (const original of ['[]\n', response(planArticleSync(parsePostsResponse([POST]), []).merged), '{invalid']) {
    fs.writeFileSync(snapshotFile, original);
    for (const fetchPosts of [async () => { throw new Error('HTTP 403'); }, async () => ({ posts: [], pages: 1 })]) {
      const result = await runArticleSync({ execute: true, snapshotFile, fetchPosts, log: LOG });
      assert.equal(result.ok, false);
      assert.equal(fs.readFileSync(snapshotFile, 'utf8'), original);
    }
  }
});

test('dry run writes nothing; write lock re-reads concurrent editorial updates', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-article-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshotFile = path.join(dir, 'articles.json');
  const existing = planArticleSync(parsePostsResponse([POST]), []).merged;
  fs.writeFileSync(snapshotFile, response(existing));
  const fetchPosts = async () => ({ posts: [{ ...POST, title: 'Retitled' }], pages: 1 });
  assert.equal((await runArticleSync({ snapshotFile, fetchPosts, log: LOG })).ok, true);
  assert.equal(fs.readFileSync(snapshotFile, 'utf8'), response(existing));
  await runArticleSync({ execute: true, snapshotFile, log: LOG, fetchPosts: async () => {
    existing[0].editorial = { featured: true };
    fs.writeFileSync(snapshotFile, response(existing));
    return fetchPosts();
  } });
  const saved = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  assert.deepEqual(saved[0].editorial, { featured: true });
  assert.equal(saved[0].title, 'Retitled');
  assert.deepEqual(fs.readdirSync(dir), ['articles.json']);
});
