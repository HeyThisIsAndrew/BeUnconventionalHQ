/*
  Static guard on viewport units that only misbehave on a real device.

  WHY THIS IS STATIC AND NOT A BROWSER TEST

  `svh`, `lvh` and `dvh` differ ONLY when the browser has chrome that
  retracts during scroll. Headless Chrome has none, so all three resolve to
  the same number and no e2e assertion can tell them apart — the bug is
  invisible to every automated test the project can run, and shows up only on
  a phone. Reading the stylesheet is the one check that discriminates, costs
  milliseconds, and cannot be fooled.

  THE BUG THIS PINS — REPORTED, FIXED, AND CONFIRMED ON DEVICE

  The mobile hero was `height: 100svh`. `svh` is the SMALLEST the viewport
  ever gets (address bar fully expanded). When iOS Safari retracts that bar
  mid-scroll the real viewport grows to `lvh`, the hero stops reaching the
  bottom of the screen, and the next section's header peeks in underneath —
  reported from an iPhone as "you can see the top of EXPLORE THE HQ / WHAT WE
  COVER at the bottom of the screen".

  STATUS: RESOLVED. `100lvh` was verified on a physical iPhone in portrait,
  scrolling down and back to the top and letting the address bar retract
  mid-scroll. The leak does not occur. It took three attempts to get here
  (see the note on the assertion below), and the only thing that distinguishes
  the right unit from the wrong ones is a real device — so the guard stays,
  and stays static, for the reason set out above.

  `lvh` is the correct fixed value: never shorter than the visible area, and
  still a constant per orientation, so it keeps the anti-jitter property that
  `dvh` violates (see the long note in hero.css — `dvh` re-resolves during
  scroll and forces the blurred `.hero-bg` to re-rasterize).

  So all three units are meaningfully different here and the wrong one is a
  real, shipped, device-only bug. Hence a pin.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

const heroCss = fs.readFileSync(path.join(ROOT, 'src/styles/modules/hero.css'), 'utf8');

/**
 * The declaration inside the mobile/coarse-pointer block, which is the only
 * place the hero's height is overridden for phones. Matched by finding the
 * LAST `.hero {` rule that sets a height — the base rule at the top of the
 * file is the desktop `100vh` one and is not what this guards.
 */
function mobileHeroHeight() {
  const matches = [...heroCss.matchAll(/\.hero\s*\{[^}]*?height:\s*([^;]+);/gs)];
  assert.ok(matches.length >= 2, 'expected a base .hero height and a mobile override');
  return matches[matches.length - 1][1].trim();
}

console.log('Hero viewport unit:');

test('the mobile hero is sized in lvh, NOT a measurement', () => {
  /*
    This assertion has now been wrong in both directions, so both are recorded.

    `svh` was the ORIGINAL bug: it is the SMALLEST viewport, so once Safari
    retracted its address bar the hero stopped reaching the bottom and the
    next section peeked in. Changed to `lvh`.

    `var(--vv-height, 100lvh)` was the attempted fix for a fresh-load report
    of the same symptom, and on a real iPhone it made things WORSE.
    visualViewport is the SMALL viewport; the LAYOUT viewport is the large
    one, and iOS paints content behind and below the translucent toolbar. A
    hero sized to the visual viewport is shorter than the layout viewport,
    and that gap is exactly where the next section showed through.

    `lvh` IS the layout viewport, so the hero reaches its bottom in every
    chrome state. landscape.css can measure only because it uses the value as
    a MIN-bound on an auto-sized box; this rule is an outright size, where
    too small is a visible gap.
  */
  const height = mobileHeroHeight();
  assert.equal(
    height,
    '100lvh',
    `mobile .hero height is "${height}".\n\n` +
      '      It must be 100lvh. svh is short once the address bar retracts;\n' +
      '      dvh re-resolves during scroll and re-rasterizes the blurred\n' +
      '      .hero-bg; and a measured visualViewport height is SHORTER than\n' +
      '      the layout viewport, which is what put the next section under\n' +
      '      the toolbar on a real device. All three have been tried.\n',
  );
});

test('the mobile hero is NOT sized in svh or dvh', () => {
  const height = mobileHeroHeight();
  assert.ok(!height.includes('svh'), 'svh is too short — the next section peeks in');
  assert.ok(!height.includes('dvh'), 'dvh re-resolves during scroll and reintroduces the jitter');
});

/*
  ─── LANDSCAPE IS MEASURED, NOT GUESSED ─────────────────────────────────────

  landscape.css carries its OWN `.hero` rule and is imported LAST, so it wins.
  This guard used to read hero.css alone, which is how the landscape copy kept
  a unit the portrait copy had already been fixed away from.

  Landscape is also where no static unit works at all. The chrome is a large
  fraction of a short viewport, and both options were tried on a real device
  and both were photographed failing — `100svh` leaves the next section
  showing underneath when the reader arrives with the chrome retracted;
  `100lvh` pushes the centred content down when they arrive with it expanded.
  `100dvh` fixes both and reintroduces the .hero-bg jitter.

  So landscape sizes the hero from `--vv-height` — the real
  visualViewport.height, seeded inline before first paint and republished only
  on rotation. This is the ONLY check that can tell a measurement from a unit:
  in Chromium all three units resolve to the same number as the measurement,
  so no browser assertion can discriminate. That is exactly how the unit was
  got wrong twice.
*/
/* Comments stripped first: landscape.css quotes `.hero { padding-top: 5.5rem }`
   inside its LOAD-BEARING note, and a naive match finds that example instead
   of the real rule. */
