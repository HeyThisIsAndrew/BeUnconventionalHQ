/*
  /featured — layout invariants that have each already shipped as a bug.

  Static assertions over the page source, in the style of the other guards in
  this directory: no browser, no network, no build step. They cannot prove the
  page LOOKS right — they exist to stop four specific regressions that were
  each found only after they reached a device.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'src', 'pages', 'featured', 'index.astro'), 'utf8');

/*
  Assertions run against the source with comments removed. Every rule below is
  about what the page DOES, and this file explains at length why — which means
  an un-stripped search finds its own reasoning and reports the bug it exists
  to prevent. `{/* … *\/}` (Astro), `/* … *\/` and `// …` all go.
*/
const src = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

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

console.log('\nfeatured/index.astro layout invariants');

test('the trailer wrapper is no TALLER than the panel it sits in', () => {
  /*
    It used to be 150% tall and clawed back with a second, intersected mask
    layer. WebKit does not honour `mask-composite` there, so the overhang
    painted 111px below the row on desktop and 74px on a landscape phone —
    over the footer, on the last row. Containment is the wrapper's own box
    now; nothing else is load-bearing.
  */
  const block = src.slice(src.indexOf('.trailer-bg-wrapper {'));
  const decl = block.slice(0, block.indexOf('}'));
  assert.match(decl, /height:\s*100%/, '.trailer-bg-wrapper must be height: 100%');
  assert.doesNotMatch(decl, /height:\s*150%/, '.trailer-bg-wrapper must not overhang vertically');
});

test('no mask-composite anywhere on this page', () => {
  assert.doesNotMatch(
    src,
    /mask-composite/,
    'a composited mask layer list is not reliable in WebKit — contain by box size and soften with a scrim instead',
  );
});

test('the hero card is a real link, not a div with a click handler', () => {
  // The keyboard, screen-reader, middle-click and open-in-new-tab paths all
  // depend on this being an anchor. A `data-href` + window.location pair
  // supports none of them.
  assert.match(src, /<a\s+[^>]*class=\{`deck-card /, 'the deck card must be an <a>');
  assert.doesNotMatch(src, /data-href/, 'no data-href indirection — use a real href');
  assert.doesNotMatch(src, /window\.location\.href\s*=/, 'no scripted navigation for the card');
});

test('the brand mark and the way in live ON the artwork', () => {
  for (const cls of ['deck-card-scrim', 'deck-card-plate', 'deck-card-enter']) {
    assert.ok(src.includes(cls), `${cls} is missing`);
  }
  // The old trailer-corner stack is what collided with the video on a phone.
  for (const gone of ['trailer-bottom-content', 'trailer-text-btn-row', 'dynamic-brand-btn']) {
    assert.ok(!src.includes(gone), `${gone} should be gone — the plate replaced it`);
  }
});

test('the hub rail only feathers a side that actually continues', () => {
  // A fixed 10%/90% ramp dimmed the first and last hub permanently, so two of
  // five looked disabled with nothing scrolled.
  assert.match(src, /--nav-fade-start:\s*0%/, 'the start ramp must default to zero');
  assert.match(src, /--nav-fade-end:\s*0%/, 'the end ramp must default to zero');
  assert.match(src, /data-overflow-start/, 'the script must report which side overflows');
  assert.match(src, /data-overflow-end/, 'the script must report which side overflows');
});

test('nothing inside the accordion has an intrinsic height', () => {
  /*
    The four rows fit the viewport only because their content contributes no
    min-content height. Giving `.deck-stack` an aspect-ratio closed a gap in
    portrait and, in the same stroke, gave every COLLAPSED row ~220px it could
    not shrink out of: the page grew to 1290px and the last row ran past the
    footer.
  */
  const stacks = src.split('.deck-stack {').slice(1);
  for (const block of stacks) {
    const decl = block.slice(0, block.indexOf('}'));
    assert.doesNotMatch(decl, /aspect-ratio/, '.deck-stack must not have an intrinsic aspect-ratio');
  }
});

test('the typeface demo is not trapped in a phone media query', () => {
  /*
    Every demo face and the picker's own styling sat inside
    `@media (max-width: 768px)`, so the picker did nothing on the screen it
    exists to choose a face for.
  */
  const queries = [];
  const re = /@media\s*\([^)]*max-width:\s*768px[^)]*\)[^{]*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let end = m.index;
    for (let j = m.index; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    queries.push(src.slice(m.index, end));
  }
  assert.ok(queries.length > 0, 'expected at least one phone media query');
  for (const body of queries) {
    for (const face of ['Syncopate', 'Bebas Neue', 'Cinzel', 'Oswald']) {
      assert.ok(!body.includes(`'${face}'`), `${face} must be declared outside the phone query`);
    }
    assert.ok(!body.includes('.font-picker-btn {'), 'the picker must be styled outside the phone query');
  }
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
