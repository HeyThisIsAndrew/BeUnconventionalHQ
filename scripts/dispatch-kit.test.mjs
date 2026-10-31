/**
 * The weekly Kit draft Worker (dispatch-kit-worker/, issue #272). Offline:
 * Kit is a fake. Runbook: scripts/hq-dispatch.md.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 *   1. NOTHING TOUCHES KIT BY DEFAULT. Dry run unless CREATE_DRAFTS is "true".
 *   2. NO EMPTY DRAFT, NO DUPLICATE DRAFT. Zero new stories creates nothing;
 *      Kit's own broadcast list (the marker in the description) is checked
 *      before every create, so lost local state or a create that timed out
 *      can never make a second draft.
 *   3. The draft: newest story FEATURED, at most six, subject and preview text
 *      from the featured story, content joined from the site's pre-rendered
 *      boxes and nothing else.
 *   4. Retries on 429 and 5xx, and the API key never reaches a message.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planDraft, previewText, runKitDraft, validateKitFeed, buildNotice, kitRequest, draftMarker, draftUrl,
} from '../dispatch-kit-worker/kit-draft.mjs';

const NOW = Date.parse('2026-11-05T16:00:00Z');
const story = (n, over = {}) => ({
  guid: `https://beunconventionalhq.com/intel/s${n}`,
  title: `Story ${n}`,
  link: `https://beunconventionalhq.com/intel/s${n}`,
  summary: `Summary of story ${n}, which is long enough to need trimming when it is used as the preview text line.`,
  pubDate: `2026-11-0${n}T12:00:00.000Z`,
  categories: ['Review', 'TV'],
  featuredHtml: `<F${n}>`,
  latestHtml: `<L${n}>`,
  ...over,
});
const feed = (items) => ({ version: 1, latestHeadingHtml: '<H>', items });
const LIVE = { CREATE_DRAFTS: 'true', KIT_API_KEY: 'kit-secret-key-123', KIT_EMAIL_TEMPLATE_ID: '42', NEWSLETTER_NAME: 'THE HQ DISPATCH' };

const memoryStore = () => {
  const map = new Map();
  return { map, get: async (k) => structuredClone(map.get(k)), put: async (k, v) => { map.set(k, structuredClone(v)); } };
};

/** A fake Kit: answers list and create, records every request. */
function fakeKit({ broadcasts = [], createStatus = 201, failCreatesFirst = 0 } = {}) {
  const requests = [];
  let creates = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    requests.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    if (init.method === 'GET' && u.pathname === '/v4/broadcasts') {
      return Response.json({ broadcasts, pagination: { has_next_page: false } });
    }
    if (init.method === 'POST' && u.pathname === '/v4/broadcasts') {
      creates++;
      const body = JSON.parse(init.body);
      if (creates <= failCreatesFirst) {
        // The create LANDED but the answer was lost.
        broadcasts.push({ id: 900 + creates, description: body.description });
        return new Response('upstream timeout', { status: 504 });
      }
      const created = { id: 700 + creates, description: body.description };
      broadcasts.push(created);
      return Response.json({ broadcast: created }, { status: createStatus });
    }
    return new Response('not found', { status: 404 });
  };
  return { requests, fetchImpl, broadcasts };
}

const run = (over) => runKitDraft({ now: () => NOW, sleep: async () => {}, ...over });

// ─── planning ────────────────────────────────────────────────────────────

test('preview text is the featured summary trimmed at a word to about 90 characters', () => {
  const text = previewText('word '.repeat(40));
  assert.ok(text.length <= 90);
  assert.match(text, /word…$/);
  assert.equal(previewText('Short and sweet.'), 'Short and sweet.');
});

test('a feed without pre-rendered boxes stops the run', () => {
  assert.throws(() => validateKitFeed({ items: [] }), /latestHeadingHtml/);
  assert.throws(() => validateKitFeed(feed([story(1, { latestHtml: '' })])), /missing its story boxes/);
});

test('the plan: newest FEATURED, at most six, the rest counted, content only joins the boxes', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => story(n));
  const plan = planDraft(feed(items), null, { NEWSLETTER_NAME: 'THE HQ DISPATCH' }, NOW);
  assert.deepEqual(plan.stories.map((s) => s.title), ['Story 8', 'Story 7', 'Story 6', 'Story 5', 'Story 4', 'Story 3']);
  assert.equal(plan.left, 2);
  assert.equal(plan.subject, 'THE HQ DISPATCH: Story 8');
  assert.equal(plan.content, '<F8><H><L7><L6><L5><L4><L3>');
  assert.ok(plan.description.endsWith(draftMarker(items[7].guid)));
  // One story: FEATURED alone, no LATEST heading.
  assert.equal(planDraft(feed([story(1)]), null, {}, NOW).content, '<F1>');
});

test('stories since the last draft; the first run looks back FIRST_WINDOW_DAYS', () => {
  const items = [1, 2, 3].map((n) => story(n));
  const since = planDraft(feed(items), { lastPubDate: story(2).pubDate }, {}, NOW);
  assert.deepEqual(since.stories.map((s) => s.title), ['Story 3']);
  assert.equal(planDraft(feed(items), { lastPubDate: story(3).pubDate }, {}, NOW), null);
  // First run, a two-day window: only stories from Nov 3 on (NOW is Nov 5 16:00).
  const first = planDraft(feed(items), null, { FIRST_WINDOW_DAYS: '2.5' }, NOW);
  assert.deepEqual(first.stories.map((s) => s.title), ['Story 3']);
});

