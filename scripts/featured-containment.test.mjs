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

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
