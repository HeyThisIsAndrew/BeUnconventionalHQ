/*
  "The HQ Is Watching" loop clones must be born visible.

  The rail loops by cloning its cards before and after the real set, one
  viewport BEFORE it scrolls into view. The cards carry `.reveal` (opacity 0
  until Layout.astro's shared observer sets `data-state`), so the originals
  were still hidden when copied, and the observer never watches the clones:
  12 of 12 stayed at opacity 0. Pressing an arrow or scrolling fast showed an
  empty rail until the recentre snapped back to the real cards (reported on
  desktop, reproduced and fixed on the built site).

  Static and offline: plain `node scripts/watching-rail.test.mjs`.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/components/home/WatchingRail.astro'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '');

const makeClone = code.slice(code.indexOf('const makeClone'), code.indexOf('const setWidth'));
assert.ok(makeClone.length > 0, 'makeClone() not found in WatchingRail.astro');
assert.match(
  makeClone,
  /classList\.remove\(\s*'reveal'\s*,\s*'animate-on-scroll'\s*\)/,
  'makeClone() must strip the reveal classes, or every clone stays at opacity 0',
);
assert.match(
  makeClone,
  /querySelectorAll<HTMLElement>\('\.reveal, \.animate-on-scroll'\)/,
  'and it must strip them from the clone\'s descendants, not only the <li>',
);

/*
  A fast trackpad fling must neither hit an edge nor shift at rest. Measured
  with one clone set per side: a left fling reached 195px from the scroller's
  start, and a 140ms debounce recentred mid-snap, landing 100px off and
  animating 79 more frames.
*/
assert.match(code, /copies = Math\.max\(2,/, 'at least two clone sets per side, so a fling cannot reach an edge');
const onScroll = code.slice(code.indexOf('const onScroll'), code.indexOf('const onScrollEnd'));
assert.match(onScroll, /if \(!hasScrollEnd\)/, 'the debounce recentre is only a fallback for browsers without scrollend');
const recentre = code.slice(code.indexOf('const recentre'), code.indexOf('const enableLoop'));
assert.match(recentre, /scrollSnapType = 'none'/, 'the recentre jump pauses snapping, so it lands pixel-identical');
assert.match(recentre, /Math\.round\(/, 'the recentre moves by whole sets');

console.log('✅ Watching rail clones are born visible, and a fling neither hits an edge nor shifts at rest.');
