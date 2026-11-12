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
  dedupeStories, titleSubject, weekOf, nextIssueNumber, validateNote, kitDescription, KIT_DESCRIPTION_MAX,
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
  alsoHtml: `<A${n}>`,
  newsletter: { subtitle: `Subtitle ${n}.`, lede: null, blurb: `Blurb ${n}.`, missing: [] },
  ...over,
});
const feed = (items) => ({ version: 1, latestHeadingHtml: '<H>', alsoHeadingHtml: '<AH>', items });
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

test('inbox preview text: the subtitle whole, else its first whole sentence, never cut mid-sentence', () => {
  assert.equal(previewText('Short and sweet.'), 'Short and sweet.');
  assert.equal(previewText(`First sentence. ${'More words. '.repeat(20)}`), 'First sentence.');
  assert.equal(previewText(`${'word '.repeat(60)}end.`), '');
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

test('dry run by default: a preview, and Kit is only ever READ (for the issue number)', async () => {
  const kit = fakeKit();
  const result = await run({ store: memoryStore(), env: { KIT_API_KEY: 'k' }, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(result.action, 'preview');
  assert.ok(kit.requests.every((r) => r.method === 'GET'));
  // Without a key nothing reaches Kit at all, and the issue line is the week alone.
  const keyless = fakeKit();
  const noKey = await run({ store: memoryStore(), env: {}, fetchImpl: keyless.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(keyless.requests.length, 0);
  assert.match(noKey.plan.issueMarker, /^Week of November 2, 2026$/);
  kit.requests.length = 0;
  // A forced dry run wins over CREATE_DRAFTS.
  const forced = await run({ store: memoryStore(), env: LIVE, dryRun: true, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1)]) });
  assert.equal(forced.action, 'preview');
  assert.ok(kit.requests.every((r) => r.method === 'GET'));
});

test('no new stories: no draft and no Kit call', async () => {
  const kit = fakeKit();
  const store = memoryStore();
  await store.put('state', { lastPubDate: story(3).pubDate });
  const result = await run({ store, env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1), story(2), story(3)]) });
  assert.equal(result.action, 'nothing-new');
  assert.equal(kit.requests.length, 0);
});

test('live: a featured story with no subtitle sends NO preview_text key (never an empty string)', async () => {
  const kit = fakeKit();
  const blank = story(2, { newsletter: { subtitle: null, lede: null, blurb: null, missing: ['subtitle'] } });
  const result = await run({ store: memoryStore(), env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed([story(1), blank]) });
  assert.equal(result.action, 'created');
  assert.ok(!('preview_text' in kit.requests.find((r) => r.method === 'POST').body));
});

test('Kit description fits Kit (<= 250 bytes), keeps whole lines and always ends with the draft marker', () => {
  const marker = draftMarker('https://www.youtube.com/watch?v=RQsja2Jk4tc');
  const long = ['Issue 1 | Week of November 9, 2026', 'FEATURED: Godzilla Minus Zero Premiere Breakdown | The Human Cost of Kaiju Warfare',
    'FILM: Avengers: Doomsday | When Cinematic Hype Meets Toy-Grade Merchandise / The Suicide Squad’s canon', 'TV: nothing this week',
    'WRITE BEFORE SENDING:', '- Godzilla: subtitle', marker].join('\n');
  const out = kitDescription(long);
  assert.ok(new TextEncoder().encode(out).length <= KIT_DESCRIPTION_MAX, `${new TextEncoder().encode(out).length} bytes`);
  assert.ok(out.endsWith(`\n${marker}`));
  assert.ok(out.startsWith('Issue 1 | Week of November 9, 2026\nFEATURED: Godzilla'));
  assert.match(out, /\(more in the draft-ready email\)/);
  for (const line of out.split('\n')) assert.ok(long.split('\n').includes(line) || line.startsWith('(more'), `cut line: ${line}`);
  assert.equal(kitDescription('short\n' + marker), 'short\n' + marker, 'a description that fits is untouched');
});

