/**
 * THE HQ DISPATCH by topic (src/lib/dispatch-topics.ts and the Kit Worker's
 * topics layout). Offline. Runbook: scripts/hq-dispatch.md.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 *   1. One FEATURED for everyone, then four slots: one per topic for a reader
 *      who chose nothing, turns across the chosen topics otherwise, a topic
 *      that runs out handing its turn on.
 *   2. Events with no story fall back to the NEXT upcoming event, from the
 *      calendar's own facts only.
 *   3. The per-reader version (Kit Liquid) picks exactly what fillSlots()
 *      picks, for every combination of topics, and a headline can never be
 *      read as Liquid.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Liquid } from 'liquidjs';
import { topicOf, parseTopics, formatTopics, fillSlots as fillSlotsTs, selectUpcomingEvent, eventFactsLine, eventImageSource, TOPICS } from '../src/lib/dispatch-topics.ts';
import { fillSlots, topicCandidates, personalizedSlots, planDraft } from '../dispatch-kit-worker/kit-draft.mjs';

const item = (topic, n, over = {}) => ({
  guid: `https://hq.test/${topic}-${n}`, link: `https://hq.test/${topic}-${n}`, title: `${topic} story ${n}`, topic,
  pubDate: `2026-11-0${n}T12:00:00.000Z`, categories: ['Review', topic], featuredHtml: `<F:${topic}${n}>`, latestHtml: `<L:${topic}${n}>`,
  newsletter: { subtitle: 'S.', lede: null, blurb: 'B.', missing: [] }, ...over,
});

test('a story belongs to the topic of its section; no section, no topic', () => {
  assert.equal(topicOf(['Review', 'TV']), 'tv');
  assert.equal(topicOf(['Video', 'Film']), 'film');
  assert.equal(topicOf(['Analysis', 'Events']), 'events');
  assert.equal(topicOf(['Story']), null);
  assert.equal(topicOf(['Video', 'General']), null);
});

test("a reader's topics: unknown words dropped, nothing chosen means everything", () => {
  assert.deepEqual(parseTopics('TV, film, cooking'), ['film', 'tv']);
  assert.deepEqual(parseTopics(''), [...TOPICS]);
  assert.deepEqual(parseTopics(['games']), ['games']);
  assert.equal(formatTopics(['events', 'film']), 'film,events');
});

test('the slot rule: one per topic by default, turns across chosen topics, empty topics hand on', () => {
  const by = { film: ['f1', 'f2', 'f3'], tv: ['t1', 't2'], games: ['g1'], events: ['e1'] };
  assert.deepEqual(fillSlots(by, TOPICS), ['f1', 't1', 'g1', 'e1']);
  assert.deepEqual(fillSlots(by, ['film', 'tv']), ['f1', 't1', 'f2', 't2']);
  assert.deepEqual(fillSlots(by, ['tv']), ['t1', 't2']);
  assert.deepEqual(fillSlots({ ...by, games: [] }, ['games', 'film']), ['f1', 'f2', 'f3']);
  // The site's copy and the Worker's copy are the same rule.
  for (const topics of [TOPICS, ['film', 'tv'], ['games'], ['tv', 'events']]) {
    assert.deepEqual(fillSlotsTs(by, topics), fillSlots(by, topics));
  }
});

test('three topics: one each, and the fourth goes to whichever published most recently (it varies)', () => {
  const by = (newest) => ({
    film: [{ id: 'f1', pubDate: '2026-11-02' }, { id: 'f2', pubDate: newest === 'film' ? '2026-11-09' : '2026-10-20' }],
    tv: [{ id: 't1', pubDate: '2026-11-03' }, { id: 't2', pubDate: newest === 'tv' ? '2026-11-09' : '2026-10-21' }],
    games: [{ id: 'g1', pubDate: '2026-11-04' }, { id: 'g2', pubDate: newest === 'games' ? '2026-11-09' : '2026-10-22' }],
  });
  const ids = (xs) => xs.map((x) => x.id);
  assert.deepEqual(ids(fillSlots(by('tv'), ['film', 'tv', 'games'])), ['f1', 't1', 'g1', 't2']);
  assert.deepEqual(ids(fillSlots(by('games'), ['film', 'tv', 'games'])), ['f1', 't1', 'g1', 'g2']);
  assert.deepEqual(ids(fillSlots(by('film'), ['film', 'tv', 'games'])), ['f1', 't1', 'g1', 'f2']);
  // Two topics stay 2 and 2 even when one has many newer stories.
  assert.deepEqual(ids(fillSlots(by('film'), ['film', 'tv'])), ['f1', 't1', 'f2', 't2']);
  // A topic short of its share hands the rest to the newest of the others.
  const thin = { film: [{ id: 'f1', pubDate: '2026-11-02' }, { id: 'f2', pubDate: '2026-11-01' }, { id: 'f3', pubDate: '2026-10-01' }], tv: [{ id: 't1', pubDate: '2026-11-05' }] };
  assert.deepEqual(ids(fillSlots(thin, ['film', 'tv'])), ['f1', 't1', 'f2', 'f3']);
  // The undated upcoming-event card fills its own share but never a leftover.
  const ev = { film: [{ id: 'f1', pubDate: '2026-11-02' }, { id: 'f2', pubDate: '2026-10-01' }], tv: [{ id: 't1', pubDate: '2026-11-03' }], events: [{ id: 'event' }] };
  assert.deepEqual(ids(fillSlots(ev, ['film', 'tv', 'events'])), ['f1', 't1', 'event', 'f2']);
});

test('Events with no story this week: the next upcoming event; with one, the story', () => {
  const event = { title: 'TwitchCon', latestHtml: '<L:event>' };
  assert.equal(topicCandidates([item('film', 1)], event).events[0].isUpcomingEvent, true);
  assert.equal(topicCandidates([item('events', 1)], event).events[0].title, 'events story 1');
  assert.deepEqual(topicCandidates([item('film', 1)], null).events, []);
});

test('the next upcoming event: soonest ahead, never a template, hidden or cancelled one', () => {
  const now = new Date('2026-10-31T20:00:00Z');
  const ev = (slug, startDate, over = {}) => ({ _type: 'event', title: slug, slug: { current: slug }, startDate, ...over });
  const docs = [
    ev('past', '2026-10-01'), ev('template', '2026-11-01', { isRecurringTemplate: true }), ev('hidden', '2026-11-02', { hidden: true }),
    ev('cancelled', '2026-11-03', { status: 'cancelled' }), ev('later', '2026-12-10'), ev('next', '2026-11-13', { endDate: '2026-11-15' }),
  ];
  assert.equal(selectUpcomingEvent(docs, now).title, 'next');
  assert.equal(selectUpcomingEvent([ev('past', '2026-10-01')], now), null);
});

test("the event card says only what the event document says", () => {
  const line = eventFactsLine({ startDate: '2026-11-13', endDate: '2026-11-15', location: { venue: 'San Diego Convention Center', city: 'San Diego', region: 'CA' } });
  assert.match(line, /^Nov 13.15, 2026 \| San Diego Convention Center, San Diego, CA$/);
  assert.equal(eventFactsLine({ startDate: '2026-12-10' }), 'Dec 10, 2026');
  assert.match(eventImageSource({ heroImage: 'image-97533eae5f9407f25d75d0ea5d4deef7317a7d9e-2560x1440-jpg' }), /^https:\/\/cdn\.sanity\.io\/images\/.+-2560x1440\.jpg\?w=1600$/);
  assert.equal(eventImageSource({}), null);
});

const feed = (items, extra = {}) => ({ version: 1, latestHeadingHtml: '<H>', alsoHeadingHtml: '<AH>', items, ...extra });
const NOW = Date.parse('2026-11-08T16:00:00Z');

test('topics layout: FEATURED, then one per topic for everyone, the event fallback included', () => {
  const items = [item('games', 7), item('film', 6), item('film', 5), item('tv', 4), item('games', 3)];
  const plan = planDraft(feed(items, { upcomingEvent: { title: 'TwitchCon', latestHtml: '<L:event>' } }), null, { LAYOUT: 'topics' }, NOW);
  assert.equal(plan.layout, 'topics');
  assert.equal(plan.newest.title, 'games story 7');
  assert.equal(plan.content, '<F:games7><H><L:film6><L:tv4><L:games3><L:event>');
  assert.ok(!plan.content.includes('<AH>'), 'no ALSO THIS WEEK by topic');
});

test('per reader: the Liquid picks exactly what fillSlots() picks, for every combination', async () => {
  // Dates chosen so the newest leftover is NOT the first topic in order: the
  // old fixed-turns rule and the current one disagree here.
  const items = [item('games', 9), item('tv', 8), item('games', 7), item('film', 6), item('tv', 5), item('film', 4), item('games', 3)];
  const f = feed(items, { upcomingEvent: { title: 'TwitchCon', latestHtml: '<L:event>' } });
  const plan = planDraft(f, null, { LAYOUT: 'topics', PERSONALIZE: 'true' }, NOW);
  assert.equal(plan.layout, 'topics-personalized');
  const engine = new Liquid();
  const combos = [[], ...Array.from({ length: 15 }, (_, mask) => TOPICS.filter((_, i) => (mask + 1) & (1 << i)))];
  for (const chosen of combos) {
    const html = await engine.parseAndRender(plan.content, { subscriber: { hq_topics: chosen.join(',') } });
    const expected = fillSlots(plan.byTopic, chosen.length ? chosen : TOPICS).map((x) => x.latestHtml);
    const shown = html.match(/<L:[a-z]+\d*>/g) ?? [];
    assert.deepEqual(shown, expected, `reader chose ${chosen.join(',') || 'nothing'}`);
    assert.ok(html.startsWith('<F:games9>'), 'FEATURED is the same for everyone');
    assert.equal(html.includes('<H>'), expected.length > 0, 'no heading over nothing');
  }
  // Capitals and spaces in the stored field do not matter.
  const tvOnly = await engine.parseAndRender(plan.content, { subscriber: { hq_topics: 'TV' } });
  assert.deepEqual(tvOnly.match(/<L:[a-z]+\d*>/g), ['<L:tv8>', '<L:tv5>']);
  // Three topics: one each plus the newest leftover (TV here, not Film).
  const three = await engine.parseAndRender(plan.content, { subscriber: { hq_topics: 'film,tv,games' } });
  assert.deepEqual(three.match(/<L:[a-z]+\d*>/g), ['<L:film6>', '<L:tv8>', '<L:games7>', '<L:tv5>']);
});

test('a headline that looks like Liquid stays text; the field key is checked', async () => {
  const sneaky = item('film', 2, { latestHtml: '<L:film2>{{ subscriber.email_address }}{% assign x = 1 %}' });
  const html = await new Liquid().parseAndRender(personalizedSlots({ film: [sneaky] }, '<H>'), { subscriber: { hq_topics: 'film', email_address: 'leak@x' } });
  assert.ok(html.includes('{{ subscriber.email_address }}'));
  assert.ok(!html.includes('leak@x'));
  assert.throws(() => personalizedSlots({}, '<H>', 'bad key"}}'), /not a Kit field key/);
});

// ─── owner's decisions (2026-10-31) ─────────────────────────────────────────

test('FEATURED is the newest unless the owner picks one; the newest still names the issue', () => {
  const items = [item('games', 7), item('film', 6), item('tv', 5)];
  const f = feed(items);
  const picked = planDraft(f, null, { LAYOUT: 'topics' }, NOW, { featuredPick: 'tv-5' });
  assert.equal(picked.stories[0].title, 'tv story 5');
  assert.equal(picked.featuredPicked, true);
  assert.equal(picked.newest.title, 'games story 7', 'the Kit marker and the next start point stay on the newest');
  assert.match(picked.description, /\[hq-dispatch newest=https:\/\/hq\.test\/games-7\]$/);
  assert.ok(picked.content.startsWith('<F:tv5><H><L:film6><L:games7>'), 'the newest moves into its topic slot');
  const missing = planDraft(f, null, { LAYOUT: 'topics' }, NOW, { featuredPick: 'not-this-week' });
  assert.equal(missing.stories[0].title, 'games story 7');
  assert.equal(missing.pickNotFound, 'not-this-week');
});

test('a story with no section can lead but never fills a topic slot', () => {
  const items = [item('none', 9, { topic: null, categories: ['Story'] }), item('film', 8)];
  const plan = planDraft(feed(items), null, { LAYOUT: 'topics' }, NOW);
  assert.equal(plan.stories[0].title, 'none story 9');
  const later = planDraft(feed([item('film', 9), item('none', 8, { topic: null, categories: ['Story'] })]), null, { LAYOUT: 'topics' }, NOW);
  assert.ok(!later.content.includes('<L:none8>'));
});
