/**
 * The social distribution engine (social-blast-worker/, issues #281, #282,
 * #284). Offline: every platform is a fake. Runbook: scripts/social-blast.md.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 *   1. NOTHING POSTS BY DEFAULT. Dry run unless LIVE_PLATFORMS names the
 *      platform, and live posts use owner-approved templates only.
 *   2. ONE STORY, ONE POST PER PLATFORM. A re-run never reposts; a failure
 *      that might have posted is never retried; the first run announces
 *      nothing (it would blast the back catalogue).
 *   3. A failure on one platform never blocks the others.
 *   4. The copy engine never guesses: a missing variable blocks the template,
 *      rotation never repeats the last variant on a platform, one story gets
 *      different variants on different platforms.
 *   5. Platform limits and wire formats (Bluesky graphemes and byte-offset
 *      facets, X's 23-character links, Threads' link card).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  pickVariant, renderTemplate, validateTemplates, contentTypeOf, platformLength, graphemeLength,
  PLATFORM_LIMITS, ALL_PLATFORMS,
} from '../social-blast-worker/copy-engine.mjs';
import { runBlast, runAndReport, validateFeed, livePlatforms, MAX_ATTEMPTS } from '../social-blast-worker/blast.mjs';
import { blueskyFacets, postBluesky, postThreads, postFacebook, PostError, scrub } from '../social-blast-worker/platforms.mjs';
import { buildReport } from '../social-blast-worker/report.mjs';

const TEMPLATES = JSON.parse(readFileSync(new URL('../social-blast-worker/templates.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-31T12:00:00Z');

const item = (over = {}) => ({
  guid: 'https://beunconventionalhq.com/intel/a-story',
  kind: 'article',
  title: 'A Story',
  link: 'https://beunconventionalhq.com/intel/a-story',
  summary: 'The standfirst, which says what the piece is about.',
  pubDate: '2026-10-31T10:00:00.000Z',
  categories: ['Review', 'TV'],
  imageUrl: 'https://beunconventionalhq.com/dispatch/images/abc.jpg',
  ...over,
});

/** templates.json with every template approved, for the live-path tests. */
const approved = () => {
  const doc = structuredClone(TEMPLATES);
  for (const list of Object.values(doc.templates)) for (const t of list) t.approved = true;
  return doc;
};

const memoryStore = () => {
  const map = new Map();
  return {
    map,
    get: async (k) => structuredClone(map.get(k)),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => { map.delete(k); },
  };
};

const SECRETS = {
  BLUESKY_IDENTIFIER: 'hq.example', BLUESKY_APP_PASSWORD: 'app-pass-123456',
  THREADS_USER_ID: '42', THREADS_ACCESS_TOKEN: 'threads-token-abcdef',
  FB_PAGE_ID: '99', FB_PAGE_ACCESS_TOKEN: 'fb-token-abcdef',
};

/** Fake publishers that record every call. `fail` maps platform -> error to throw. */
function fakePublishers(fail = {}) {
  const calls = [];
  const make = (platform) => async ({ item: story, text }) => {
    calls.push({ platform, guid: story.guid, text });
    if (fail[platform]) throw fail[platform]();
    return { id: `${platform}-1`, url: `https://${platform}.example/post/1` };
  };
  return { calls, publishers: { bluesky: make('bluesky'), threads: make('threads'), facebook: make('facebook') } };
}

async function seededStore(items = []) {
  const store = memoryStore();
  await store.put('seeded', { at: NOW, count: items.length });
  return store;
}

function deps({ store, items, env = {}, templates = TEMPLATES, publishers, now = NOW }) {
  return {
    store, env, templates, publishers, now: () => now,
    fetchFeed: async () => ({ version: 1, items }),
    fetchImpl: async () => { throw new Error('no network in tests'); },
    getImage: async () => null,
    threadsToken: async () => 'threads-token-abcdef',
    blueskySession: async () => ({ service: 'https://bsky.test', accessJwt: 'jwt', did: 'did:plc:abc' }),
  };
}

// ─── templates.json ──────────────────────────────────────────────────────

test('templates.json is valid and has at least 10 general variants per content type (#281)', () => {
  validateTemplates(TEMPLATES);
  for (const [type, list] of Object.entries(TEMPLATES.templates)) {
    const general = list.filter((t) => !t.platforms && !t.retired);
    assert.ok(general.length >= 10, `${type} has ${general.length}`);
  }
});

test('no shipped template is pre-approved: the owner approves each one', () => {
  for (const list of Object.values(TEMPLATES.templates)) {
    for (const t of list) assert.notEqual(t.approved, true, `${t.id} ships approved`);
  }
});

