/*
  The homepage Events tile while an event is on (src/lib/hero-live-event.ts).

  Owner's call, 2026-10-31: the tile links to the ARTICLE by default; while an
  event is actively going on, that event takes the tile over and links to its
  event page; when it ends, the tile is the article again, automatically.

  Offline: the date logic is exercised directly with fixed clocks, and the
  wiring is read as source, in the style of the other guards here.
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  eventWindow,
  eventsWithoutClearWindow,
  heroLiveEventCandidates,
  pickLiveWindow,
  LIVE_EVENT_LOOKAHEAD_DAYS,
} from '../src/lib/hero-live-event.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');
const stripComments = (text) =>
  text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    failed += 1;
  }
}

/* Noon in Los Angeles on a given calendar day, as an instant. Built from
   UTC parts, never from new Date("YYYY-MM-DD") (hard rule 1). */
const laNoon = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 19, 0, 0));
const ev = (slug, startDate, endDate, extra = {}) => ({ slug: { current: slug }, startDate, endDate, ...extra });
const lacc = ev('la-comic-con-2026', '2026-10-30', '2026-11-01');

console.log('\nhomepage Events tile: active event override');

test('a window needs both dates, as days, in order', () => {
  assert.deepEqual(eventWindow(lacc), { slug: 'la-comic-con-2026', start: '2026-10-30', end: '2026-11-01' });
  assert.equal(eventWindow(ev('no-end', '2026-10-30', undefined)), null, 'a missing end is not a window');
  assert.equal(eventWindow(ev('no-start', undefined, '2026-10-30')), null);
  assert.equal(eventWindow(ev('backwards', '2026-11-02', '2026-11-01')), null);
  assert.equal(eventWindow(ev('not-a-day', 'soon', '2026-11-01')), null);
  assert.deepEqual(eventWindow(ev('one-day', '2026-12-10', '2026-12-10')), { slug: 'one-day', start: '2026-12-10', end: '2026-12-10' });
  assert.deepEqual(eventsWithoutClearWindow([lacc, ev('no-end', '2026-10-30')]), ['no-end']);
});

test('live from the first day through the last, then back to the article', () => {
  const w = [{ start: '2026-10-30', end: '2026-11-01' }];
  assert.equal(pickLiveWindow(w, laNoon(2026, 10, 29)), -1, 'the day before: article');
  assert.equal(pickLiveWindow(w, laNoon(2026, 10, 30)), 0, 'first day: event');
  assert.equal(pickLiveWindow(w, laNoon(2026, 11, 1)), 0, 'last day: still the event');
  assert.equal(pickLiveWindow(w, laNoon(2026, 11, 2)), -1, 'the day after: article again, no rebuild needed');
});

test('"today" is Los Angeles\' today, the site\'s one definition', () => {
  const w = [{ start: '2026-11-02', end: '2026-11-02' }];
  // 2026-11-02 05:00 UTC is still Nov 1 in Los Angeles.
  assert.equal(pickLiveWindow(w, new Date(Date.UTC(2026, 10, 2, 5, 0, 0))), -1);
  // 2026-11-02 09:00 UTC is Nov 2 in Los Angeles.
  assert.equal(pickLiveWindow(w, new Date(Date.UTC(2026, 10, 2, 9, 0, 0))), 0);
});

test('the build emits only events that can be live while the page is served', () => {
  const now = laNoon(2026, 10, 31);
  const events = [
    lacc,
    ev('twitchcon', '2026-11-13', '2026-11-15'),
    ev('over', '2026-10-08', '2026-10-11'),
    ev('far', '2026-12-10', '2026-12-10'),
    ev('cancelled', '2026-10-31', '2026-10-31', { status: 'cancelled' }),
    ev('postponed', '2026-10-31', '2026-10-31', { status: 'postponed' }),
    ev('no-end', '2026-10-31'),
  ];
  const slugs = heroLiveEventCandidates(events, now).map((c) => c.window.slug);
  assert.deepEqual(slugs, ['la-comic-con-2026', 'twitchcon'],
    `ended, cancelled, postponed, windowless and beyond ${LIVE_EVENT_LOOKAHEAD_DAYS} days are all left out`);
});

test('overlapping events resolve the same way everywhere: earliest start wins', () => {
  const now = laNoon(2026, 10, 10);
  const c = heroLiveEventCandidates([ev('pax-aus', '2026-10-09', '2026-10-11'), ev('nycc', '2026-10-08', '2026-10-11')], now);
  assert.deepEqual(c.map((x) => x.window.slug), ['nycc', 'pax-aus']);
  assert.equal(pickLiveWindow(c.map((x) => x.window), now), 0);
});

test('the tile is the article by default; the event only arrives through a dated template', () => {
  const binding = stripComments(read('src', 'data', 'homepage-feed.ts'));
  assert.match(binding, /panel\.key === 'events' && liveEvents\.length \? \{ liveEvents \}/,
    'only the Events tile may carry live events');
  assert.ok(!/findEventForArticle/.test(binding),
    'the old rule (an article tile re-routed to its event hub) must not come back');

  const panel = stripComments(read('src', 'components', 'home', 'HeroAccordionPanel.astro'));
  assert.match(panel, /: story\.url\}/, 'a panel links to its own story');

  const acc = stripComments(read('src', 'components', 'home', 'HeroAccordion.astro'));
  assert.match(acc, /<template data-acc-live=\{panel\.key\} data-start=\{live\.start\} data-end=\{live\.end\}>/,
    'event tiles must ship inside a dated <template>, never as the rendered tile');
  assert.match(acc, /pickLiveWindow\(/, 'the browser must decide with the shared date logic');
  assert.ok(acc.indexOf('swapInLiveEvents(root);') < acc.indexOf("querySelectorAll<HTMLElement>('[data-acc-panel]')"),
    'the swap must run before the accordion collects its panels');
  assert.match(acc, /<HeroAccordionPanel [^>]*deferred \/>/,
    'a template copy must not claim fetchpriority="high" (one per page)');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
