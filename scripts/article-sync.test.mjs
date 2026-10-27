import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePostHtml, fetchPostsApi, fetchPostsHtml, fetchPostsRelay, fetchAllPosts, fetchText } from './substack-source.mjs';
import relay, { relayPosts, ArticleSource } from './substack-relay.mjs';
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
const relayResponse = url => new Response(url.endsWith('/feed')
  ? `<rss><channel><item><link>${POST.canonical_url}</link></item></channel></rss>`
  : `<script id="preloads-json" type="application/json">${payload(POST)}</script>`);


test('transient source errors retry with backoff; a permanent challenge fails immediately', async () => {
  let calls = 0;
  const waits = [];
  const text = await fetchText('https://relay.test/posts', {
    fetchImpl: async () => ++calls < 3 ? new Response('Rate limited', { status: 429 }) : new Response('public posts'),
    sleep: async milliseconds => { waits.push(milliseconds); },
  });
  assert.equal(text, 'public posts');
  assert.deepEqual(waits, [2000, 4000]);
  calls = 0;
  await assert.rejects(fetchText('https://source.test/feed', {
    fetchImpl: async () => { calls++; return new Response('Challenge HTML', { status: 403 }); },
    sleep: async () => { throw new Error('must not retry 403'); },
  }), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(fetchText('https://relay.test/posts', {
    fetchImpl: async () => Response.json({ error: 'Substack returned HTTP 429 from /api/v1/archive' }, { status: 502 }),
    sleep: async () => {},
  }), /Substack returned HTTP 429 from \/api\/v1\/archive/);
});

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
    return response(urls.length === 1 ? Array.from({ length: 20 }, (_, i) => ({ ...POST, id: i + 1 })) : [{ ...POST, id: 21 }]);
  } });
  assert.equal(result.posts.length, 21);
  assert.equal(result.pages, 2);
  assert.deepEqual(urls.map(u => u.searchParams.get('offset')), ['0', '20']);
});