test('no em dash in any template (house style for visitor copy)', () => {
  for (const list of Object.values(TEMPLATES.templates)) {
    for (const t of list) assert.ok(!t.text.includes('—'), t.id);
  }
});

test('validation lists bad variables, platforms, duplicate ids and dangling maps', () => {
  const bad = {
    fallbackType: 'story', typeMap: { Review: 'nope' },
    templates: { story: [{ id: 'a', text: '{{titel}}' }, { id: 'a', text: 'x', platforms: ['myspace'] }] },
  };
  assert.throws(() => validateTemplates(bad), (e) =>
    /\{\{titel\}\}/.test(e.message) && /duplicate/.test(e.message) && /myspace/.test(e.message) && /"nope"/.test(e.message));
});

// ─── copy engine ─────────────────────────────────────────────────────────

test('content type: video is always video, Events section is event coverage, else by type', () => {
  assert.equal(contentTypeOf(item(), TEMPLATES), 'review');
  assert.equal(contentTypeOf(item({ categories: ['Announcement'] }), TEMPLATES), 'news');
  assert.equal(contentTypeOf(item({ categories: ['Review', 'Events'] }), TEMPLATES), 'event');
  assert.equal(contentTypeOf(item({ kind: 'video', categories: ['Video', 'Events'] }), TEMPLATES), 'video');
  assert.equal(contentTypeOf(item({ categories: ['Mystery'] }), TEMPLATES), 'story');
});

test('a missing variable makes a template ineligible, never guessed', () => {
  const vars = { title: 'T', url: 'https://x.test/a' };
  assert.equal(renderTemplate({ id: 't', text: '{{title}}: {{section}}' }, vars, 'bluesky'), null);
  assert.equal(renderTemplate({ id: 't', text: 'New: {{title}}' }, vars, 'bluesky'), 'New: T');
  // With only templates that need a section, a story with none is BLOCKED.
  const doc = { fallbackType: 'story', templates: { story: [{ id: 's1', text: '{{section}}: {{title}}' }] } };
  const pick = pickVariant(doc, item({ categories: ['Story'] }), 'bluesky');
  assert.match(pick.blocked, /no section/);
});

test('card platforms leave the link to the card; X and YouTube drafts get it appended', () => {
  const vars = { title: 'T', url: 'https://x.test/a' };
  const t = { id: 't', text: 'New: {{title}}' };
  assert.equal(renderTemplate(t, vars, 'threads'), 'New: T');
  assert.equal(renderTemplate(t, vars, 'x'), 'New: T\n\nhttps://x.test/a');
  assert.equal(renderTemplate({ id: 'u', text: '{{title}} {{url}}' }, vars, 'x'), 'T https://x.test/a');
});

test('rotation: never the same variant twice in a row on one platform', () => {
  let last = null;
  for (let run = 0; run < 25; run++) {
    const pick = pickVariant(TEMPLATES, item({ title: `Story ${run}` }), 'threads', { lastUsed: last });
    assert.notEqual(pick.template.id, last);
    last = pick.template.id;
  }
});

test('one story gets a different variant on each platform', () => {
  const used = new Set();
  for (const platform of ALL_PLATFORMS) {
    const pick = pickVariant(TEMPLATES, item(), platform, { usedNow: used });
    assert.ok(!used.has(pick.template.id), `${platform} reused ${pick.template.id}`);
    used.add(pick.template.id);
  }
});

test('a platform with templates of its own uses only those (YouTube question variants)', () => {
  const pick = pickVariant(TEMPLATES, item({ kind: 'video', categories: ['Video', 'Film'] }), 'youtube');
  assert.match(pick.template.id, /^video-yt-/);
  const x = pickVariant(TEMPLATES, item({ kind: 'video', categories: ['Video', 'Film'] }), 'x');
  assert.doesNotMatch(x.template.id, /-yt-/);
});

test('live picks use approved templates only, and block when none are', () => {
  assert.match(pickVariant(TEMPLATES, item(), 'bluesky', { live: true }).blocked, /no approved "review" template/);
  const doc = structuredClone(TEMPLATES);
  doc.templates.review[4].approved = true;
  assert.equal(pickVariant(doc, item(), 'bluesky', { live: true }).template.id, 'review-05');
});

test('lengths: Bluesky counts graphemes, X weighs a link as 23', () => {
  assert.equal(graphemeLength('👩‍👩‍👧‍👦 ok'), 4);
  assert.equal(platformLength('x', `hi https://example.com/${'a'.repeat(200)}`), 3 + 23);
});

