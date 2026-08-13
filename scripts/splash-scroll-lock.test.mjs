/*
  SPLASH SCROLL CONTRACT — a static guard on a regression that has shipped
  three times.

  THE REGRESSION
  Load the homepage, scroll away from the top, hit browser refresh. The reader
  is restored mid-page, cannot scroll UP, and a downward gesture replays the
  "INTO THE HQ" intro from a position the page was never at.

  WHY IT KEEPS COMING BACK
  The curtain freezes the page with `html.splash-armed { overflow: hidden }`.
  Overflow does NOT move the document — it freezes whatever offset the
  document already has. Arming is only ever correct at the top, but on a
  refresh iOS Safari restores the previous scroll offset around first paint,
  racing the reset in Hero.astro. Lose that race and the page is frozen
  mid-article. Adding `touch-action: none` on top removes the last escape and
  turns a glitch into a trap.

  Two things keep it fixed, and this file asserts BOTH, because each has been
  removed on its own before:

    1. `arm()` scrolls to the top BEFORE adding `.splash-armed`, so the frozen
       offset is the top by construction rather than by luck.
    2. `html.splash-armed` blocks scrolling with `overflow` ONLY — never
       `touch-action: none`, which leaves no way out when 1 is defeated.

  It also pins down what must NOT be used: the shared scroll lock
  (src/lib/scroll-lock.ts) pins <body> with `position: fixed`, which
  re-parents #app-wrapper's containing block mid-animation and makes the
  browser drop the curtain's transform transition. That path was measured and
  rejected; the comments in splash.css record it.

  Static and offline: plain `node scripts/splash-scroll-lock.test.mjs`.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const splashCss = fs.readFileSync(path.join(ROOT, 'src/styles/modules/splash.css'), 'utf8');
const hero = fs.readFileSync(path.join(ROOT, 'src/components/Hero.astro'), 'utf8');

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

/** The declaration block of `html.splash-armed` (the bare rule, not variants). */
function splashArmedBlock() {
  const match = splashCss.match(/html\.splash-armed\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, '`html.splash-armed` rule not found in splash.css');
  return match[1];
}

/** Strip CSS comments so prose about a property is not mistaken for the property. */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\nThe curtain must not remove the reader\'s escape route:');

test('html.splash-armed does NOT set touch-action', () => {
  const declarations = withoutComments(splashArmedBlock());
  assert.doesNotMatch(
    declarations,
    /touch-action\s*:/,
    'touch-action on the armed root kills touch scrolling outright. When the ' +
      'page is frozen at the wrong offset (Safari restoring scroll on refresh) ' +
      'this leaves the reader with no way to move at all.'
  );
});

test('html.splash-armed still blocks scrolling with overflow', () => {
  const declarations = withoutComments(splashArmedBlock());
  assert.match(
    declarations,
    /overflow\s*:\s*hidden/,
    'the curtain must still hold the page still while it is up'
  );
});

console.log('\nThe page must be AT the top before it is frozen:');

test('arm() scrolls to the top before adding .splash-armed', () => {
  const armBody = hero.match(/function arm\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(armBody, 'arm() not found in Hero.astro');
  const body = armBody[1];

  const scrollIndex = body.indexOf('window.scrollTo(0, 0)');
  const armIndex = body.indexOf("classList.add('splash-armed')");

  assert.notEqual(
    scrollIndex,
    -1,
    'arm() must force the document to the top before freezing it — without ' +
      'this the curtain freezes whatever offset the browser restored'
  );
  assert.notEqual(armIndex, -1, "arm() must add the 'splash-armed' class");
  assert.ok(
    scrollIndex < armIndex,
    'the scroll reset must come BEFORE the class is added; afterwards the ' +
      'document is already frozen and the reset is a no-op'
  );
});

test('a while-armed safety net snaps a stray offset back to the top', () => {
  assert.match(
    hero,
    /splash-armed[\s\S]{0,400}window\.scrollTo\(0,\s*0\)/,
    'a scroll listener must correct a non-zero offset while armed, in case ' +
      'the browser restores scroll AFTER the curtain is already up'
  );
});

console.log('\nEvery reset must JUMP, never animate:');

test('no window.scrollTo() in Hero.astro can animate by accident', () => {
  /*
    global-base.css sets `html { scroll-behavior: smooth }` for the whole site,
    so `window.scrollTo(0, 0)` does not jump — it ANIMATES from wherever the
    document currently is. On a refresh part-way down the homepage that turned
    the reset into a visible glide, and three of them firing in sequence (plus
    arm()'s own instant jump landing mid-flight) read as a jarring up/down
    bounce before the reader was dumped at the top.

    A call is safe only if it either states its behavior explicitly or runs
    with scroll-behavior pinned to `auto`. Anything else is a latent animation.
  */
  const source = withoutComments(hero);
  const offenders = [];

  for (const match of source.matchAll(/window\.scrollTo\(/g)) {
    const call = source.slice(match.index, source.indexOf(')', match.index) + 1);
    if (/behavior\s*:/.test(call)) continue; // explicit — smooth or instant, the author chose

    // Otherwise the surrounding block must have pinned scroll-behavior first.
    const preamble = source.slice(Math.max(0, match.index - 400), match.index);
    if (/scrollBehavior\s*=\s*['"]auto['"]/.test(preamble)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    offenders.push(`line ~${line}: ${call}`);
  }

  assert.deepEqual(
    offenders,
    [],
    'these calls inherit the global `scroll-behavior: smooth` and will animate. ' +
      "Wrap them in the save/`= 'auto'`/restore pattern used elsewhere in this " +
      'file, or pass an explicit behavior:\n    ' +
      offenders.join('\n    ')
  );
});

console.log('\nThe rejected approach stays rejected:');

test('the shared scroll lock is not used to hold the curtain', () => {
  const armBody = hero.match(/function arm\(\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.doesNotMatch(
    armBody.replace(/\/\*[\s\S]*?\*\//g, ''),
    /__hqScrollLock\s*\.\s*lock\s*\(/,
    'scroll-lock.ts pins <body> with position: fixed, which re-parents ' +
      "#app-wrapper's containing block mid-animation and drops the curtain's " +
      'transform transition. Measured and rejected — see splash.css.'
  );
});

test('the reason is recorded next to the code, not only here', () => {
  // A future reader edits the CSS, not this file. The warning has to be there.
  assert.match(
    splashCss,
    /touch-action/i,
    'splash.css must carry the note about why touch-action is absent'
  );
  assert.match(
    hero,
    /overflow: hidden|frozen|freez/i,
    'Hero.astro must explain why arm() pins the scroll position first'
  );
});

console.log(
  failed === 0 ? `\n✅ ${passed} passed, 0 failed.` : `\n❌ ${passed} passed, ${failed} failed.`
);
process.exit(failed === 0 ? 0 : 1);
