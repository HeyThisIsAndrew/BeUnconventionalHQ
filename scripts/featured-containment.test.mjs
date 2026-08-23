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

test('the trailer is back, and every reason it was a problem is guarded', () => {
  /*
    A YouTube embed used to play FULL-BLEED behind the deck. Its chrome could
    not be suppressed: `modestbranding` no longer removes the wordmark, and the
    play overlay and auto-generated captions render in the CENTRE of the frame,
    where no crop reaches them. I removed the video outright, which was an
    overcorrection — the ask was to stop the chrome showing, not to lose the
    trailer, and losing it is what made the right-hand side read as unfinished.

    It is back, INSET on a lit stage rather than full-bleed, so its chrome lands
    inside a smaller framed plate instead of across the artwork. These are the
    conditions it came back under.
  */
  assert.match(src, /brand-stage-iframe/, 'the trailer exists again');

  // HARD RULE 4. An empty src resolves to the current page and loads the whole
  // site inside the frame — a bug this page has actually shipped once.
  assert.doesNotMatch(src, /\.src\s*=\s*['"]{2}/, "never assign an iframe src = ''");
  assert.match(src, /src="about:blank"/, 'the idle src is about:blank');
  assert.match(src, /frame\.src = 'about:blank'/, 'teardown restores about:blank');

  // HARD RULE 3: no clipping ancestor. The stage is a SIBLING of the clipping
  // backdrop wrapper, never inside it — iOS Safari paints a clipped iframe as
  // a black box.
  const stageIdx = src.indexOf('class="brand-stage"');
  const wrapCloseIdx = src.indexOf('</div>', src.indexOf('trailer-bg-wrapper'));
  assert.ok(stageIdx > wrapCloseIdx, 'the stage must not be inside the clipping wrapper');
  const stageCss = src.slice(src.indexOf('.brand-stage {'));
  assert.doesNotMatch(
    stageCss.slice(0, stageCss.indexOf('}')),
    /overflow: hidden/,
    'nothing between the iframe and the page may clip',
  );
  const videoCss = src.slice(src.indexOf('.brand-stage-video {'));
  assert.doesNotMatch(
    videoCss.slice(0, videoCss.indexOf('}')),
    /overflow: hidden/,
    'the video frame must not clip either',
  );

  // It must not loop. Looping is what flashed YouTube's title bar back on
  // screen at every restart.
  assert.doesNotMatch(src, /[?&]loop=1/, 'the trailer must not loop');
  assert.match(src, /TRAILER_RUN_MS/, 'the trailer stops on a timer');

  // A frame whose document never loads paints white by default.
  const mediaCss = src.slice(src.indexOf('.brand-stage-iframe,'));
  assert.match(mediaCss.slice(0, mediaCss.indexOf('\n  }')), /background: #050505/,
    'an unloaded frame must not paint white');

  // Phones never load it — the info column is the plate behind the deck there,
  // so the player would cost ~900kB to render where it cannot be seen.
  assert.match(src, /min-width: 1024px/, 'the trailer is desktop-only in JS');
  const mq = src.slice(src.indexOf('@media (max-width: 1023px), (max-height: 620px)'));
  assert.match(mq.slice(0, 400), /\.brand-stage-video[\s\S]{0,60}display: none/,
    'the trailer is desktop-only in CSS too');
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

test('nothing is painted over the video, and its chrome is handled another way', () => {
  /*
    I had this backwards once: "feather the edges" meant the FRAME's edges,
    and I painted a vignette over the picture instead — which dimmed the
    trailer itself. Nothing may be drawn on top of the video. It reads as a
    layer because of the shadow under it, the way the poster does on a phone.

    Which leaves the chrome to be handled by timing and by source:

    - The frame loads while it is still at opacity 0 and is revealed only
      after the player has settled, so the title bar and spinner happen
      unseen. An embed cannot report its own state, hence a fixed settle.
    - A self-hosted file has NO chrome at all and reports `playing`, so where
      one exists it takes priority and the reveal is exact.
  */
  assert.doesNotMatch(src, /brand-stage-frame/, 'no gradient may overlay the picture');

  /*
    The ONE thing painted over the frame is the caption guard, and only because
    the band it covers is already black: these trailers are 2.39:1 inside a
    16:9 player, so the player letterboxes them and the caption track renders
    in that black. Captions follow the viewer's own preference — no player
    parameter stops them. A bar over the letterbox costs no picture; a gradient
    across the frame cost all of it.
  */
  const guard = src.slice(src.indexOf('.brand-stage-guard {'));
  const gdecl = guard.slice(0, guard.indexOf('  }'));
  assert.match(gdecl, /bottom: 0/, 'the guard sits at the bottom, where captions render');
  assert.doesNotMatch(gdecl, /linear-gradient/, 'the guard is a flat bar, never a fade');
  const h = gdecl.match(/height: (\d+)%/);
  assert.ok(h && Number(h[1]) >= 15 && Number(h[1]) <= 20,
    `the guard must clear the caption track without eating the frame (got ${h && h[1]}%)`);
  const vid = src.slice(src.indexOf('.brand-stage-video {'));
  const decl = vid.slice(0, vid.indexOf('  }'));
  assert.match(decl, /box-shadow:/, 'the layer read comes from a shadow under it');

  /*
    THE PLAYER HAS TO PROVE IT IS PLAYING BEFORE IT IS SHOWN.

    A fixed settle used to sit here, and it was solving the wrong problem. The
    chrome in the report was not the title bar during load — it was the player
    PAUSED, showing its title, its "More videos" strip and the YouTube logo,
    because autoplay had been blocked (Brave by default, some extensions, iOS
    Low Power Mode). No delay fixes that: nothing was ever going to start.

    So the reveal is driven by the player's own state (info === 1, PLAYING) over
    the enablejsapi postMessage channel, and a stage that never reports playing
    is torn down with the mark left up. Never show a paused player.
  */
  const arm = src.slice(src.indexOf('function armStage'), src.indexOf('function syncTrailers'));
  assert.match(src, /enablejsapi=1/, 'the state channel must be open');
  assert.match(arm, /state === 1/, 'reveal only on a confirmed PLAYING state');
  assert.match(arm, /TRAILER_PLAY_TIMEOUT_MS/, 'a player that never starts must time out');
  assert.match(arm, /is-playing[\s\S]{0,80}teardownStage/,
    'the timeout must tear the stage down, not reveal it anyway');
  assert.doesNotMatch(arm, /setTimeout\(reveal/,
    'the reveal must never be scheduled on a timer — that is what showed a paused player');
  assert.ok(
    arm.indexOf('frameEl.src =') < arm.indexOf('reveal()'),
    'src must be assigned before anything can reveal',
  );

  // The self-hosted path exists and wins.
  assert.match(src, /brand-stage-media/, 'a self-hosted file is supported');
  assert.match(src, /trailerFile \? \(/, 'a supplied file takes priority over the embed');
  assert.match(arm, /addEventListener\('playing'/, 'a file reveals on its first painted frame');
  // A <video> may be cleared by attribute; an IFRAME may never be (hard rule 4).
  assert.doesNotMatch(src, /frame\.removeAttribute\('src'\)/, "never clear an iframe's src");
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
  // self-hosted here; the display face is now too. The picker's other seven
  // faces stay remote because none of them ships.
  assert.match(src, /montserrat-500-latin\.woff2/, 'the shipping face must be local');
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
  const scoped = src.slice(src.indexOf('TEMPORARY typography demo'));
  assert.doesNotMatch(scoped, /data-demo-font='[a-z-]+'\]/,
    'no hardcoded per-face rules — they go stale the moment a face is added');

  // The self-hosted file must belong to the face that ships.
  const map = src.slice(src.indexOf('const SELF_HOSTED_FILES'), src.indexOf('const selfHostedFile'));
  const prod = src.match(/const PROD_FONT = '([a-z-]+)'/);
  assert.ok(prod, 'PROD_FONT must be declared');
  assert.ok(
    new RegExp(`\\b${prod[1]}: \\{`).test(map),
    `PROD_FONT is '${prod[1]}' but no self-hosted file is registered for it`,
  );
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

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
