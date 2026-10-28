import test from 'node:test';
import assert from 'node:assert/strict';
import { ArticleSource } from './substack-relay.mjs';
import { renderPublicSubstack, browserTextDocument } from './substack-browser-source.mjs';
import { watchArticlesFromPosts } from './substack-watcher.mjs';

const PUB = 'https://beunconventionalhq.substack.com';
const POST = { id: 1, title: 'New review', slug: 'new-review', canonical_url: `${PUB}/p/new-review`,
  post_date: '2026-10-28T02:47:02.493Z', postTags: [{ name: 'Film' }, { name: 'Review' }],
  body_html: '<p>A complete article with &amp; entities and <strong>formatting</strong>.</p>' };
const escaped = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const browserResponse = posts => Response.json({ success: true, result: `<html><body><pre>${escaped(JSON.stringify(posts))}</pre></body></html>` });
function fixture() {
  let now = Date.parse('2026-10-28T03:00:00Z');
  const values = new Map();
  const storage = {
    get: async key => values.get(key), put: async (key, value) => { values.set(key, value); },
    list: async ({ prefix }) => new Map([...values].filter(([key]) => key.startsWith(prefix))),
    delete: async keys => { for (const key of keys) values.delete(key); },
  };
  let posts = [POST];
  let failBrowser = false;
  const calls = [];
  const waits = [];
  const dispatches = [];
  const env = {
    FETCH_UPSTREAM: async url => { calls.push({ native: url }); return new Response('Blocked', { status: 429 }); },
    BROWSER: { quickAction: async (action, options) => {
      calls.push({ action, url: options.url, at: now });
      return failBrowser ? Response.json({ success: false }, { status: 429 }) : browserResponse(posts);
    } },
    HQ_SITE: { fetch: async request => { dispatches.push(await request.json()); return Response.json({ ok: true }); } },
    WEBSUB_SECRET: 'offline-secret',
  };
  const clock = { now: () => now, sleep: async ms => { waits.push(ms); now += ms; } };
  let source = new ArticleSource({ storage }, env, clock);
  return { values, calls, waits, dispatches,
    source: () => source,
    advance: ms => { now += ms; },
    posts: next => { posts = next; },
    fail: () => { failBrowser = true; },
    restart: () => { source = new ArticleSource({ storage }, env, clock); },
    read: () => source.fetch(new Request('https://article-source.internal/posts?offset=0')),
  };
}

test('browser transport restricts origins, paths, pagination and resource loading', async () => {
  let called = false;
  const browser = { quickAction: async (action, options) => {
    called = true;
    assert.equal(action, 'content');
    assert.ok(options.rejectResourceTypes.includes('script'));
    assert.equal(options.gotoOptions.timeout, 15000);
    return browserResponse([POST]);
  } };
  for (const url of ['https://evil.test/feed', `${PUB}/api/v1/user`, `${PUB}/api/v1/posts?limit=20&offset=1`,
    `${PUB}/api/v1/posts?limit=20&offset=0&url=https://evil.test`, `${PUB}/api/v1/posts?limit=20&offset=0&offset=20`]) {
    await assert.rejects(renderPublicSubstack(browser, url));
  }
  assert.equal(called, false);
  await renderPublicSubstack(browser, `${PUB}/api/v1/posts?limit=20&offset=0`);
  assert.equal(called, true);
});

test('Chrome JSON text is decoded once without losing HTML entities, tags or body', async () => {
  const response = await browserResponse([POST]).json();
  assert.deepEqual(JSON.parse(browserTextDocument(response.result)), [POST]);
  assert.deepEqual(JSON.parse(browserTextDocument(JSON.stringify([POST]))), [POST]);
  assert.throws(() => JSON.parse(browserTextDocument('<html>Challenge</html>')));
});

test('blocked native requests recover complete posts through the browser and reuse the persisted aggregate', async () => {
  const f = fixture();
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [POST]);
  assert.equal(f.calls.filter(call => call.action).length, 1);
  f.restart();
  assert.deepEqual(await (await f.read()).json(), [POST]);
  assert.equal(f.calls.filter(call => call.action).length, 1);
});

test('fresh archive discovery warms full posts, dispatches once, and respects browser pacing across restarts', async () => {
  const f = fixture();
  f.values.set('watcher:published:v1', { seen: [`${PUB}/p/older-review`] });
  const result = await f.source().poll({});
  assert.equal(result.action, 'dispatched');
  assert.equal(result.articles[0].url, POST.canonical_url);
  assert.equal(f.dispatches.length, 1);
  assert.deepEqual(f.dispatches[0].articles, watchArticlesFromPosts([POST]));
  assert.deepEqual(await (await f.read()).json(), [POST], 'the full source was warmed before dispatch');
  assert.ok(f.waits.some(wait => wait >= 11000));
  assert.equal(f.calls.filter(call => call.native).length, 1, 'native cooldown covers both API paths');
  f.restart();
  assert.equal((await f.source().poll({})).action, 'unchanged');
  assert.equal(f.dispatches.length, 1);
});

test('a second real publish invalidates old full-source data and imports its complete metadata', async () => {
  const f = fixture();
  f.values.set('watcher:published:v1', { seen: [POST.canonical_url] });
  await f.read();
  f.advance(60001);
  const fresh = { ...POST, id: 2, slug: 'next-review', canonical_url: `${PUB}/p/next-review`, title: 'Next review',
    post_date: '2026-10-28T03:01:00Z', postTags: [{ name: 'TV' }, { name: 'New tag' }] };
  f.posts([fresh, POST]);
  assert.equal((await f.source().poll({})).action, 'dispatched');
  assert.deepEqual(await (await f.read()).json(), [fresh, POST]);
});

test('browser failures preserve the existing publication baseline and never return stale posts as fresh', async () => {
  const f = fixture();
  const baseline = { seen: [POST.canonical_url] };
  f.values.set('watcher:published:v1', baseline);
  await f.read();
  f.advance(300001);
  f.fail();
  assert.equal((await f.read()).status, 502);
  const failed = await f.source().poll({ dryRun: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(f.values.get('watcher:published:v1'), baseline);
  assert.equal(f.dispatches.length, 0);
});

test('browser recovery budget is persistent, bounded and resets on the next UTC day', async () => {
  const f = fixture();
  f.values.set('source:browser-budget:v1', { day: '2026-10-28', usedMs: 490000 });
  assert.equal((await f.read()).status, 502);
  assert.equal(f.calls.filter(call => call.action).length, 0);
  f.advance(86400000);
  f.restart();
  assert.equal((await f.read()).status, 200);
});

test('archive discovery rejects foreign or incomplete articles rather than dispatching bad metadata', () => {
  for (const posts of [[], [{ ...POST, canonical_url: 'https://evil.test/p/a' }], [{ ...POST, post_date: 'invalid' }]]) {
    assert.throws(() => watchArticlesFromPosts(posts));
  }
});

test('the full browser source rejects missing tags, missing bodies and duplicate post IDs', async () => {
  for (const posts of [[{ ...POST, postTags: undefined }], [{ ...POST, body_html: undefined }], [POST, POST]]) {
    const f = fixture();
    f.posts(posts);
    assert.equal((await f.read()).status, 502);
    assert.equal(f.values.has('https://article-source.internal/posts?offset=0'), false);
  }
});
