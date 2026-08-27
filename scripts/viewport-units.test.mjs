/*
  Static guard on viewport units that only misbehave on a real device.

  WHY THIS IS STATIC AND NOT A BROWSER TEST

  `svh`, `lvh` and `dvh` differ ONLY when the browser has chrome that
  retracts during scroll. Headless Chrome has none, so all three resolve to
  the same number and no e2e assertion can tell them apart — the bug is
  invisible to every automated test the project can run, and shows up only on
  a phone. Reading the stylesheet is the one check that discriminates, costs
  milliseconds, and cannot be fooled.

  THE BUG THIS PINS

  The mobile hero was `height: 100svh`. `svh` is the SMALLEST the viewport
  ever gets (address bar fully expanded). When iOS Safari retracts that bar
  mid-scroll the real viewport grows to `lvh`, the hero stops reaching the
  bottom of the screen, and the next section's header peeks in underneath —
  reported from an iPhone as "you can see the top of EXPLORE THE HQ / WHAT WE
  COVER at the bottom of the screen".

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

test('the mobile hero is MEASURED, with lvh as the no-JS fallback', () => {
  /*
    Was `assert.equal(height, '100lvh')`.

    `lvh` fixed the ORIGINAL bug (svh is the smallest viewport, so once Safari
    retracted its address bar the hero stopped reaching the bottom and the next
    section peeked in). But it reintroduced the same bug from the other side:
    `lvh` is the height with the chrome RETRACTED, and a fresh load starts with
    it EXPANDED, so the hero was again shorter than the screen. Reported on
    iPhone portrait, fresh load only.

    There is no static unit that is right in both chrome states. landscape.css
    already concluded this and sizes from the measured `--vv-height`; portrait
    now does the same. The fallback stays `100lvh` so a no-JS render ships
    exactly what it shipped before.
  */
  const height = mobileHeroHeight();
  assert.match(
    height,
    /^var\(--vv-height,\s*100lvh\)$/,
    `mobile .hero height is "${height}".\n\n` +
      '      It must be var(--vv-height, 100lvh). A STATIC unit cannot be right\n' +
      '      in both chrome states: svh is short once the address bar retracts,\n' +
      '      lvh is short on a fresh load before it has retracted, and dvh\n' +
      '      re-resolves during scroll, re-rasterizing the blurred .hero-bg and\n' +
      '      causing the jitter hero.css documents at length.\n',
  );
});

test('the portrait fallback is still lvh, never svh', () => {
  // If the fallback regressed to svh, a no-JS render would bring back the
  // ORIGINAL bug this rule was written for, and nothing else would catch it.
  assert.match(mobileHeroHeight(), /100lvh\)$/);
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

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