test('a long summary is trimmed to fit, at a word, with an ellipsis', () => {
  const long = 'word '.repeat(200).trim();
  const vars = { title: 'T', url: 'https://x.test/a', summary: long };
  const text = renderTemplate({ id: 't', text: '{{title}}\n\n{{summary}}' }, vars, 'bluesky');
  assert.ok(graphemeLength(text) <= PLATFORM_LIMITS.bluesky);
  assert.match(text, /word…$/);
  // A title too long for the platform is never cut: the template is skipped.
  assert.equal(renderTemplate({ id: 't', text: '{{title}}' }, { ...vars, title: 'T'.repeat(400) }, 'bluesky'), null);
});

// ─── the run ─────────────────────────────────────────────────────────────

test('the first run records the feed and announces NOTHING', async () => {
  const store = memoryStore();
  const { calls, publishers } = fakePublishers();
  const result = await runBlast(deps({ store, items: [item(), item({ guid: 'g2', title: 'B' })], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky,threads,facebook' }, templates: approved(), publishers }));
  assert.equal(result.action, 'seeded');
  assert.equal(calls.length, 0);
  // ...and the next run finds nothing new.
  const again = await runBlast(deps({ store, items: [item(), item({ guid: 'g2', title: 'B' })], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky' }, templates: approved(), publishers }));
  assert.equal(again.action, 'nothing-new');
  assert.equal(calls.length, 0);
});

test('dry run by default: previews for live platforms, drafts for X and YouTube, no publisher called', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const result = await runBlast(deps({ store, items: [item()], env: SECRETS, publishers }));
  assert.equal(calls.length, 0);
  const r = result.entries[0].results;
  for (const p of ['bluesky', 'threads', 'facebook']) assert.equal(r[p].status, 'previewed', p);
  for (const p of ['x', 'youtube']) assert.equal(r[p].status, 'drafted', p);
  // A preview is final: a later live switch does not post this old story.
  const live = await runBlast(deps({ store, items: [item()], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky' }, templates: approved(), publishers }));
  assert.equal(live.action, 'nothing-new');
  assert.equal(calls.length, 0);
});

test('live: one post per live platform, and a re-run posts nothing again', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const env = { ...SECRETS, LIVE_PLATFORMS: 'bluesky,threads,facebook' };
  const result = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers }));
  assert.deepEqual(calls.map((c) => c.platform), ['bluesky', 'threads', 'facebook']);
  assert.equal(result.entries[0].results.threads.url, 'https://threads.example/post/1');
  assert.equal(new Set(calls.map((c) => c.text)).size, 3, 'three platforms, three different variants');
  await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers }));
  assert.equal(calls.length, 3);
});

test('LIVE_PLATFORMS switches on only the platforms it names', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const result = await runBlast(deps({ store, items: [item()], env: { ...SECRETS, LIVE_PLATFORMS: ' Bluesky , myspace' }, templates: approved(), publishers }));
  assert.deepEqual(calls.map((c) => c.platform), ['bluesky']);
  assert.equal(result.entries[0].results.threads.status, 'previewed');
  assert.deepEqual([...livePlatforms({ LIVE_PLATFORMS: 'x,youtube,facebook' })], ['facebook']);
});

test('a failure on one platform leaves the others posted, and retries with the same text', async () => {
  const store = await seededStore();
  const env = { ...SECRETS, LIVE_PLATFORMS: 'bluesky,threads,facebook' };
  const failing = fakePublishers({ threads: () => new PostError('Threads container: HTTP 500 oops', { status: 500 }) });
  const first = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers: failing.publishers }));
  const r = first.entries[0].results;
  assert.equal(r.bluesky.status, 'posted');
  assert.equal(r.facebook.status, 'posted');
  assert.equal(r.threads.status, 'failed');
  assert.equal(first.problems, 1);
  const failedText = failing.calls.find((c) => c.platform === 'threads').text;

  const healthy = fakePublishers();
  const second = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers: healthy.publishers }));
  assert.deepEqual(healthy.calls.map((c) => c.platform), ['threads'], 'only the failed platform is retried');
  assert.equal(healthy.calls[0].text, failedText);
  assert.equal(second.entries[0].results.threads.status, 'posted');
});

test(`retries stop after ${MAX_ATTEMPTS} attempts`, async () => {
  const store = await seededStore();
  const env = { ...SECRETS, LIVE_PLATFORMS: 'facebook' };
  const failing = fakePublishers({ facebook: () => new PostError('HTTP 400', { status: 400 }) });
  let last;
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) last = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers: failing.publishers }));
  assert.equal(failing.calls.length, MAX_ATTEMPTS);
  assert.equal(last.action, 'nothing-new');
  const record = await store.get(`item:${item().guid}`);
  assert.equal(record.platforms.facebook.status, 'failed-final');
});

