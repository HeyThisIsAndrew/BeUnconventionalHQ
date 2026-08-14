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

test('the mobile hero is sized in lvh', () => {
  const height = mobileHeroHeight();
  assert.equal(
    height,
    '100lvh',
    `mobile .hero height is "${height}".\n\n` +
      '      It must be 100lvh. 100svh leaves a gap at the bottom of an iPhone\n' +
      '      once Safari retracts its address bar, and the next section shows\n' +
      '      through. 100dvh removes the gap but re-resolves during scroll,\n' +
      '      which re-rasterizes the blurred .hero-bg and causes the jitter\n' +
      '      hero.css documents at length.\n',
  );
});

test('the mobile hero is NOT sized in svh or dvh', () => {
  const height = mobileHeroHeight();
  assert.ok(!height.includes('svh'), 'svh is too short — the next section peeks in');
  assert.ok(!height.includes('dvh'), 'dvh re-resolves during scroll and reintroduces the jitter');
});

/*
  ─── EVERY STYLESHEET, NOT JUST hero.css ────────────────────────────────────

  The original version of this file read hero.css and nothing else. That is
  precisely how the bug came back: landscape.css carries its OWN `.hero` rule
  with `min-height: 100svh`, landscape.css is imported LAST so it wins, and
  this guard never looked at it. hero.css was fixed to `lvh`, the test went
  green, and an iPhone in landscape still showed "EXPLORE THE HQ / WHAT WE
  COVER" under the hero — the same symptom, the same two section names, a
  different file.

  So the guard now scans every stylesheet in the modules directory for any
  `.hero` rule that sizes height or min-height in a viewport unit, and holds
  all of them to `lvh`. A new breakpoint file with its own hero height is
  covered the day it is written rather than the day someone remembers.
*/
const MODULES_DIR = path.join(ROOT, 'src/styles/modules');

/** Every `.hero { … height|min-height: <n><unit>; … }` across all modules. */
function allHeroViewportHeights() {
  const found = [];
  for (const file of fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');
    /* `.hero` exactly — not .hero-bg, .hero-title-stack, .hero-kicker. */
    for (const rule of css.matchAll(/\.hero\s*\{([^}]*)\}/gs)) {
      for (const decl of rule[1].matchAll(/(?:^|[\s;])(min-height|height)\s*:\s*([^;]+);/g)) {
        const value = decl[2].trim();
        if (/\d(?:svh|lvh|dvh|vh)\b/.test(value)) {
          found.push({ file, property: decl[1], value });
        }
      }
    }
  }
  return found;
}

test('no .hero rule in ANY stylesheet sizes height in svh or dvh', () => {
  const all = allHeroViewportHeights();
  assert.ok(
    all.length >= 2,
    `Only found ${all.length} .hero viewport height declaration(s). Expected at ` +
      `least the desktop base and one mobile/landscape override — has the ` +
      `selector or directory layout changed?`
  );

  /* The desktop base rule is plain `100vh` and is deliberately not lvh:
     desktop has no retracting chrome, so the distinction does not exist
     there. Only the mobile/landscape overrides matter. */
  const offenders = all.filter(
    ({ value }) => /svh|dvh/.test(value)
  );

  assert.deepEqual(
    offenders,
    [],
    `These .hero height declarations use svh or dvh:\n` +
      offenders.map((o) => `        ${o.file}: ${o.property}: ${o.value}`).join('\n') +
      `\n\n      They must be lvh.\n` +
      `      svh is the SMALLEST the viewport gets — when iOS Safari retracts\n` +
      `      its chrome the hero stops reaching the bottom and the next\n` +
      `      section ("EXPLORE THE HQ / WHAT WE COVER") shows underneath.\n` +
      `      dvh removes the gap but re-resolves during scroll, re-rasterizing\n` +
      `      the blurred .hero-bg and reintroducing the jitter.\n` +
      `      Remember landscape.css is imported LAST and overrides hero.css.\n`
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
