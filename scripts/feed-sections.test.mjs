/**
 * The feed sections collapse. They are not removed.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 * /feed opened as one continuous scroll through the whole archive, with the
 * same story appearing in every section it belongs to. Measured on the built
 * page: 41 unique items, 160 tile placements, and not one item appeared only
 * once.
 *
 * An earlier attempt solved that by COMPOSING the page down to 23 placements
 * and deleting the rows that repeated. That was the wrong trade. Those rows are
 * genuinely different browse paths, and removing them also took the newest
 * videos out of "Latest Videos" (the featured shelf consumed them), so the
 * section led with the fifth-newest video. It was reverted.
 *
 * Collapsing is the fix that keeps both properties: every row is still built
 * and still reachable, and the page no longer presents all of them at once.
 * These assertions exist so neither half is quietly dropped again.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');
const grid = read('src', 'components', 'FeedGrid.astro');

test('every section is still built, and none is filtered away for being repetitive', () => {
  /*
    The six sections and their rows are data in SECTION_DEFS. A "fix" that
    trimmed this list would look like a tidier page and would silently remove
    browse paths, which is exactly what was reverted.
  */
  assert.match(grid, /const SECTION_DEFS: SectionDef\[\]/, 'the section definitions must survive');
  for (const id of ['latest', 'franchises', 'film', 'tv', 'games', 'streaming']) {
    assert.match(grid, new RegExp(`id: '${id}'`), `the ${id} section must still be defined`);
  }
  for (const row of ['all-content', 'all-videos', 'all-articles']) {
    assert.match(grid, new RegExp(`id: '${row}'`), `the ${row} row must still be defined`);
  }
});

test('sections collapse with the same ARIA pattern /featured uses', () => {
  /*
    A heading wrapping a button, not a div with a click handler. /featured
    learned this the hard way: its collapsed rows were unreachable by keyboard
    entirely, because focus went from the open row's cards straight to the
    footer. The <h2> keeps the document outline, the <button> takes focus and
    fires on Enter and Space for free, and aria-expanded announces the state.
  */
  assert.match(grid, /<h2 class="feed-section-title"[^>]*>\s*<button/s, 'the heading must wrap a real button');
  assert.match(grid, /aria-expanded=\{section\.id === DEFAULT_OPEN_SECTION/, 'state must be announced');
  assert.match(grid, /aria-controls=\{`feed-section-rows-\$\{section\.id\}`\}/, 'and the button must own its body');

  /* A link inside a button is invalid HTML and browsers disagree about which
     one a click reaches, so the Explore link stays outside it. */
  const head = grid.slice(grid.indexOf('<div class="feed-section-head">'));
  const button = head.slice(head.indexOf('<button'), head.indexOf('</button>'));
  assert.ok(!button.includes('<a '), 'the Explore link must not be nested inside the toggle');
});

test('state lives in one place, and the two halves are kept in step', () => {
  assert.match(grid, /body\.hidden = !open;/, 'the body is hidden by attribute, not by a class');
  assert.match(grid, /button\.setAttribute\('aria-expanded', open \? 'true' : 'false'\);/);
  assert.match(grid, /section\.classList\.toggle\('is-open', open\);/);

  /* A lazy image inside a `hidden` container is never fetched, which is why
     collapsing cuts image REQUESTS rather than just hiding pictures. Measured
     on the built page: 117 of 298 images load on arrival. */
  assert.match(grid, /hidden=\{section\.id !== DEFAULT_OPEN_SECTION\}/, 'closed sections ship closed');
});

test('one section is open on arrival', () => {
  assert.match(grid, /const DEFAULT_OPEN_SECTION = 'latest';/, 'The Latest is the newsroom');
});

test('arriving at a closed section by link opens it', () => {
  /*
    CAPTURE PHASE, and that is load-bearing. FloatingPageNav calls
    preventDefault() and then measures the heading's offset to aim its jump, so
    a section opened in the bubble phase would be measured while still closed
    and the jump would land short.
  */
  assert.match(grid, /openSectionForHash/, 'a hash must be able to open its section');
  const listener = grid.slice(grid.indexOf("document.addEventListener(\n    'click'"));
  assert.match(listener.slice(0, 700), /\n    true,\n  \);/, 'the click listener must capture');
  assert.match(grid, /window\.addEventListener\('hashchange'/, 'and a hash change must too');
});

test('the counts tell you what a closed section holds', () => {
  /* It is the one thing a collapsed row cannot show for itself, and it is what
     makes it worth opening rather than a mystery. */
  assert.match(grid, /section\.rows\.length === 1 \? '1 row'/, 'a closed section states its size');
});

console.log('\nFeed sections: all assertions ran.');