test('live: the description sent to Kit is capped even when the plan lists many stories', async () => {
  const kit = fakeKit();
  const items = [1, 2, 3, 4, 5, 6].map((n) => story(n, { title: `A long story title number ${n} that goes on | With a subtitle to match` }));
  const result = await run({ store: memoryStore(), env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => feed(items) });
  assert.equal(result.action, 'created');
  const sent = kit.requests.find((r) => r.method === 'POST').body.description;
  assert.ok(new TextEncoder().encode(sent).length <= KIT_DESCRIPTION_MAX);
  assert.ok(sent.endsWith(draftMarker(items[5].guid)));
  assert.ok(result.plan.description.length > sent.length, 'the plan (and the email) keep the full list');
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

// ─── dedupe, phase 1 (newsletter only) ───────────────────────────────────

test('the subject of a headline sets format words aside, keeps years', () => {
  assert.equal(titleSubject('Godzilla Minus Zero | Review'), 'godzilla minus zero');
  assert.equal(titleSubject('Godzilla Minus Zero LA Premiere Reaction | More Heart Than Action?'), 'godzilla minus zero');
  assert.equal(titleSubject('Lanterns Finale Review: Why Skipping the CGI Battle Worked'), 'lanterns');
  assert.equal(titleSubject('Lanterns Episode 7 Review: Second Best of the Season'), 'lanterns');
  assert.equal(titleSubject('State of the DCU: Why DC TV Is Beating the Movies'), 'state of the dcu');
  assert.notEqual(titleSubject('The Game Awards 2026 | Tickets'), titleSubject('The Game Awards 2027 | Tickets'));
});

test("the owner's example: the Godzilla review keeps its card, the premiere reaction moves to ALSO THIS WEEK", () => {
  const items = [
    story(9, { title: 'The Game Awards 2026 | Tickets On Sale Now' }),
    story(8, { title: 'Godzilla Minus Zero | Review' }),
    story(7, { title: 'Godzilla Minus Zero LA Premiere Reaction | More Heart Than Action?', link: 'https://www.youtube.com/watch?v=dcsODyzLaug' }),
    story(6, { title: 'State of the DCU: Why DC TV Is Beating the Movies' }),
    story(5, { title: 'Lanterns Finale Review: Why Skipping the CGI Battle Worked' }),
    story(4, { title: 'Grand Theft Auto VI | The World’s Biggest Out-of-Office Sweepstakes' }),
    story(3, { title: 'Lanterns Episode 7 Review: Second Best of the Season' }),
    story(2, { title: 'The Batman Part II | Why Soderbergh Helping Reeves Finish Filming Is Not a Takeover' }),
  ];
  const { main, also, left } = dedupeStories(items, 6, 4);
  assert.deepEqual(main.map((s) => s.title.split(/ \| |: /)[0]), [
    'The Game Awards 2026', 'Godzilla Minus Zero', 'State of the DCU', 'Lanterns Finale Review', 'Grand Theft Auto VI', 'The Batman Part II',
  ]);
  assert.deepEqual(also.map((a) => [a.item.title.split(/ \| |: /)[0], a.reason, a.sameAs.title.split(/ \| |: /)[0]]), [
    ['Godzilla Minus Zero LA Premiere Reaction', 'same title', 'Godzilla Minus Zero'],
    ['Lanterns Episode 7 Review', 'same title', 'Lanterns Finale Review'],
  ]);
  assert.equal(left, 0);
  // In the draft: the demoted story is still linked, under ALSO THIS WEEK.
  const plan = planDraft(feed(items), null, { ...LIVE, FIRST_WINDOW_DAYS: '30' }, NOW);
  assert.ok(plan.content.includes('<A7>'));
  assert.ok(!plan.content.includes('<L7>'));
  assert.match(plan.description, /Also this week:\n- Godzilla Minus Zero LA Premiere Reaction/);
});

test('the same source story twice (one link) is a duplicate too; nothing is lost silently', () => {
  const { main, also } = dedupeStories([story(2), story(1, { link: story(2).link, title: 'Different words' })], 6, 4);
  assert.equal(main.length, 1);
  assert.equal(also[0].reason, 'same story');
  const capped = dedupeStories([story(3), story(2, { title: 'Story 3: again' }), story(1, { title: 'Story 3 | once more' })], 6, 1);
  assert.equal(capped.also.length, 1);
  assert.equal(capped.left, 1, 'over the ALSO cap counts as left out, and the notice says so');
});

// ─── issue line and editor note ──────────────────────────────────────────

test('the issue line defaults to the week (Monday, Pacific), numbered from Kit when it can be', () => {
  assert.equal(weekOf(Date.parse('2026-11-05T16:00:00Z')), 'Week of November 2, 2026');
  // Sunday night in Los Angeles is still the previous week, though UTC says Monday.
  assert.equal(weekOf(Date.parse('2026-11-02T07:30:00Z')), 'Week of October 26, 2026');
  const past = [{ description: draftMarker('a') }, { description: 'a broadcast made by hand' }, { description: draftMarker('b') }];
  assert.equal(nextIssueNumber(past, {}), 3);
  assert.equal(nextIssueNumber(past, { ISSUE_NUMBER_OFFSET: '10' }), 13);
  const plan = planDraft(feed([story(1)]), null, LIVE, NOW, { issueNumber: 3 });
  assert.equal(plan.issueMarker, 'Issue 3 | Week of November 2, 2026');
});

test('the issue line and the note fill the site-rendered pieces, escaped; no note means no block at all', () => {
  const f = { ...feed([story(1)]), issueMarkerHtml: '<M>%%HQ_ISSUE_MARKER%%</M>', editorNoteHtml: '<N>%%HQ_EDITOR_NOTE%%</N>' };
  const withNote = planDraft(f, null, LIVE, NOW, { issueNumber: 2, editorNote: 'Line one & <two>.\nLine three.' });
  assert.ok(withNote.content.startsWith('<M>Issue 2 | Week of November 2, 2026</M><N>Line one &amp; &lt;two&gt;.<br>Line three.</N><F1>'));
  const without = planDraft(f, null, LIVE, NOW, { issueNumber: 2, editorNote: '   ' });
  assert.ok(!without.content.includes('<N>'), 'blank note: block left out, no gap');
  assert.ok(without.content.startsWith('<M>Issue 2'));
});

test('a saved note goes into the next draft and is then cleared; notes are checked', async () => {
  const kit = fakeKit();
  const store = memoryStore();
  await store.put('editorNote', { text: 'My note.' });
  const f = { ...feed([story(1)]), issueMarkerHtml: '<M>%%HQ_ISSUE_MARKER%%</M>', editorNoteHtml: '<N>%%HQ_EDITOR_NOTE%%</N>' };
  const result = await run({ store, env: LIVE, fetchImpl: kit.fetchImpl, fetchFeed: async () => f });
  assert.equal(result.action, 'created');
  assert.ok(kit.requests.find((r) => r.method === 'POST').body.content.includes('<N>My note.</N>'));
  assert.equal(await store.get('editorNote'), null);
  assert.match(result.plan.issueMarker, /^Issue 1 \| /);
  assert.throws(() => validateNote('x'.repeat(601)), /600/);
  assert.throws(() => validateNote('A note \u2014 with a dash.'), /em dash/);
  assert.equal(validateNote('  Fine.  '), 'Fine.');
});

test('missing copy is flagged in the description and the notice, never filled in', () => {
  const items = [
    story(2, { newsletter: { subtitle: null, lede: null, blurb: null, missing: ['subtitle', 'blurb'] } }),
    story(1, { newsletter: { subtitle: 'S.', lede: null, blurb: null, missing: ['blurb'] } }),
  ];
  const plan = planDraft(feed(items), null, LIVE, NOW);
  assert.deepEqual(plan.missing.map((m) => [m.title, m.field.split(' ')[0]]), [['Story 2', 'subtitle'], ['Story 1', 'one-line'], ['Story 2', 'inbox']]);
  assert.match(plan.description, /WRITE BEFORE SENDING:\n- Story 2: subtitle/);
  const notice = buildNotice({ action: 'preview', plan }, LIVE);
  assert.match(notice.text, /WRITE BEFORE SENDING/);
  assert.match(notice.text, /Editor note: none this issue/);
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