// ─── the run ─────────────────────────────────────────────────────────────

test('dry run by default: a preview, and Kit is never called', async () => {
  const kit = fakeKit();
  const result = await run({ store: memoryStore(), env: { KIT_API_KEY: 'k' }, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(result.action, 'preview');
  assert.equal(kit.requests.length, 0);
  // A forced dry run wins over CREATE_DRAFTS.
  const forced = await run({ store: memoryStore(), env: LIVE, dryRun: true, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(forced.action, 'preview');
  assert.equal(kit.requests.length, 0);
});

test('no new stories: no draft and no Kit call', async () => {
  const kit = fakeKit();
  const store = memoryStore();
  await store.put('state', { lastPubDate: story(3).pubDate });
  const result = await run({ store, env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1), story(2), story(3)]) });
  assert.equal(result.action, 'nothing-new');
  assert.equal(kit.requests.length, 0);
});

test('live: creates ONE draft (send_at null, public false, the template), then a re-run creates nothing', async () => {
  const kit = fakeKit();
  const store = memoryStore();
  const deps = { store, env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1), story(2)]) };
  const first = await run(deps);
  assert.equal(first.action, 'created');
  assert.equal(first.broadcastId, 701);
  const create = kit.requests.find((r) => r.method === 'POST');
  assert.equal(create.body.send_at, null);
  assert.equal(create.body.public, false);
  assert.equal(create.body.email_template_id, 42);
  assert.equal(create.body.content, '<F2><H><L1>');
  assert.equal(create.headers['X-Kit-Api-Key'], 'kit-secret-key-123');
  assert.equal((await store.get('state')).lastGuid, story(2).guid);
  const again = await run(deps);
  assert.equal(again.action, 'nothing-new');
  assert.equal(kit.requests.filter((r) => r.method === 'POST').length, 1);
});

test('Kit is the source of truth: with local state lost, the marker stops a second draft', async () => {
  const kit = fakeKit({ broadcasts: [{ id: 555, description: `FEATURED: Story 2\n${draftMarker(story(2).guid)}` }] });
  const store = memoryStore();
  const result = await run({ store, env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1), story(2)]) });
  assert.equal(result.action, 'exists');
  assert.equal(result.broadcastId, 555);
  assert.equal(kit.requests.filter((r) => r.method === 'POST').length, 0);
  assert.equal((await store.get('state')).broadcastId, 555, 'the cache is repaired from Kit');
  assert.equal(buildNotice(result, LIVE), null, 'an idempotent re-run emails nobody');
});

test('a create that landed but answered 5xx is found in Kit, never created twice', async () => {
  const kit = fakeKit({ failCreatesFirst: 1 });
  const result = await run({ store: memoryStore(), env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(result.action, 'created');
  assert.equal(result.broadcastId, 901);
  assert.equal(kit.requests.filter((r) => r.method === 'POST').length, 1);
  assert.equal(kit.broadcasts.length, 1);
});

test('drafts on but no template id: the run fails loudly instead of guessing', async () => {
  const kit = fakeKit();
  await assert.rejects(run({ store: memoryStore(), env: { ...LIVE, KIT_EMAIL_TEMPLATE_ID: '' }, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) }), /KIT_EMAIL_TEMPLATE_ID/);
  assert.equal(kit.requests.length, 0);
});

// ─── Kit client ──────────────────────────────────────────────────────────

test('429 and 5xx are retried with backoff (Retry-After honoured); 4xx is not', async () => {
  const waits = [];
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } });
    if (n === 2) return new Response('oops', { status: 502 });
    return Response.json({ ok: true });
  };
  assert.deepEqual(await kitRequest({ KIT_API_KEY: 'k' }, 'GET', '/broadcasts', null, { fetchImpl, sleep: async (ms) => { waits.push(ms); } }), { ok: true });
  assert.deepEqual(waits, [7000, 4000]);
  let calls = 0;
  await assert.rejects(kitRequest({ KIT_API_KEY: 'k' }, 'GET', '/x', null, { fetchImpl: async () => { calls++; return Response.json({ errors: ['bad'] }, { status: 422 }); }, sleep: async () => {} }), /HTTP 422 bad/);
  assert.equal(calls, 1);
});

test('the API key never appears in an error', async () => {
  const fetchImpl = async () => new Response('invalid key kit-secret-key-123', { status: 401 });
  await assert.rejects(kitRequest(LIVE, 'GET', '/broadcasts', null, { fetchImpl }), (e) => !e.message.includes('kit-secret-key-123') && e.message.includes('[redacted]'));
});

// ─── notices ─────────────────────────────────────────────────────────────

test('the dry-run notice carries the real boxes; the live one links the draft', () => {
  const plan = planDraft(feed([story(1), story(2)]), null, LIVE, NOW);
  const preview = buildNotice({ action: 'preview', plan }, LIVE);
  assert.match(preview.subject, /^THE HQ DISPATCH draft preview \(dry run\): Story 2$/);
  assert.ok(preview.html.includes('<F2><H><L1>'));
  const created = buildNotice({ action: 'created', plan, url: draftUrl(LIVE, 701) }, LIVE);
  assert.match(created.text, /https:\/\/app\.kit\.com\/campaigns\/701\/draft/);
  assert.match(buildNotice({ action: 'nothing-new' }, LIVE).subject, /no new stories/);
  for (const n of [preview, created]) assert.doesNotMatch(n.text, /—/);
});