test('a failure that MIGHT have posted is reported unknown and never retried', async () => {
  const store = await seededStore();
  const env = { ...SECRETS, LIVE_PLATFORMS: 'facebook' };
  const failing = fakePublishers({ facebook: () => new PostError('Facebook post: timed out', { maybePosted: true }) });
  const first = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers: failing.publishers }));
  assert.equal(first.entries[0].results.facebook.status, 'unknown');
  await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers: failing.publishers }));
  assert.equal(failing.calls.length, 1);
});

test('an in-flight mark left by a dead run becomes unknown, not a second post', async () => {
  const store = await seededStore();
  await store.put(`item:${item().guid}`, {
    guid: item().guid, platforms: {
      bluesky: { status: 'in-flight', attempts: 1, text: 't', templateId: 'review-01' },
      threads: { status: 'posted' }, facebook: { status: 'posted' }, x: { status: 'drafted' }, youtube: { status: 'drafted' },
    },
  });
  const { calls, publishers } = fakePublishers();
  const result = await runBlast(deps({ store, items: [item()], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky' }, templates: approved(), publishers }));
  assert.equal(calls.length, 0);
  assert.equal(result.entries[0].results.bluesky.status, 'unknown');
});

test('a live platform with missing credentials is reported, never attempted', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const env = { LIVE_PLATFORMS: 'threads' };
  const result = await runBlast(deps({ store, items: [item()], env, templates: approved(), publishers }));
  assert.equal(calls.length, 0);
  assert.match(result.entries[0].results.threads.reason, /THREADS_USER_ID, THREADS_ACCESS_TOKEN/);
});

test('a new story older than MAX_AGE_HOURS is skipped and reported, not posted', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const old = item({ pubDate: '2026-10-20T00:00:00Z' });
  const result = await runBlast(deps({ store, items: [old], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky' }, templates: approved(), publishers }));
  assert.equal(calls.length, 0);
  assert.match(result.entries[0].skipped, /72 hours/);
});

test('MAX_ITEMS_PER_RUN caps a run, oldest first; the rest wait for the next run', async () => {
  const store = await seededStore();
  const { publishers } = fakePublishers();
  const items = [3, 1, 2].map((n) => item({ guid: `g${n}`, title: `S${n}`, pubDate: `2026-10-31T0${n}:00:00Z` }));
  const first = await runBlast(deps({ store, items, env: { MAX_ITEMS_PER_RUN: '2' }, publishers }));
  assert.deepEqual(first.entries.map((e) => e.item.guid), ['g1', 'g2']);
  const second = await runBlast(deps({ store, items, env: { MAX_ITEMS_PER_RUN: '2' }, publishers }));
  assert.deepEqual(second.entries.map((e) => e.item.guid), ['g3']);
});

test('inspect mode saves nothing and posts nothing', async () => {
  const store = await seededStore();
  const { calls, publishers } = fakePublishers();
  const before = [...store.map.keys()];
  const result = await runAndReport({ ...deps({ store, items: [item()], env: { ...SECRETS, LIVE_PLATFORMS: 'bluesky' }, templates: approved(), publishers }), inspect: true, send: async () => { throw new Error('must not send'); } });
  assert.equal(calls.length, 0);
  assert.deepEqual([...store.map.keys()], before);
  assert.match(result.report.text, /Inspection only/);
});

test('an unsent report waits in the outbox and goes out on the next run', async () => {
  const store = await seededStore();
  const { publishers } = fakePublishers();
  const sent = [];
  const base = deps({ store, items: [item()], env: { BRAND_NAME: 'HQ' }, publishers });
  const first = await runAndReport({ ...base, send: async () => { throw new Error('Resend is down'); } });
  assert.match(first.reportError, /Resend is down/);
  assert.equal((await store.get('outbox')).length, 1);
  await runAndReport({ ...base, send: async (r) => { sent.push(r); } });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /HQ social: 1 story \(dry run\)/);
  assert.deepEqual(await store.get('outbox'), []);
});

test('a malformed feed stops the run before anything is decided', async () => {
  assert.throws(() => validateFeed({ items: [{ guid: 'g', title: 'T', link: 'not a url', pubDate: '2026-10-31' }] }), /incomplete item/);
  assert.throws(() => validateFeed({}), /no items/);
});

// ─── report ──────────────────────────────────────────────────────────────

test('the report carries each draft with a one-tap X composer link', () => {
  const report = buildReport([{ item: item(), type: 'review', results: {
    x: { status: 'drafted', templateId: 'review-01', text: 'New review: A Story\n\nhttps://beunconventionalhq.com/intel/a-story' },
    threads: { status: 'failed', error: 'HTTP 500', templateId: 'review-02', text: 't' },
  } }], { BRAND_NAME: 'HQ', LIVE_PLATFORMS: 'threads' });
  assert.match(report.subject, /^HQ social: 1 story, 1 needs attention$/);
  assert.match(report.html, /https:\/\/x\.com\/intent\/post\?text=New%20review%3A%20A%20Story/);
  assert.doesNotMatch(report.html, /—/);
});

// ─── platform wire formats ───────────────────────────────────────────────

/** A fetch that answers each call from `answers` in order and records the requests. */
function scriptedFetch(answers) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const answer = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  };
  return { requests, fetchImpl };
}

test('Bluesky facets use UTF-8 byte offsets (emoji before the link)', () => {
  const text = '🎬 New: https://hq.test/a #Marvel';
  const [link, tag] = blueskyFacets(text);
  const bytes = new TextEncoder().encode(text);
  const slice = (f) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
  assert.equal(slice(link), 'https://hq.test/a');
  assert.equal(link.features[0].uri, 'https://hq.test/a');
  assert.equal(slice(tag), '#Marvel');
  assert.equal(tag.features[0].tag, 'Marvel');
});

test('Bluesky: uploads the dispatch image as the link card thumbnail, then creates the post', async () => {
  const { requests, fetchImpl } = scriptedFetch([
    { body: { blob: { $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/jpeg', size: 3 } } },
    { body: { uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'c' } },
  ]);
  const session = { service: 'https://bsky.social', accessJwt: 'jwt', did: 'did:plc:abc' };
  const posted = await postBluesky({
    item: item(), text: 'New review: A Story', env: SECRETS, fetchImpl, session,
    getImage: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg' }),
  });
  assert.equal(posted.url, 'https://bsky.app/profile/did:plc:abc/post/3kxyz');
  assert.match(requests[0].url, /uploadBlob$/);
  const record = JSON.parse(requests[1].init.body).record;
  assert.equal(record.embed.external.uri, item().link);
  assert.equal(record.embed.external.thumb.ref.$link, 'bafy');
});

test('Threads: a TEXT container with the link as its card, then publish', async () => {
  const { requests, fetchImpl } = scriptedFetch([
    { body: { id: 'c1' } }, { body: { status: 'FINISHED' } }, { body: { id: 'm1' } }, { body: { permalink: 'https://www.threads.net/@hq/post/x' } },
  ]);
  const posted = await postThreads({ item: item(), text: 'New review: A Story', env: SECRETS, fetchImpl, token: 'threads-token-abcdef', sleep: async () => {} });
  assert.equal(posted.url, 'https://www.threads.net/@hq/post/x');
  const create = new URLSearchParams(requests[0].init.body);
  assert.equal(create.get('media_type'), 'TEXT');
  assert.equal(create.get('link_attachment'), item().link);
  assert.match(requests[2].url, /\/42\/threads_publish$/);
  assert.equal(new URLSearchParams(requests[2].init.body).get('creation_id'), 'c1');
});

test('Threads: a publish that never answers might have posted', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return Response.json({ id: 'c1' });
    if (n === 2) return Response.json({ status: 'FINISHED' });
    throw new Error('network down');
  };
  await assert.rejects(postThreads({ item: item(), text: 't', env: SECRETS, fetchImpl, sleep: async () => {} }), (e) => e.maybePosted === true);
});

test('Facebook: POST /{page}/feed with message and link; errors carry no token', async () => {
  const { requests, fetchImpl } = scriptedFetch([{ body: { id: '99_123' } }]);
  const posted = await postFacebook({ item: item(), text: 'Hello', env: SECRETS, fetchImpl });
  assert.equal(posted.url, 'https://www.facebook.com/99_123');
  assert.match(requests[0].url, /graph\.facebook\.com\/v\d+\.0\/99\/feed$/);
  assert.equal(new URLSearchParams(requests[0].init.body).get('link'), item().link);

  const echo = scriptedFetch([{ status: 400, body: { error: { message: 'bad token fb-token-abcdef' } } }]);
  await assert.rejects(postFacebook({ item: item(), text: 'x', env: SECRETS, fetchImpl: echo.fetchImpl }), (e) =>
    !e.message.includes('fb-token-abcdef') && e.message.includes('[redacted]') && e.maybePosted === false);
});

test('scrub removes every configured secret', () => {
  assert.equal(scrub('a app-pass-123456 b threads-token-abcdef', SECRETS), 'a [redacted] b [redacted]');
});
