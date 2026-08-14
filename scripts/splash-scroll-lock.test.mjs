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

  /* Either the shared helper or a raw scroll — what matters is that the
     document is forced to the top before the class lands. */
  const scrollIndex = Math.max(body.indexOf('jumpTo(0)'), body.indexOf('window.scrollTo(0, 0)'));
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
    /splash-armed[\s\S]{0,400}(jumpTo\(0\)|window\.scrollTo\(0,\s*0\))/,
    'a scroll listener must correct a non-zero offset while armed, in case ' +
      'the browser restores scroll AFTER the curtain is already up'
  );
});

console.log('\nEvery reset must JUMP, never animate:');

/*
  Files that scroll the page programmatically. Any new one belongs here — the
  point of the sweep is that it is not limited to the file that broke last.
*/
const SCROLLERS = [
  'src/components/Hero.astro',
  'src/components/Navbar.astro',
  'src/lib/scroll-lock.ts',
  'src/lib/scroll-to.ts',
];

test('no window.scrollTo() anywhere can animate by accident', () => {
  /*
    global-base.css sets `html { scroll-behavior: smooth }` for the whole site,
    so `window.scrollTo(0, 0)` does not jump — it ANIMATES from wherever the
    document currently is. On a refresh part-way down the homepage that turned
    the reset into a visible glide, and several of them firing in sequence read
    as a jarring up/down bounce before the reader was dumped at the top.

    A call is safe only if it states a behavior explicitly, or runs with
    scroll-behavior pinned to `auto` AND that pin actually flushed (see the
    next test). Anything else is a latent animation.
  */
  const offenders = [];

  for (const file of SCROLLERS) {
    const source = withoutComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    for (const match of source.matchAll(/window\.scrollTo\(/g)) {
      const call = source.slice(match.index, source.indexOf(')', match.index) + 1);
      if (/behavior\s*:/.test(call)) continue; // explicit — the author chose

      const preamble = source.slice(Math.max(0, match.index - 400), match.index);
      if (/scrollBehavior\s*=\s*['"]auto['"]/.test(preamble)) continue;

      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line} — ${call}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these calls inherit the global `scroll-behavior: smooth` and will animate. ' +
      'Route them through jumpTo() in src/lib/scroll-to.ts, or pass an explicit ' +
      'behavior:\n    ' +
      offenders.join('\n    ')
  );
});

test('pinning scroll-behavior is always followed by a forced style recalc', () => {
  /*
    THE SUBTLE ONE — this shipped broken in six places and looked correct.

    Setting `root.style.scrollBehavior = 'auto'` only marks style as dirty; it
    does not recalculate it. With no recalc before the scroll, scrollTo() still
    reads the OLD computed value — `smooth` — and animates; and the property is
    reverted immediately afterwards, so no later recalc ever sees `auto`
    either. The opt-out silently does nothing.

    Measured on the homepage, jumping from 390 to 0 and reading scrollY on the
    very next animation frame:

        pin html only ............ 390   ← still animating
        pin html + body .......... 390   ← still animating
        pin html + FLUSH ..........  0   ← a real jump
        behavior: 'instant' .......  0   ← a real jump

    So every pin must be followed by a layout read before the scroll.
    (`behavior: 'instant'` measures the same but only entered Safari's
    ScrollBehavior enum in 15.4, and an unknown enum value THROWS rather than
    degrading — see the note in src/lib/scroll-to.ts.)
  */
  const offenders = [];

  for (const file of SCROLLERS) {
    const source = withoutComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    for (const match of source.matchAll(/scrollBehavior\s*=\s*['"]auto['"]/g)) {
      // The flush has to land between the pin and the scroll that follows it.
      const after = source.slice(match.index, match.index + 400);
      const scrollAt = after.search(/window\.scrollTo\(/);
      if (scrollAt === -1) continue; // pin with no scroll after it — not this test's business

      const between = after.slice(0, scrollAt);
      if (/offsetHeight|offsetWidth|getBoundingClientRect|getComputedStyle/.test(between)) continue;

      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these pin scroll-behavior to `auto` and then scroll WITHOUT forcing a ' +
      'style recalc in between, so the pin never takes effect and the scroll ' +
      'animates anyway. Add `void root.offsetHeight;` after the assignment, or ' +
      'call jumpTo() from src/lib/scroll-to.ts:\n    ' +
      offenders.join('\n    ')
  );
});

test('the inline copy in Hero.astro matches the shared helper', () => {
  /*
    Hero's reset must run during parse, before any bundle has loaded, so it
    cannot import jumpTo() and carries its own copy. Two copies drift; this
    asserts the part that matters — the flush — is present in both.
  */
  const shared = fs.readFileSync(path.join(ROOT, 'src/lib/scroll-to.ts'), 'utf8');
  assert.match(
    withoutComments(shared),
    /scrollBehavior\s*=\s*'auto';[\s\S]{0,120}offsetHeight[\s\S]{0,120}window\.scrollTo/,
    'src/lib/scroll-to.ts must pin, flush, then scroll — in that order'
  );
  assert.match(
    withoutComments(hero),
    /function jumpToTop\(\)[\s\S]{0,400}offsetHeight[\s\S]{0,120}window\.scrollTo/,
    "Hero.astro's inline jumpToTop() has lost its forced recalc and now animates"
  );
});

test('a reload holds the top until the reader asks to leave it', () => {
  /*
    The three one-shot resets (immediate, next frame, pageshow) can each be
    beaten by a scroll restore that lands between them — measured: every
    restore timing tested painted 8-16 frames at the old offset, and one was
    never corrected at all. The guard makes it a condition rather than a
    schedule. scripts/e2e-reload-scroll.test.mjs measures the behaviour; this
    just stops the code being deleted.
  */
  assert.match(
    hero,
    /isReload[\s\S]{0,3000}addEventListener\(\s*'scroll'/,
    'the reload path must keep a scroll listener that re-pins the top, not ' +
      'just fire a fixed number of resets'
  );
  assert.match(
    hero,
    /touchstart[\s\S]{0,200}pointerdown|pointerdown[\s\S]{0,200}touchstart/,
    'the top-guard must release on the first real input, or it will fight a ' +
      'reader who scrolls immediately after refreshing'
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