test('empty, incomplete, repeated and mid-pagination failures cannot masquerade as success', async () => {
  for (const body of [[], {}, [{ ...POST, postTags: undefined }], [{ ...POST, post_date: 'bad' }]]) {
    await assert.rejects(fetchPostsApi({ request: async () => response(body) }));
  }
  await assert.rejects(fetchPostsApi({ request: async () => response(Array.from({ length: 20 }, () => POST)) }), /repeated/);
  let calls = 0;
  await assert.rejects(fetchPostsApi({ request: async () => {
    if (calls++) throw new Error('network unavailable');
    return response(Array.from({ length: 20 }, (_, i) => ({ ...POST, id: i + 1 })));
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
    ['https://relay.test/posts?offset=2050', 400], ['https://relay.test/posts?offset=0&offset=20', 400],
  ]) {
    const result = await relayPosts(new Request(url), { fetchUpstream: async () => { calls++; } });
    assert.equal(result.status, status);
  }
  assert.equal(calls, 0);
  const result = await relayPosts(new Request('https://relay.test/posts?offset=0', {
    headers: { Authorization: 'secret', Cookie: 'secret' },
  }), { fetchUpstream: async (url, options) => {
    assert.ok(['https://beunconventionalhq.substack.com/feed', POST.canonical_url].includes(url));
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    return relayResponse(url);
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), [POST]);
});

test('relay caches valid public posts and never caches blocked or invalid responses', async () => {
  const writes = [];
  const cache = { match: async () => undefined, put: async (...args) => { writes.push(args); } };
  const request = new Request('https://relay.test/posts');
  const ok = await relayPosts(request, { cache, fetchUpstream: async url => relayResponse(url) });
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

test('regional source strips incoming headers and requests the same US object for every caller', async () => {
  let seen;
  const env = { ARTICLE_SOURCE: {
    idFromName: name => { assert.equal(name, 'hq-public-articles-v1'); return 'one-object'; },
    get: (id, options) => {
      assert.equal(id, 'one-object');
      assert.deepEqual(options, { locationHint: 'wnam' });
      return { fetch: async request => { seen = request; return new Response('source'); } };
    },
  } };
  await relay.fetch(new Request('https://relay.test/posts?offset=0', { headers: { 'X-Forwarded-For': 'runner', Authorization: 'never forward' } }), env);
  assert.equal(seen.url, 'https://article-source.internal/posts?offset=0');
  assert.equal([...seen.headers].length, 0);
});

test('source coalesces concurrent requests and shares its persisted cache across instances', async () => {
  const data = new Map();
  const state = { storage: { get: async key => data.get(key), put: async (key, value) => data.set(key, value) } };
  let calls = 0;
  const env = { FETCH_UPSTREAM: async url => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return relayResponse(url);
  } };
  const source = new ArticleSource(state, env);
  const request = () => new Request('https://article-source.internal/posts?offset=0');
  const results = await Promise.all(Array.from({ length: 10 }, () => source.fetch(request())));
  for (const result of results) assert.deepEqual(await result.json(), [POST]);
  assert.equal(calls, 2, 'one feed and one article request, despite ten callers');
  const restarted = new ArticleSource(state, env);
  assert.deepEqual(await (await restarted.fetch(request())).json(), [POST]);
  assert.equal(calls, 2, 'cache survives an object restart');
  data.get(request().url).savedAt = 0;
  assert.deepEqual(await (await restarted.fetch(request())).json(), [POST]);
  assert.equal(calls, 2, 'expired aggregate reuses unchanged full posts and the one-minute RSS cache');
});

function persistentSourceFixture() {
  const data = new Map();
  const state = { storage: {
    get: async key => data.get(key), put: async (key, value) => { data.set(key, value); },
    list: async ({ prefix }) => new Map([...data].filter(([key]) => key.startsWith(prefix))),
    delete: async keys => { for (const key of keys) data.delete(key); },
  } };
  let time = Date.parse('2026-10-26T18:00:00Z');
  let posts = [POST];
  let rejectPost;
  const calls = [];
  const clock = { now: () => time, sleep: async ms => { time += ms; } };
  const env = { FETCH_UPSTREAM: async url => {
    calls.push({ url, at: time });
    if (url.endsWith('/feed')) return new Response(`<rss><channel>${posts.map(post =>
      `<item><link>${post.canonical_url}</link><title>${post.title}</title><description>${post.subtitle}</description></item>`
    ).join('')}</channel></rss>`);
    const rejected = rejectPost?.(url);
    if (rejected) return rejected;
    const post = posts.find(post => post.canonical_url === url);
    assert.ok(post, `unexpected request: ${url}`);
    return new Response(`<script id="preloads-json">${payload(post)}</script>`);
  } };
  let source = new ArticleSource(state, env, clock);
  return {
    data, calls,
    advance: ms => { time += ms; },
    posts: value => { posts = value; },
    reject: value => { rejectPost = value; },
    restart: () => { source = new ArticleSource(state, env, clock); },
    read: () => source.fetch(new Request('https://article-source.internal/posts?offset=0')),
  };
}

test('hourly imports survive aggregate expiry and object restarts without re-downloading unchanged articles', async () => {
  const f = persistentSourceFixture();
  f.posts(Array.from({ length: 13 }, (_, i) => ({ ...POST, id: i + 1, canonical_url: `${POST.canonical_url}-${i}` })));
  assert.equal((await (await f.read()).json()).length, 13);
  const downloads = f.calls.filter(call => !call.url.endsWith('/feed'));
  assert.equal(downloads.length, 13);
  assert.ok(downloads.every((call, i) => !i || call.at - downloads[i - 1].at >= 1000));
  f.advance(6 * 3600000);
  f.restart();
  assert.equal((await (await f.read()).json()).length, 13);
  assert.equal(f.calls.length, 15, 'a new feed request, with no new article downloads');
});

test('RSS edits and new articles refresh only changed full payloads and keep every tag', async () => {
  const f = persistentSourceFixture();
  await f.read();
  f.advance(300001);
  const edited = { ...POST, title: 'Clayface Review updated', postTags: [...POST.postTags, { name: 'New tag' }] };
  const added = { ...POST, id: 2, canonical_url: `${POST.canonical_url}-new` };
  f.posts([edited, added]);
  assert.deepEqual(await (await f.read()).json(), [edited, added]);
  assert.equal(f.calls.filter(call => call.url === POST.canonical_url).length, 2);
  f.advance(300001);
  f.posts([added, edited]);
  assert.deepEqual(await (await f.read()).json(), [added, edited]);
  assert.equal(f.calls.length, 6, 'reordering RSS requires only a feed request');
});

test('a daily refresh picks up tag-only edits even when RSS has not changed', async () => {
  const f = persistentSourceFixture();
  await f.read();
  const edited = { ...POST, postTags: [{ name: 'Tag-only edit' }] };
  f.posts([edited]);
  f.advance(24 * 3600000);
  f.restart();
  assert.deepEqual(await (await f.read()).json(), [edited]);
  assert.equal(f.calls.length, 4);
});

test('429 partial failures retain completed posts, persist Retry-After and resume only missing articles', async () => {
  const f = persistentSourceFixture();
  const second = { ...POST, id: 2, canonical_url: `${POST.canonical_url}-second` };
  const third = { ...POST, id: 3, canonical_url: `${POST.canonical_url}-third` };
  f.posts([POST, second, third]);
  f.reject(url => url === second.canonical_url ? new Response('Slow down', { status: 429, headers: { 'Retry-After': '120' } }) : undefined);
  const failed = await f.read();
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /HTTP 429/);
  assert.ok(f.data.has(`source:post:v1:${POST.canonical_url}`));
  assert.equal(f.data.has('https://article-source.internal/posts?offset=0'), false);
  const before = f.calls.length;
  f.advance(61000);
  f.restart();
  assert.equal((await f.read()).status, 502);
  assert.equal(f.calls.length, before + 1, 'only RSS is fetched during the persisted article cooldown');
  f.reject(undefined);
  f.advance(60001);
  assert.deepEqual(await (await f.read()).json(), [POST, second, third]);
  assert.equal(f.calls.filter(call => call.url === POST.canonical_url).length, 1);
  assert.equal(f.calls.filter(call => call.url === third.canonical_url).length, 1);
});

test('expired or edited posts cannot fall back to an outdated cached body on source failure', async () => {
  for (const edit of [false, true]) {
    const f = persistentSourceFixture();
    await f.read();
    const saved = f.data.get(`source:post:v1:${POST.canonical_url}`);
    f.advance(edit ? 300001 : 24 * 3600000);
    if (edit) f.posts([{ ...POST, title: 'Changed title' }]);
    f.reject(() => new Response('<title>Challenge</title>'));
    assert.equal((await f.read()).status, 502);
    assert.deepEqual(f.data.get(`source:post:v1:${POST.canonical_url}`), saved);
  }
});

test('relay requests allow time for a paced twenty-article cold import', async () => {
  const result = await fetchPostsRelay({ request: async (_url, options) => {
    assert.equal(options.timeoutMs, 90000);
    return response([POST]);
  } });
  assert.deepEqual(result.posts, [POST]);
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

test('the actual CLI exits nonzero on failure even when a good snapshot already exists', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-article-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src/data'), { recursive: true });
  const snapshotFile = path.join(dir, 'src/data/articles.json');
  const original = response(planArticleSync(parsePostsResponse([POST]), []).merged);
  fs.writeFileSync(snapshotFile, original);
  const server = http.createServer((_request, res) => { res.writeHead(403); res.end('Blocked'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const publication = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./sync-articles.mjs', import.meta.url)), '--execute'], {
    cwd: dir, env: { ...process.env, SUBSTACK_PUBLICATION_URL: publication, SUBSTACK_FEED_URL: `${publication}/feed`, SUBSTACK_RELAY_URL: '' },
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exitCode = await new Promise(resolve => child.on('close', resolve));
  assert.equal(exitCode, 1, output);
  assert.match(output, /SYNC FAILED/);
  assert.equal(fs.readFileSync(snapshotFile, 'utf8'), original);
});