const landscapeCss = fs
  .readFileSync(path.join(ROOT, 'src/styles/modules/landscape.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the landscape hero is MEASURED (--vv-height), not sized in a viewport unit', () => {
  const rule = landscapeCss.match(/\.hero\s*\{([^}]*)\}/s);
  assert.ok(rule, 'landscape.css no longer has a .hero rule — has it been renamed?');

  const minHeight = rule[1].match(/min-height:\s*([^;]+);/);
  assert.ok(minHeight, 'the landscape .hero rule sets no min-height');

  const value = minHeight[1].trim();
  assert.ok(
    value.startsWith('var(--vv-height'),
    `landscape .hero min-height is "${value}".\n\n` +
      '      It must be var(--vv-height, <fallback>).\n' +
      '      100svh leaves a gap when the reader arrives with the chrome\n' +
      '      already retracted — after scrolling on the previous page, or\n' +
      '      after a rotation — and the next section shows underneath.\n' +
      '      100lvh pushes the centred content down when they arrive with the\n' +
      '      chrome expanded. Both were photographed on the device.\n' +
      '      100dvh fixes both and re-rasterizes the blurred .hero-bg on every\n' +
      '      scroll, which is the jitter hero.css rejects.\n' +
      '      Only a measurement is right in every chrome state.\n',
  );

  assert.ok(
    /var\(--vv-height,\s*100svh\)/.test(value),
    `landscape .hero min-height is "${value}" — the fallback must be 100svh, ` +
      `which is what this rule shipped before JS was involved, so a reader ` +
      `without scripting sees exactly the previous behaviour rather than ` +
      `a hero with no height at all.`,
  );
});

test('--vv-height is seeded inline, before the hero can paint', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'src/layouts/Layout.astro'), 'utf8');
  assert.ok(
    /is:inline[\s\S]{0,2000}--vv-height/.test(layout),
    'Layout.astro no longer seeds --vv-height from an is:inline script. It has ' +
      'to be set before first paint: the hero is the first thing on screen and ' +
      'the splash measures its lift from it, so waiting for a module means the ' +
      'hero paints at the fallback height and then resizes.',
  );
});

test('viewport-anchor republishes --vv-height, and only on rotation', () => {
  const anchor = fs.readFileSync(path.join(ROOT, 'src/lib/viewport-anchor.ts'), 'utf8');
  assert.ok(
    /--vv-height/.test(anchor),
    'viewport-anchor.ts no longer publishes --vv-height, so a rotation leaves ' +
      'the hero at the height of the orientation it no longer has — the ' +
      'reported bug: "load the homepage and then rotate your phone".',
  );

  /* The call must be reachable from the rotation settling path and NOT from
     the geometry/scroll path, which is where a chrome collapse arrives. */
  const refreshBody = anchor.slice(
    anchor.indexOf('const refresh = ()'),
    anchor.indexOf('const schedule = ()'),
  );
  assert.ok(
    !/publishViewportHeight\s*\(/.test(refreshBody),
    'publishViewportHeight() is called from refresh(), which runs on ' +
      'visualViewport scroll/resize — that is a chrome collapse. Republishing ' +
      'there resizes the hero mid-scroll and re-rasterizes the blurred ' +
      '.hero-bg: the exact jitter 100dvh was rejected for. It belongs only in ' +
      'the rotation settling path.',
  );
});

test('the rationale stays next to the rule', () => {
  // This is the only place the reasoning lives. If someone strips the comment
  // the next person has no way to know why the unit is not the obvious one.
  assert.ok(
    /lvh/.test(heroCss) && /svh/.test(heroCss) && /dvh/.test(heroCss),
    'hero.css should still explain all three units and why lvh wins',
  );
});

/*
  ─── THE VIEWPORT META MUST PRECEDE ANYTHING THAT MEASURES ─────────────────

  MEASURED, not theorised. With the seed script running BEFORE this tag:

    cumulative-layout-shift  0.69   (metric score 7/100)
    performance              73%    samples 73 / 96 / 73
    single shifting element  section.hero > .hero-bg > .hero-bg-inner
                             > .hero-bg-gradient

  With the tag hoisted above it, same build, same harness:

    cumulative-layout-shift  0      performance 97%

  Until <meta name="viewport"> is parsed, a mobile browser lays out at its
  default desktop-ish width, so visualViewport.height is a height the page
  never renders at. That did not matter while the hero was sized in `lvh` and
  ignored the measurement. The moment the hero was sized FROM it, the hero
  painted at one height and resized to another, and `.hero-bg` — inset -10%
  off `.hero` — dragged its children with it.

  So this is not a style preference. It is load-bearing for both the hero
  height and the landscape rule in landscape.css.
*/
test('the viewport meta is parsed before --vv-height is measured', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'src/layouts/Layout.astro'), 'utf8');
  const viewport = layout.indexOf('name="viewport"');
  const seed = layout.indexOf("setProperty('--vv-height'");
  assert.ok(viewport !== -1, 'the viewport meta tag is gone');
  assert.ok(seed !== -1, 'the --vv-height seed is gone');
  assert.ok(
    viewport < seed,
    'The viewport meta must come BEFORE the script that reads visualViewport.height.\n' +
      '      Measured with it after: CLS 0.69 and performance 73% on the homepage.\n' +
      '      Measured with it before: CLS 0 and performance 97%.',
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
