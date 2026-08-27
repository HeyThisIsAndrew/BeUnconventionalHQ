/*
  /featured — layout invariants that have each already shipped as a bug.

  Static assertions over the page source, in the style of the other guards in
  this directory: no browser, no network, no build step. They cannot prove the
  page LOOKS right — they exist to stop four specific regressions that were
  each found only after they reached a device.
*/
import { readFileSync, existsSync } from 'node:fs';
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

/*
  The page's own <style> block, comments removed.

  Several guards below are about what is declared in CSS, and `src` is the
  whole .astro file — frontmatter, markup and script included — so searching it
  finds the TypeScript that GENERATES a rule as readily as a hardcoded one.
  This narrows the search to the stylesheet.
*/
function styleBlock() {
  const open = raw.indexOf('\n<style>');
  const close = raw.indexOf('</style>', open);
  if (open === -1 || close === -1) throw new Error('featured/index.astro has no <style> block');
  return raw.slice(open + '\n<style>'.length, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

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

test('there is no player on /featured, and no page-relative iframe anywhere', () => {
  /*
    The trailer needed the right half of a 50/50 split, and that split has
    moved to the hub page where playback follows a CLICK. Every problem this
    page had came from autoplaying somebody else's embed on a screen nobody had
    clicked into — the paused-player chrome, the caption track, blocked
    autoplay. None of it applies once the player is somewhere a visitor chose
    to be.

    The player's CSS and controller are deliberately still in this file: they
    are what gets lifted onto the hub page, and lifting beats rewriting from
    memory. What must be true is that nothing RENDERS one here.
  */
  assert.doesNotMatch(src, /<iframe/, 'no iframe element on /featured');
  assert.doesNotMatch(src, /<video/, 'no video element on /featured');
  assert.doesNotMatch(src, /youtube-nocookie/, 'no embed URL rendered on /featured');

  // HARD RULE 4 still applies to anything this page ever grows.
  assert.doesNotMatch(src, /\.src\s*=\s*['"]{2}/, "never assign an iframe src = ''");
  assert.doesNotMatch(src, /src=""/, "an empty src resolves to the current page");

  // The mark is what carries the row now.
  assert.match(src, /brand-stage-mark/, "the hub's mark is the backdrop");
});


test('the same image is not painted three times in one row', () => {
  /*
    Reported as "way too much repetition of the same damn image", and it was
    literal: `heroImage` was the deck card, the nav rail thumbnail, AND — via
    getHubBackdrop()'s fallback — the blurred plate behind all of it. A hub
    with one asset was that one asset, three times, at three sizes.

    The panel is built from the hub's OTHER asset now: the logo, blown up and
    blurred as a haze, with the same file crisp in front of it. A supplied
    `backdrops[0]` override still wins, because that is an image chosen for
    this job rather than reused into it.
  */
  assert.match(src, /backdrop-plate--mark/, 'the ghost layer is the mark');
  assert.match(src, /const ghostUrl = brand\.logo/, 'the ghost comes from the logo');
  assert.match(src, /const markUrl = brand\.logo/, 'the stage subject comes from the logo');

  // The order matters: an explicit override beats the mark, and the mark beats
  // nothing. heroImage must not be reachable as this panel's backdrop.
  const panel = src.slice(src.indexOf('const backdrop = getHubBackdrop'), src.indexOf('class="stage-wash"'));
  assert.match(panel, /backdrop \?[\s\S]*ghostUrl \?/, 'override wins, then the mark');

  /*
    This assertion used to stop at the markup, and passed while the bug was
    still live: getHubBackdrop() falls back to `heroImage` INSIDE
    local-content.ts, so the panel never mentioned heroImage and DC went on
    painting the same still three times. The panel must call the override-only
    reader, and that reader must not reach for the key art.
  */
  assert.match(panel, /getHubBackdropOverride\(/, '/featured asks for the override only');
  const lib2 = readFileSync(join(here, '..', 'src', 'lib', 'local-content.ts'), 'utf8');
  const fn = lib2.slice(lib2.indexOf('export function getHubBackdropOverride'));
  assert.doesNotMatch(fn.slice(0, fn.indexOf('\n}')), /heroImage/,
    'the override reader must not fall back to the key art');
});

test('NOTHING on the right side of a row moves', () => {
  /*
    THE LIGHT LEAK. Reported three times; I twice fixed something else and
    twice claimed it was done.

    The cause was a 32s `scale(1) -> scale(1.06)` push-in on
    .trailer-bg-wrapper — the element that CLIPS. Scaling a clipping box scales
    the clip with it, so the wrapper's edge crept ~3% above and below the panel
    and carried the plate's near-sharp, under-blurred border out past the top
    and bottom scrims. Those scrims are SIBLINGS of the wrapper, laid out
    against .large-trailer-card, so they can never cover anything that leaves
    the wrapper's own box. The 32s ease-in-out is precisely why it read as a
    leak that GREW while the page sat idle.

    Raising the scrims to alpha 1 did not fix it and could not have. The fix is
    that this side of the row is static. If motion comes back here it must move
    something that is neither the clip nor its contents — and it has to get
    past this test first.
  */
  const rightSide = [
    '.trailer-bg-wrapper',
    '.backdrop-plate',
    '.trailer-fallback-img',
    '.large-trailer-card',
    '.brand-stage-mark',
  ];
  for (const cls of rightSide) {
    const i = src.indexOf(cls + ' {');
    if (i === -1) continue;
    const decl = src.slice(i, src.indexOf('}', i));
    assert.doesNotMatch(decl, /animation:/, `${cls} must not animate`);
  }
  // No rule anywhere may animate the clipping wrapper or the plate.
  assert.doesNotMatch(src, /trailerPush/, 'the push-in must stay gone');
  assert.doesNotMatch(src, /backdropDrift/, 'the plate drift must stay gone');
  assert.doesNotMatch(src, /slowPan/, 'the fallback pan must stay gone');

  // The scrims still reach alpha 1 — necessary, just never sufficient.
  for (const cls of ['.trailer-gradient-top', '.trailer-gradient-bottom']) {
    const block = src.slice(src.indexOf(cls + ' {'));
    const decl = block.slice(0, block.indexOf('}'));
    const first = decl.match(/linear-gradient\(to (?:bottom|top),\s*rgba\([\d,\s]*?([\d.]+)\)/);
    assert.ok(first, `${cls} must have a vertical gradient`);
    assert.strictEqual(first[1], '1', `${cls} must start fully opaque, not ${first[1]}`);
  }
});


test("the deck's feather does not reach the card's own controls", () => {
  /*
    The stack is masked so cards translated past its right edge dissolve
    instead of being cut. That ramp used to reach full opacity only at 62%
    from the right — but the front card is 85% wide, so its right third sat
    inside the fade and the "Enter" chip, which lands ~20-41% from that edge,
    was drawn at roughly a fifth of its opacity. Reported as the vignette
    obscuring it.

    The ramp has to be fully opaque before the chip starts.
  */
  const stack = src.slice(src.indexOf('.deck-stack {'));
  const decl = stack.slice(0, stack.indexOf('\n  }'));
  const full = decl.match(/rgba\(0,0,0,1\) (\d+)%\)/);
  assert.ok(full, 'the stack mask must reach full opacity somewhere');
  assert.ok(
    Number(full[1]) <= 19,
    `the feather reaches the card: full opacity at ${full[1]}% leaves the Enter chip faded`,
  );
  // And it must still land on zero at the box edge, or no-repeat cuts visibly.
  assert.match(decl, /rgba\(0,0,0,0\) 0%/, 'the ramp must reach zero at the edge');
});

test('the rows snap; nothing animates a layout property', () => {
  /*
    `transition: flex-basis 0.7s` forced a full layout and repaint of the
    accordion on every frame for 700ms, underneath a full-bleed blur. Measured
    at 412x823 with a 4x CPU throttle it ran p95 50ms with frames up to 87ms
    against a 16.7ms budget; snapping the geometry and letting the staged
    reveal carry the motion took it to p95 28ms with one janky frame.

    Anything that transitions a layout property here — flex, flex-basis, width,
    height, top, margin — puts it straight back.
  */
  const block = src.slice(src.indexOf('.accordion-section {'));
  const decl = block.slice(0, block.indexOf('}'));
  assert.doesNotMatch(
    decl,
    /transition:[^;]*(flex|width|height|margin|top|bottom|left|right)/,
    'a row must not transition a layout property',
  );
  // The motion lives in the staged reveal, which is opacity and transform only.
  assert.match(src, /transition-delay: 0\.\d+s/, 'the staged reveal must still be there');
});

test("a hub's backdrop is its OWN art, never borrowed footage", () => {
  /*
    The backdrop used to be a cross-fade of up to six stills gathered from the
    thumbnails of videos tagged to the hub, then from its category. Those
    thumbnails are the channel's own video covers, which are frequently a
    photograph of the presenter — so Marvel's backdrop could be, and was, the
    top of the site owner's head. A hub is somebody else's brand and cannot be
    backed by that.

    One image per hub, its own, or none. A hub with no art falls through to the
    brand-tinted ground the page already draws.
  */
  const lib = readFileSync(join(here, '..', 'src', 'lib', 'local-content.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(lib, /export function getHubBackdrop\b/, 'one backdrop per hub');
  assert.doesNotMatch(lib, /getHubBackdrops\b/, 'the multi-still gatherer must be gone');
  assert.doesNotMatch(lib, /thumbnailUrl/, "a hub must not borrow a video's thumbnail");
  assert.doesNotMatch(lib, /CATEGORY_TOPIC_FALLBACK/, 'a hub must not borrow from its category');

  // Blurred past detail, so the source stays small.
  assert.match(src, /width\(640\)/, 'the deck plate is requested small because it is blurred');
});

test('the blur is clipped, so its weak edge never shows', () => {
  /*
    A CSS blur goes WEAK at its own element's edges — it mixes in the
    transparent pixels outside — so the outermost band of a blurred element is
    the least blurred part of it. The plate is also scaled, which pushed it past
    its box and out behind the row heading. Together those put a strip of
    near-sharp artwork behind the category title, reported as "not blurred all
    the way to the top".

    The wrapper clips and the plate overscans past it, so what shows is the
    middle of the blur. Only safe because no iframe remains in this subtree —
    see hard rule 3.
  */
  const wrapper = src.slice(src.indexOf('.trailer-bg-wrapper {'));
  assert.match(wrapper.slice(0, wrapper.indexOf('}')), /overflow: hidden/, 'the wrapper must clip');

  const plate = src.slice(src.indexOf('.backdrop-plate {'));
  const decl = plate.slice(0, plate.indexOf('}'));
  assert.match(decl, /inset: -\d+%/, 'the plate must overscan past the clip');
  assert.match(decl, /filter: blur\(/, 'the plate must be blurred');

  // The drift is a transform on a static blur; animating the filter re-rasters.
  assert.doesNotMatch(src, /transition: filter/, 'do not animate the blur itself');
});

test('a row is sized by its own share, not by what its siblings leave over', () => {
  /*
    THIS IS THE ONE THAT COST A DAY.

    /featured is 42kB of HTML. On a throttled connection the parser lays out the
    first accordion row before the rest of the document arrives — sampled every
    frame, the container held ONE row at 742px at 200ms and four at
    536/69/69/69 by 338ms. With `flex: 1` / `flex: 8` a row's height depends on
    how many siblings it is sharing with, so every row that arrived resized
    every row already painted. That was a 0.276 cumulative layout shift, the
    worst metric on the site, and it failed the Lighthouse gate at 80%.

    Sizing by flex-BASIS against the container makes a row the same height
    whether it is alone in the DOM or the last of four. Any change back to a
    grow ratio brings the shift back, and it will only show up under throttling
    — which is why this is a test and not a comment.
  */
  const block = src.slice(src.indexOf('.accordion-section {'));
  const decl = block.slice(0, block.indexOf('}'));
  assert.match(decl, /flex: 0 0 calc\(100% \/ \(var\(--rows/, 'a collapsed row needs a fixed basis');
  assert.doesNotMatch(decl, /flex:\s*1;/, 'a grow ratio makes a row depend on its siblings');

  const exp = src.slice(src.indexOf('.accordion-section.expanded {'));
  const expDecl = exp.slice(0, exp.indexOf('}'));
  assert.match(expDecl, /flex: 0 0 calc\(800% \/ \(var\(--rows/, 'the open row needs a fixed basis too');

  // The basis is a share of the container, so the container's own height has to
  // be definite from the first layout — a percentage of a parent is not.
  const cont = src.slice(src.indexOf('.accordion-container {'));
  const contDecl = cont.slice(0, cont.indexOf('}'));
  assert.match(contDecl, /height: calc\(100lvh/, 'the container must be sized from the viewport');

  // --rows comes from the template, because a category with no hubs does not render.
  assert.match(src, /--rows: \$\{sortedCategories\.length\}/, '--rows must come from the data');
});

test('the shipping typeface is self-hosted, not a third-party stylesheet', () => {
  // A render-blocking stylesheet on another origin sits in the critical path of
  // a page whose whole layout is viewport-derived. Inter and Syne are already
  // self-hosted here; the display face is now too. The picker's other faces
  // stay remote because none of them ships.
  //
  // Asserted through PROD_FONT rather than against a filename: this test named
  // montserrat-500-latin.woff2 for two changes of shipping face after
  // Montserrat stopped being one, and passed both times on a file the page no
  // longer serves.
  const prod = src.match(/const PROD_FONT = '([a-z-]+)'/);
  assert.ok(prod, 'PROD_FONT must be declared');
  const map = src.slice(src.indexOf('const SELF_HOSTED_FILES'), src.indexOf('const selfHostedFile'));
  assert.match(
    map,
    new RegExp(`\\b${prod[1]}: \\{[^}]*file: '/fonts/`),
    `PROD_FONT is '${prod[1]}' but SELF_HOSTED_FILES serves it no local file`,
  );
  assert.match(src, /font-display: optional/, 'optional, so a late font never swaps under the reader');
  assert.match(src, /const REMOTE_FONTS/, 'the remote faces must be separated from the shipping one');
  assert.doesNotMatch(src, /@import url/, '@import is the slowest way to load CSS');
});

test('every candidate face is actually served, and none are hardcoded', () => {
  /*
    Two bugs, one symptom: every face from the fifth (Anton) rightward rendered
    in the body font while the first four worked.

    `display=optional` gives the browser ~100ms and PERMANENTLY declines a face
    that misses. Correct for one shipping face on a real page; wrong for a
    stylesheet naming seventeen families, where the first few land inside the
    window and the rest are silently dropped — in list order, which is why the
    failure looked like a cutoff partway along the picker.

    And the per-face CSS was written out twice: generated from DEMO_FONTS, and
    ALSO hardcoded for the original four. The duplicate covered a subset,
    omitted their tracking, and read as if it were the whole set.
  */
  const url = src.slice(src.indexOf('const fontImportUrl'), src.indexOf('const fontCss'));
  assert.doesNotMatch(url, /display=optional/,
    "the picker's stylesheet must not use display=optional — it drops faces past the first few");
  assert.match(url, /display=swap/, 'the comparison faces must be allowed to arrive late');

  // Exactly one place declares a face's rule, and it is generated.
  assert.match(src, /\[data-title-font='\$\{f\.id\}'\]/, 'per-face rules are generated from DEMO_FONTS');
  /*
    This used to slice from the string 'TEMPORARY typography demo', which is
    inside a COMMENT — and `src` has had its comments stripped. indexOf
    returned -1, slice(-1) handed back the file's last character, and the
    assertion below passed against one byte for as long as it existed. The
    duplicate it was written to catch was sitting in the file the whole time.
    Search the real stylesheet instead.
  */
  assert.doesNotMatch(styleBlock(), /data-demo-font='[a-z-]+'\]/,
    'no hardcoded per-face rules — they go stale the moment a face is added');
  assert.doesNotMatch(styleBlock(), /\[data-title-font='(?!demo')[a-z-]+'\]/,
    "no hardcoded per-face rules — only 'demo' may appear as a literal here");

  // The self-hosted file must belong to the face that ships.
  const map = src.slice(src.indexOf('const SELF_HOSTED_FILES'), src.indexOf('const selfHostedFile'));
  const prod = src.match(/const PROD_FONT = '([a-z-]+)'/);
  assert.ok(prod, 'PROD_FONT must be declared');
  assert.ok(
    new RegExp(`\\b${prod[1]}: \\{`).test(map),
    `PROD_FONT is '${prod[1]}' but no self-hosted file is registered for it`,
  );
});

test('one physical trackpad swipe can only ever move one card', () => {
  /*
    THE THIRD VERSION OF THIS GESTURE. Each earlier one shipped and was
    reported:

      1. debounced from the LAST wheel event, so macOS momentum held it for
         the whole tail. "one to three seconds per swipe."
      2. released on any RISING delta, but the deck fires part-way through the
         push while fingers are still accelerating, so the rest of that same
         push read as a new gesture. "one swipe moved two cards."
      3. released on any sample 2px above the previous one. Momentum is
         quantised and jitters up by more than 2px constantly, and a tail
         still running at 25px/event re-accumulates the 40px firing threshold
         in two events. Modelled against a realistic decaying tail with ±2px
         of noise, SIX OF EIGHT swipes advanced two cards. Reported as
         "sometimes it swipes through multiple carousels rather than one".

    Version three compares against the TROUGH, not the previous sample:
    momentum only decays, so its trough keeps falling and noise measured
    against the lowest point so far cannot clear it, while a real push
    re-accelerates past it many times over.

    MIN_FIRE_GAP is the unconditional backstop. Whatever the release logic
    concludes, no physical swipe moves two cards.
  */
  const gesture = src.slice(src.indexOf('const SWIPE_DELTA'), src.indexOf('// Deck Stack Clicks'));

  assert.match(gesture, /const MIN_FIRE_GAP = (\d+)/,
    'the hard cap on cards per swipe is gone; the release heuristic is then the ' +
      'only thing standing between one swipe and several, and it has been wrong twice');
  const gap = Number(gesture.match(/const MIN_FIRE_GAP = (\d+)/)[1]);
  assert.ok(gap >= 150 && gap <= 320,
    `MIN_FIRE_GAP is ${gap}ms. Below ~150 momentum can still re-trigger inside it; ` +
      `above ~320 it starts eating a deliberate second swipe, which is what the ` +
      `first version of this gesture was reported for.`);
  assert.match(gesture, /now - lastFire < MIN_FIRE_GAP/, 'the cap must actually gate the fire');

  assert.match(gesture, /trough/, 'the tail must be measured against its trough');
  assert.match(gesture, /abs < trough\) trough = abs/, 'the trough has to track downward');
  assert.match(gesture, /REARM_FLOOR/,
    'without a floor, a tail decayed to 1px re-arms on a 3px blip, which is 2.5x ' +
      'its trough and means nothing');

  assert.doesNotMatch(gesture, /abs <= lastAbs \+/,
    'releasing on a rise above the PREVIOUS sample is version three of this bug: ' +
      'momentum jitter clears it constantly');
});

test('the picker publishes variables; the scoped rules read them', () => {
  /*
    THE PICKER SET font-family AND LOST EVERY TIME.

    Its rules live in an inline <style> in the head. The `.accordion-title`
    rules they had to beat live in this component's SCOPED block, which Astro
    rewrites to `.accordion-title[data-astro-cid-…]` — one class plus one
    attribute, the same 0,2,0 as `[data-title-font='x'] .accordion-title`. The
    scoped sheet is emitted second, so the tie went to the base rule.

    Measured in dev with getComputedStyle before the fix: thirteen of the
    seventeen faces left the title in the previously-selected face, and the
    weight and tracking never moved for ANY of them. Four appeared to work,
    and only because a stale duplicate of the scoped block still hardcoded
    exactly those four further down the same sheet.

    Custom properties do not have that fight: they inherit, and the scoped
    rules opt in by reading them. Losing that indirection reinstates the bug
    silently, so it is pinned from both ends.
  */
  const fontCssAt = src.indexOf('const fontCss');
  // The CLOSING frontmatter fence. Searched from fontCss, not from 0 — the
  // first `---` in the file is the OPENING fence and the slice comes back empty.
  const gen = src.slice(fontCssAt, src.indexOf('\n---', fontCssAt));
  assert.match(gen, /--accordion-title-face:/, 'the picker must publish the face as a variable');
  assert.match(gen, /--accordion-title-weight:/, 'and its weight');
  assert.match(gen, /--accordion-title-tracking:/, 'and its tracking');
  assert.doesNotMatch(
    gen,
    /^\s*font-family:/m,
    'the generated rules must NOT set font-family — the scoped .accordion-title ' +
      'rule ties on specificity and is emitted later, so it wins and the picker ' +
      'does nothing',
  );

  const style = styleBlock();
  assert.match(
    style,
    /font-family: var\(\s*--accordion-title-face,/,
    '.accordion-title must read the picker variable, with the original stack as ' +
      'its fallback so a face that never arrives leaves the row untouched',
  );
  assert.match(style, /font-weight: var\(--accordion-title-weight,/,
    'the weight must come from the face, or a display face with one cut is synthesised');

  /*
    The demo-mode selector is gated on `[data-title-font='demo']` deliberately.
    Ungated, a per-row variable set on the title ELEMENT beats the picker's
    value inherited from <main>, and picker mode silently keeps showing the
    per-row demo assignment instead of the face that was pressed.
  */
  assert.match(
    gen,
    /\[data-title-font='demo'\] \.accordion-title\[data-demo-font=/,
    "demo-mode rules must be gated on [data-title-font='demo'] or picker mode cannot win",
  );
});

test('the featured stylesheet is not carrying a second copy of itself', () => {
  /*
    HOW THIS PAGE ACQUIRED A STALE TWIN.

    `feat(featured): one layout at every size` COPIED the desktop block rather
    than moving it, and the copy — an older revision, from
    `fix(featured): stop painting on the video` — was left LATER in the same
    sheet, where it quietly won. It reverted `.brand-stage` from the full plate
    back to the old two-column insets, put `.brand-stage-mark` back to 74%, and
    kept the four hardcoded per-face rules that made the typeface picker look
    like it half-worked. About 1,500 lines, silently in charge, for four days.

    These three counts are the cheapest thing that would have caught it: each
    belongs to a block that exists once by construction, and a duplicated
    region takes all three above one. Rules that are deliberately declared
    twice — the unwrapped "ONE LAYOUT, EVERY SIZE" overrides at the end — are
    not among them.
  */
  const style = styleBlock();
  /* Anchored to the start of a line, so a selector that merely ENDS in the
     name (`…:not([data-title-font='demo']) .accordion-title-demo-label`) is
     not counted as a second declaration of it. */
  const count = (selector) =>
    (style.match(new RegExp(`^\\s*\\${selector} \\{`, 'gm')) ?? []).length;

  assert.equal(count('.font-picker-btn'), 1,
    'the picker is styled in one place; a second copy means a duplicated region');
  assert.equal(count('.font-picker'), 1,
    'the picker is positioned in one place');
  assert.equal(count('.accordion-title-demo-label'), 1,
    'the demo label is styled in one place');

  /*
    And the orphan the same merge left behind: a `to { … }` with no
    `@keyframes` opening it, which a parser reads as a rule for a nonexistent
    <to> element followed by a stray brace. Inert, but it is how the block
    ended up unbalanced, and an unbalanced block is how a parser swallows the
    rules after it.
  */
  assert.doesNotMatch(style, /^\s*to \{/m,
    'an orphaned keyframe step — @keyframes was removed and its body left behind');
});

test("a hub's empty state carries no mark of ours", () => {
  /*
    The deck card used `.article-thumb-fallback`, and home-cards.css paints
    `--brand-fallback-mark` — this site's own logo — as a background on that
    class. Correct on our content cards; wrong on a hub tile, where it put BE
    UNCONVENTIONAL across PlayStation's artwork slot as though it were
    PlayStation's. Exactly the mistake that backing a hub with a video
    thumbnail made, in a different place.
  */
  assert.doesNotMatch(src, /article-thumb-fallback/,
    "a hub tile must not borrow the site's own fallback mark");
  assert.match(src, /deck-card-empty/, 'the empty state is the hub tile\'s own');
  const block = src.slice(src.indexOf('.deck-card-empty {'));
  const decl = block.slice(0, block.indexOf('\n  }'));
  assert.match(decl, /--brand-rgb/, "the empty state is tinted by the HUB's colour");
  assert.doesNotMatch(decl, /brand-fallback-mark|logo/, 'no mark of ours on it');
});

test('the row that is already open arms its own trailer', () => {
  /*
    syncTrailers() ran only from renderDeck() and the header click, and neither
    fires on load. The first row is expanded in the markup, so its trailer was
    never armed until something was clicked: reported as the video failing to
    start on DC until you switched to Marvel and back. Nothing was broken about
    playback — nothing had asked it to play.
  */
  const init = src.slice(src.indexOf('function initAccordionAndDecks'), src.indexOf('function initFontPicker'));
  const lastBrace = init.lastIndexOf('\n  }');
  const afterLoop = init.slice(init.lastIndexOf('});', lastBrace), lastBrace);
  assert.match(afterLoop, /syncTrailers\(\)/,
    'syncTrailers() must run once at init, not only from the click handlers');
});

test("the hub's mark scales with its artwork, not in fixed pixels", () => {
  /*
    A flat pixel height cannot be right at more than one screen size, and this
    was 26px everywhere: 11% of the card's height on a phone, which reads
    correctly, but 4.8% on an iPad and 4% on a 2000px display — which is what
    "way too small" was describing. The phone looked fine because the card is
    small there; the logo had not grown, the card had.

    It got that way from unwrapping the phone-only media query into the base
    layout: `height: 26px` was written for a 414px card and inherited by a
    1145px one.

    .deck-stack is a size container and .deck-card already measures against it,
    so the mark does too. Measured after: 10.5-11.2% of card height at 440,
    1024, 1366, 1512 and 2000 wide, with the phone unchanged.
  */
  const block = src.slice(src.indexOf('.deck-card-logo {'));
  const decl = block.slice(0, block.indexOf('\n  }'));
  assert.doesNotMatch(decl, /height: \d+px;/, 'a fixed pixel height is wrong at every size but one');
  assert.match(decl, /cqh|cqw/, 'the mark must measure against the card it sits on');
  assert.match(decl, /clamp\(/, 'it needs a floor for the phone and a ceiling for a huge display');

  // The override that was actually winning must stay gone.
  assert.ok(
    !/\.deck-card-logo \{\s*height: 26px;/.test(src),
    'the flat 26px override applied at EVERY width once the query was unwrapped',
  );
});

test('the hub hero rail never cuts a card at any edge', () => {
  /*
    Reported twice: the leftmost card cut off on DC, the rightmost on Marvel,
    and worse once selected — the active card scales 1.06, so parked flush it
    reaches further into the clip than it did at rest.

    Three things, each of which was individually broken:

    1. `overflow-x: auto` computes `overflow-y` to `auto` too, so the rail
       clips on all four sides. It needs padding on all four, not just the
       bottom.
    2. The fade must ramp ONLY where there is more to scroll to. A fixed ramp
       cannot tell "more over there" from "this is the end", so it dims a card
       that is simply the last one. Both ramps default to 0%. This is the same
       construct as the deck rail on /featured, where a fixed 10%/90% ramp made
       two of five hubs look permanently disabled.
    3. Bringing a card into view must be measured from bounding rects. The rail
       is not positioned, so a card's offsetParent is elsewhere and offsetLeft
       is not rail-relative — scrolling back to the FIRST card silently did
       nothing while scrolling to the last worked.

    Verified in a browser: every card selected in turn, on four viewports, on a
    hub with one item and one with five. None clipped.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /*
    `\n  .hub-rail {` — the BASE rule at two-space indent. A bare
    `.hub-rail {` also matches the tail of
    `.hero-grid-container.has-trailer .hub-rail {` inside the media query,
    which is indented four spaces, so the slice ran past its close and read the
    wrong declarations entirely. The assertion failed against a rule that was
    perfectly correct.
  */
  const railStart = hub.indexOf('\n  .hub-rail {');
  assert.ok(railStart > -1, 'the base .hub-rail rule must exist');
  const rail = hub.slice(railStart + 1);
  const decl = rail.slice(0, rail.indexOf('\n  }'));
  assert.doesNotMatch(decl, /padding-bottom: \d+px;\s*$/m, 'padding must be on all four sides');
  assert.match(decl, /padding: \d+px;/, 'a clipped rail needs room on every side');
  assert.match(decl, /--rail-fade-start, 0%/, 'the start ramp must default to zero');
  assert.match(decl, /--rail-fade-end, 0%/, 'the end ramp must default to zero');

  const js = hub.slice(hub.indexOf('function initHubRail'));
  assert.match(js, /scrollWidth - rail\.clientWidth/, 'the fade must know whether the rail overflows');
  assert.match(js, /getBoundingClientRect/, 'bring-into-view must not rely on offsetLeft');
  assert.doesNotMatch(js, /offsetLeft/, 'offsetLeft is not rail-relative here — it broke scrolling to the first card');
  assert.doesNotMatch(js, /behavior: 'smooth'/, 'a smooth scroll leaves the fade computing against a stale position');
});

test('the hub hero plays in its own panel, never in the modal', () => {
  /*
    The rail's Play button used the site's global [data-action="open-video"]
    handler, which opens the full-screen modal. Right for a card in a feed;
    wrong here, because this panel IS the player — a video launching a popup
    out of it reads as the page losing its place.

    The coverage feed BELOW the hero still uses the modal, which is correct.
    Only the hero's own action changed.

    Verified in a browser on iPhone and desktop, across three hubs: pressing
    Play leaves the modal closed, sets is-playing, and loads the embed into the
    stage's own frame.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const hero = hub.slice(hub.indexOf('hub-stage-item-copy'), hub.indexOf('</section>'));
  assert.doesNotMatch(hero, /data-action="open-video"/,
    'the hero must not hand its video to the full-screen modal');
  assert.match(hub, /data-hub-play=/, 'the hero plays in its own stage');
  assert.match(hub, /stage\.classList\.add\('is-playing'\)/, 'pressing play must reveal the stage frame');

  /*
    The frame must exist whenever ANYTHING can play in it, not only when the
    hub has its own trailer — a hub with no trailerUrl but a video in its rail
    still needs somewhere to play, and without this its Play button had no
    frame and fell back to the modal.
  */
  assert.match(hub, /hasPlayableVideo/, 'the frame is gated on any playable video, not just the trailer');

  /*
    NOTHING IS PAINTED OVER THE VIDEO. The caption guard is gone: it was
    covering picture on trailers whose letterbox it had been sized against, and
    YouTube's own UI showing is now accepted.
  */
  assert.doesNotMatch(hub, /hub-stage-guard/, 'no bar may cover the picture');
});

test('a hidden hub leaves the live site but stays visible in dev', () => {
  /*
    An unfinished hub should not be on the live site, but it must stay in front
    of the person finishing it — otherwise the only way to work on one is to
    keep toggling it back on.

    EXPLICIT, not inferred from whether a hub "has content". That was the other
    option and it is the wrong one: "no content" is ambiguous (no logo? no key
    art? no tagged videos?) and today almost every hub has artwork pending but
    zero tagged coverage, so an automatic rule would hide hubs that are ready.

    Verified against real builds: with `hidden: true` on PlayStation, the hub
    left /featured AND /featured/playstation stopped generating, while the
    Gaming row survived with Nintendo and Xbox. Unsetting it restored both.
  */
  const lib = readFileSync(join(here, '..', 'src', 'lib', 'local-content.ts'), 'utf8');
  const fn = lib.slice(lib.indexOf('export function getFeaturedBrandsLocal'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /import\.meta\.env\.DEV/, 'dev must show every hub regardless of the flag');
  assert.match(body, /d\.hidden !== true/, 'a production build must drop hidden hubs');

  /*
    An empty CATEGORY is structurally impossible, which is what makes this safe:
    /featured derives its rows FROM the hubs (group by hubCategory, take the
    keys), so a category whose hubs are all hidden has no key and never renders.
  */
  assert.match(src, /brands\.reduce/, 'rows are derived from the hubs, never a fixed list');
  assert.match(src, /Object\.keys\(groupedBrands\)/, 'a category with no hubs has no key');
  assert.match(src, /--rows: \$\{sortedCategories\.length\}/,
    'the accordion must size from the rows that survive, not a constant');
});

test('the hub rail centres, and cannot strand its first thumbnail', () => {
  /*
    The rail defaulted to flex-start, so a category with two or three hubs left
    its thumbnails jammed against the far left of a wide screen while the
    poster sat centred above them. Measured after the fix: rail group centre
    within 1px of the poster centre at 430, 1512 and 2000 wide.

    `safe center` is load-bearing, not a flourish. Plain `center` on a
    scrolling flex row is a known trap: once the contents overflow, the
    overflow is pushed past the container's START edge, and that direction
    cannot be scrolled to — the first thumbnails become permanently
    unreachable. `safe` reverts to flex-start exactly when overflow begins.
  */
  const i = src.indexOf('.deck-nav-track {');
  const decl = src.slice(i, src.indexOf('\n  }', i));
  assert.match(decl, /justify-content: safe center/, 'the rail must centre safely');
  assert.match(decl, /justify-content: center;[\s\S]*justify-content: safe center/,
    'plain center must be declared FIRST as the fallback for browsers without `safe`');
  assert.match(decl, /overflow-x: auto/, 'the rail still scrolls when it overflows');
});

test('the hub hero is the deck page\'s stage, and keeps its own height', () => {
  /*
    The hub hero is now the 50/50 that /featured used to carry: copy on the
    left, the hub's mark on the right dissolving to its trailer, with a
    feathered middle instead of a column boundary.

    THE HERO MUST NOT BE VIEWPORT-HEIGHT. An earlier attempt set it to
    `calc(100lvh - header)`, which is ~1286px on an iPad Pro portrait holding
    maybe 400px of content — reported as completely broken on both a tablet and
    a phone, and it was. Measured after this rebuild: 70% of the viewport on
    iPad portrait, iPad landscape, iPhone 17 Pro Max and desktop.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const hero = hub.slice(hub.indexOf('.event-hero {'));
  const hdecl = hero.slice(0, hero.indexOf('\n  }'));
  assert.doesNotMatch(hdecl, /height:\s*calc\(100lvh/, 'a viewport-height hero is a wall of nothing on a tablet');
  assert.doesNotMatch(hdecl, /position: sticky/, 'the pinned hero was reverted — it needs a different construction');

  // The stage, and the reasons it can exist here at all.
  assert.match(hub, /hub-stage-mark/, 'the mark is the resting state');
  assert.match(hub, /hub-stage-iframe/, 'the trailer exists');
  assert.match(hub, /src="about:blank"/, "HARD RULE 4: never src=''");
  assert.doesNotMatch(hub, /\.src\s*=\s*['"]{2}/, "HARD RULE 4: never assign src = ''");
  assert.match(hub, /enablejsapi=1/, 'the state channel must be open');
  assert.match(hub, /state === 1/, 'reveal only on a CONFIRMED playing state');
  assert.doesNotMatch(hub, /setTimeout\(reveal/, 'a timed reveal is what showed a paused player');

  // HARD RULE 3: the clipping plate is a SIBLING of the iframe, never above it.
  const stage = hub.slice(hub.indexOf('.hub-stage {'));
  assert.doesNotMatch(stage.slice(0, stage.indexOf('\n  }')), /overflow: hidden/,
    'nothing between the iframe and the page may clip');

  // The feathered middle, and the blur's weak edge kept outside the clip.
  const bg = hub.slice(hub.indexOf('.hub-stage-bg {'));
  const bdecl = bg.slice(0, bg.indexOf('\n  }'));
  assert.match(bdecl, /overflow: hidden/, 'the plate must clip so the blur\'s weak edge never shows');
  assert.match(bdecl, /mask-image: linear-gradient\(to right/, 'the middle must feather, not meet at a line');
  assert.ok((bdecl.match(/rgba\(0,0,0,/g) || []).length >= 8, 'multi-stop, or the ramp bands');

  const plate = hub.slice(hub.indexOf('.hub-stage-plate {'));
  const pdecl = plate.slice(0, plate.indexOf('\n  }'));
  assert.match(pdecl, /inset: -\d+%/, 'the plate must overscan its clip');
  assert.doesNotMatch(pdecl, /animation:/, 'scaling a clipping box was the light leak — nothing here moves');

  /*
    THE RAIL DRIVES THE STAGE, AND NOTHING IT SHOWS AUTOPLAYS.

    Picking an item swaps the stage to a still and a title. Playback happens
    only if the visitor presses Play, routed through the site's existing global
    [data-action="open-video"] handler — which is the whole reason this page can
    carry video at all. A player the visitor asked for is allowed to show its
    own controls, so none of the chrome problems that plagued the deck page
    apply here.

    Verified in a browser: 5 cards and 5 panes on Marvel, clicking card 1
    activates pane 1, sets is-item, and unloads the trailer to about:blank.
  */
  assert.match(hub, /hub-rail-card/, 'the hero features recent coverage');
  assert.match(hub, /<button\s+type="button"\s+class=\{`hub-rail-card/,
    'rail items must be real buttons — the deck shipped as divs once and was unreachable');
  assert.match(hub, /data-action="open-video"/, 'video panes reuse the site\'s modal handler');
  assert.match(hub, /pickHeroItems/, 'what the hero features must live in ONE function');

  // Articles are first-class here, not an afterthought.
  assert.match(hub, /contentType === 'video' \? 'Watch' : 'Read'/, 'articles feature too');

  // Choosing an item must UNLOAD the trailer, not merely hide it.
  const rail = hub.slice(hub.indexOf('function initHubRail'));
  assert.match(rail, /frame\.src = 'about:blank'/,
    'a hidden iframe still holds its document, its script and its connections');

  // Identity appears exactly once: the mark carries it, or the copy does.
  assert.match(hub, /event\.logo \?[\s\S]{0,120}sr-only/,
    'with a logo the h1 is sr-only — the mark on the stage is the visible name');
});

test('every category row is reachable and operable from the keyboard', () => {
  /*
    The headers were <div>s with a click handler. Focus went from the open row's
    cards straight to the footer, so the three CLOSED hubs could not be reached
    at all without a mouse — a design review found it by trying to Tab to them
    and failing.

    A heading wrapping a button is the ARIA accordion pattern: the <h2> keeps
    the document outline, the <button> takes focus and handles Enter and Space
    for free, and aria-expanded announces the state.
  */
  assert.match(src, /<h2 class="accordion-heading">/, 'the row label must stay a heading');
  assert.match(src, /<button\s+[\s\S]{0,200}?class="accordion-header"/, 'the header must be a button');
  assert.match(src, /aria-expanded=\{isExpanded/, 'the button must announce its state');
  assert.match(src, /aria-controls=\{`hub-row-\$\{category\}`\}/, 'the button must name the panel it controls');
  assert.match(src, /id=\{`hub-row-\$\{category\}`\}/, 'the panel needs the id aria-controls points at');
  assert.match(src, /setAttribute\('aria-expanded'/, 'the state must be kept in step on click');
  assert.match(src, /\.accordion-header:focus-visible/, 'a focusable control needs a visible focus ring');
});

test('pressing Play once is enough', () => {
  /*
    Reported: "it's requiring me to press the play icon and then the YouTube
    player refreshes, and then I have to hit a red play button".

    `autoplay=1` is REFUSED by every browser's autoplay policy while the video
    carries sound, and a refused autoplay is not an inert frame: YouTube swaps
    to its own poster and its own red button. So the first press looked like it
    reloaded the player and did nothing, and the video only started on a SECOND
    press inside somebody else's UI.

    Muted autoplay is never refused. The video starts muted and the sound is
    turned back on over the JS API on a confirmed PLAYING. If a browser refuses
    the unmute too (iOS is the strict one), the video is still running with
    YouTube's own controls up, one tap from sound.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // The URL the Play button writes, isolated from the resting trailer's.
  const at = hub.indexOf('data-hub-play');
  assert.ok(at > -1, 'the Play button must carry data-hub-play');
  /* Bounded to the press handler itself: the feed BELOW the hero legitimately
     binds [data-action="open-video"], and an unbounded slice swept it in. */
  const from = hub.indexOf('[data-hub-play]', at);
  const handler = hub.slice(from, from + 900);
  /* The embed URL lives in a helper now, because the press builds it twice:
     once asking for sound and once falling back. Assert on the helper. */
  const at2 = hub.indexOf('const embedUrl =');
  assert.ok(at2 > -1, 'the press must build its embed URL in one place');
  const url = hub.slice(at2, at2 + 600);

  assert.match(url, /autoplay=1/, 'one press must start it');
  assert.match(url, /enablejsapi=1/, 'without the API nothing can be asked of the player');
  assert.match(url, /origin=\$\{encodeURIComponent/, 'the player will not answer without an origin');
  assert.match(url, /playsinline=1/, 'iOS goes full screen without it');
  assert.doesNotMatch(url, /controls=0/, "a chosen video keeps the player's own controls");

  /*
    A VIDEO THE VISITOR PRESSED PLAY ON ASKS FOR SOUND. The resting trailer is
    muted because muted is the only state a browser starts on its own, but a
    press is not the trailer: they asked for it, and starting it silent is its
    own bug. So mute is decided BEFORE the frame loads, and the press tries
    mute=0 first.
  */
  assert.match(handler, /const withSound = !soundBlocked\(\)/, 'the press must try for sound');
  assert.match(handler, /embedUrl\(id, !withSound\)/, 'and open the video accordingly');
  assert.match(hub, /mute=\$\{muted \? '1' : '0'\}/, 'mute is decided per load, not hardcoded');

  /*
    And it CHECKS. A refused autoplay is not a dead frame: YouTube shows its own
    red button. So if the player has not reached PLAYING a moment later it is
    reloaded muted, and the answer is remembered for the tab so the next video
    does not pay the same wait.
  */
  assert.match(handler, /await didStart\(frame, HUB_SOUND_GRACE_MS\)/, 'the press must verify it started');
  assert.match(handler, /rememberSoundBlocked\(\)[\s\S]{0,140}embedUrl\(id, true\)/,
    'a refusal must fall back to muted, or the press is wasted');
  assert.match(handler, /token !== playToken/,
    'the fallback runs after an await and must not stomp a video chosen since');

  /*
    What it must NEVER do is unmute a video ALREADY running: playback under the
    muted-autoplay allowance is paused by the browser when script takes the mute
    away without activation in that frame, and YouTube stalls on its spinner.
    Reported as "starts for half a second, then it just infinitely loads".
  */
  assert.doesNotMatch(handler, /unMute/, 'never unmute a frame that is already playing');

  // It plays HERE. The modal was the previous bug and must not come back.
  assert.doesNotMatch(handler, /data-action="open-video"/, 'this panel is the player, not a modal trigger');

  /*
    And nothing may sit on top of the frame it just started. The picked rail
    card's pane is at full opacity until this rule zeroes it; without it the
    video plays behind an opaque still, which from the outside is exactly what
    a dead button looks like.
  */
  assert.match(hub, /\.hub-stage\.is-playing \.hub-stage-item \{[^}]*opacity: 0/,
    'a playing video must not be covered by the pane that launched it');
  assert.match(hub, /\.hub-stage\.is-playing \.hub-stage-item \{[^}]*visibility: hidden/,
    'opacity alone still leaves it hit-testable on top of the player');
});

test('a phone held sideways gets the two-column hero', () => {
  /*
    The split was gated on `min-width: 900px`, which reads as "desktop" and is
    wrong for what it decides. An iPhone 16/17 Pro in landscape is 874px and a
    Max is 932px, so the same gesture on two phones in the same hand produced
    two different layouts and the smaller one stacked.

    What decides whether copy and video sit side by side is whether the
    viewport is wider than it is tall. The 820px floor is measured: the hero
    bottoms out near 394px on its own content whatever the width, and below
    820 the devices are shorter than that, so the split ran off the bottom (93px
    over on an SE). Verified fitting at 844x390, 852x393, 874x402, 896x414,
    932x430 and 956x440.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const split = '@media (min-width: 900px), (orientation: landscape) and (min-width: 820px) {';
  assert.ok(hub.includes(split), 'the split must key off orientation, not width alone');

  /*
    The backdrop query must be the EXACT INVERSE. A flat `max-width: 1023px`
    overlapped the old split by a whole band, so a 900-1023px portrait viewport
    got two columns AND the full-bleed plate built for a stacked page.
  */
  const stacked = '@media (max-width: 899px) and (orientation: portrait), (max-width: 819px) {';
  assert.ok(hub.includes(stacked), 'the stacked backdrop must invert the split exactly');
  assert.ok(!hub.includes('@media (max-width: 1023px) {'),
    'the old flat breakpoint overlapped the split');

  // Desktop's header clearance is a vw clamp, so it GROWS with width — a third
  // of the screen on a 390px-tall phone. Short landscape has to opt out.
  assert.match(hub, /@media \(orientation: landscape\) and \(max-height: 450px\) \{[\s\S]{0,220}padding-top: 5\.25rem/,
    'a short landscape viewport cannot afford the full clearance');
});

test('the visitor can turn the sound on', () => {
  /*
    Everything on this stage starts muted, because muted is the only state a
    browser will start on its own. The trailer runs with controls=0, so without
    a control of ours there was no way to hear it at all: "the initial trailer
    doesn't have an unmute button, so you can never unmute it".

    And the button checks its own work. If the browser refuses the unmute it
    pauses the video, so the mute goes back on and playback resumes rather than
    leaving a spinner where the trailer was.
  */
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(hub, /class="hub-stage-sound"/, 'the stage needs a sound control');
  assert.match(hub, /<button type="button" class="hub-stage-sound"/, 'it must be a real button');
  assert.match(hub, /\.hub-stage\.is-playing \.hub-stage-sound \{[^}]*display: inline-flex/,
    'it only means anything while something is playing');

  // HARD RULE 3: it is a SIBLING of the video, never a clipping wrapper.
  assert.ok(hub.indexOf('class="hub-stage-sound"') > hub.indexOf('</div>\n            )}'),
    'the control sits outside the video wrapper');

  const ctl = hub.slice(hub.indexOf('function initHubSound'));
  assert.match(ctl, /send\('unMute'\)/, 'pressing it must ask for sound');
  assert.match(ctl, /send\('setVolume', \[100\]\)/, 'unmuting at volume zero is still silence');
  assert.match(ctl, /send\('mute'\);\n      send\('playVideo'\);/,
    'a refused unmute must be undone AND playback resumed, or the frame spins');
  assert.match(ctl, /state === 1 \|\| state === 3/, '3 is buffering, which is normal for a moment');
  assert.match(ctl, /aria-pressed/, 'a toggle must announce its state');
});

test('the shipping typeface actually has a file to ship', () => {
  /*
    PROD_FONT names the one face production emits. If SELF_HOSTED_FILES has no
    entry for it, no @font-face and no preload are written: the build succeeds,
    the page ships, and every heading renders in the fallback sans-serif. That
    is invisible until it is live, so the page throws at build time and this
    catches it offline first.
  */
  const m = src.match(/const PROD_FONT = '([^']+)'/);
  assert.ok(m, 'PROD_FONT must be declared');
  const font = m[1];

  const files = src.slice(src.indexOf('const SELF_HOSTED_FILES'));
  const entry = files.slice(0, files.indexOf('};')).match(
    new RegExp(`${font}:\\s*\\{[^}]*file: '([^']+)'`),
  );
  assert.ok(entry, `SELF_HOSTED_FILES has no entry for PROD_FONT '${font}'`);

  const onDisk = join(here, '..', 'public', entry[1].replace(/^\//, ''));
  assert.ok(existsSync(onDisk), `${entry[1]} is registered but not in public/`);
  const head = readFileSync(onDisk).subarray(0, 4).toString('latin1');
  assert.equal(head, 'wOF2', `${entry[1]} is not a woff2 file`);

  assert.match(src, /if \(!SELF_HOSTED_FILES\[PROD_FONT\]\)/,
    'the page must refuse to build with a face it cannot serve');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
