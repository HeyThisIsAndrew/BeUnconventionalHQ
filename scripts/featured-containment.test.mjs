/*
  /featured — layout invariants that have each already shipped as a bug.

  Static assertions over the page source, in the style of the other guards in
  this directory: no browser, no network, no build step. They cannot prove the
  page LOOKS right — they exist to stop specific regressions that were each
  found only after they reached a device.

  Architecture change (Sept 2026): /featured/index.astro was refactored from a
  full-viewport accordion/deck design to a category-grouped card grid with
  vanilla JS filter pills. The tests below validate the NEW architecture.
  Hub detail page tests (/featured/[slug].astro) are unchanged.
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

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 1: /featured/index.astro — Category-Grouped Card Grid
// ═══════════════════════════════════════════════════════════════════════════

test('no mask-composite anywhere on this page', () => {
  assert.doesNotMatch(
    src,
    /mask-composite/,
    'a composited mask layer list is not reliable in WebKit — contain by box size and soften with a scrim instead',
  );
});

test('every hub card is a real link, not a div with a click handler', () => {
  /*
    The keyboard, screen-reader, middle-click and open-in-new-tab paths all
    depend on this being an anchor. A `data-href` + window.location pair
    supports none of them.
  */
  assert.match(src, /<a\s+[^>]*class="brand-card"/, 'the brand card must be an <a>');
  assert.doesNotMatch(src, /data-href/, 'no data-href indirection — use a real href');
  assert.doesNotMatch(src, /window\.location\.href\s*=/, 'no scripted navigation for the card');
});

test('there is no player on /featured, and no page-relative iframe anywhere', () => {
  /*
    The old accordion page had player/trailer issues. The refactored card-grid
    page must never render a player — it is a directory, not a viewer.
  */
  assert.doesNotMatch(src, /<iframe/, 'no iframe element on /featured');
  assert.doesNotMatch(src, /<video/, 'no video element on /featured');
  assert.doesNotMatch(src, /youtube-nocookie/, 'no embed URL rendered on /featured');

  // HARD RULE 4 still applies to anything this page ever grows.
  assert.doesNotMatch(src, /\.src\s*=\s*['""]{2}/, "never assign an iframe src = ''");
  assert.doesNotMatch(src, /src=""/, "an empty src resolves to the current page");
});

test('category sections are semantic and carry data-category attributes', () => {
  /*
    Each category group must be a <section> with a data-category attribute so
    the filter script can toggle visibility at the section level.
  */
  assert.match(src, /<section class="featured-category-section" data-category=\{cat\}/,
    'each category must be a semantic <section> with data-category');
  assert.match(src, /<h2 class="category-heading">/,
    'each category needs a cinematic <h2> label');
});

test('the category labels are the four canonical groups', () => {
  /*
    The labels must match the user's specification: "The Universes",
    "Streaming", "The Studios", "Gaming".
  */
  for (const label of ['The Universes', 'Streaming', 'The Studios', 'Gaming']) {
    assert.ok(src.includes(`'${label}'`), `missing category label: ${label}`);
  }
});

test('category grouping derives from hub data, not a hardcoded list of slugs only', () => {
  /*
    The page must prefer `hubCategory` from the CMS, with the categoryMap as
    a fallback. This ensures newly added hubs with a hubCategory field are
    placed correctly without editing page code.
  */
  assert.match(src, /brand\.hubCategory \|\| categoryMap/,
    'category must first check hubCategory, then fall back to categoryMap');
  assert.match(src, /brands\.reduce/, 'rows are derived from the hubs, never a fixed list');
  assert.match(src, /Object\.keys\(groupedBrands\)/, 'a category with no hubs has no key');
});

test('the mobile grid uses the bulletproof minmax constraint', () => {
  /*
    The grid MUST use minmax(min(100%, 320px), 1fr) to prevent horizontal
    overflow on small viewports. Any other formulation risks card text blowout.
  */
  const style = styleBlock();
  assert.match(style, /minmax\(min\(100%, 320px\), 1fr\)/,
    'the grid must use the bulletproof min(100%, 320px) constraint');
  assert.match(style, /display: grid/, '.brand-grid must be a CSS grid');
  assert.match(style, /repeat\(auto-fill/, 'auto-fill distributes cards responsively');
});

test('brand cards have a 16/9 aspect ratio', () => {
  const style = styleBlock();
  assert.match(style, /aspect-ratio: 16 \/ 9/,
    'brand cards must be 16:9 to match the cinematic feel');
});

test('brand cards use proper image containment', () => {
  const style = styleBlock();
  assert.match(style, /object-fit: cover/,
    'images must cover their container without distortion');
  assert.match(style, /overflow: hidden/,
    'cards must clip overflowing content');
});

test('the filter pills are real buttons with aria-pressed', () => {
  /*
    Filter pills must be <button> elements (not divs) with proper
    aria-pressed attributes for accessibility.
  */
  assert.match(src, /<button\s+[^>]*class="filter-pill"/,
    'filter pills must be real <button> elements');
  assert.match(src, /aria-pressed="false"/,
    'pills must start with aria-pressed="false"');
});

test('the filter script toggles section visibility correctly', () => {
  /*
    The vanilla JS filter must:
    1. Toggle aria-pressed on the clicked pill
    2. Deselect all others when one is selected
    3. Show all sections when none are selected (null-state rule)
    4. Hide non-matching sections
  */
  assert.match(src, /initFeaturedFilters/,
    'the filter initialization function must exist');
  assert.match(src, /aria-pressed.*true/,
    'the script must check aria-pressed state');
  assert.match(src, /style\.display = 'block'/,
    'matching sections must be shown');
  assert.match(src, /style\.display = 'none'/,
    'non-matching sections must be hidden');
  assert.match(src, /!selectedCategory/,
    'the null-state must restore all sections');
});

test('the filter script is idempotent on re-navigation', () => {
  /*
    With Astro view transitions, the script may fire multiple times. The
    data-bound guard prevents duplicate listeners.
  */
  assert.match(src, /data-bound/,
    'the script must guard against duplicate binding');
  assert.match(src, /astro:page-load/,
    'the script must re-run on Astro view transitions');
});

test('brand cards have accessible labels', () => {
  assert.match(src, /aria-label=\{`Enter the \$\{brand\.title\} hub`\}/,
    'each card must have a descriptive aria-label');
});

test('no framework bloat on this page', () => {
  /*
    The directive requires native Astro frontmatter grouping and lightweight
    vanilla JS — no React, Vue, or heavy state managers.
  */
  assert.doesNotMatch(src, /import.*React/, 'no React on this page');
  assert.doesNotMatch(src, /import.*Vue/, 'no Vue on this page');
  assert.doesNotMatch(src, /import.*useState/, 'no React hooks on this page');
  assert.doesNotMatch(src, /import.*createSignal/, 'no Solid signals on this page');
});

test('the fallback card uses the brand colour, not the site logo', () => {
  /*
    A hub with no hero image must NOT borrow this site's own fallback mark.
    The fallback should use the hub's brand colour instead.
  */
  assert.match(src, /brand-card-fallback/,
    'there must be a fallback state for cards without hero images');
  const style = styleBlock();
  assert.match(style, /--brand-rgb/,
    "the fallback is tinted by the hub's colour");
  assert.doesNotMatch(style, /brand-fallback-mark/,
    'no mark of ours on the fallback');
});

test('hover states use transform, not layout-triggering properties', () => {
  /*
    Hover effects must use transform and opacity — never width, height,
    margin, or top — to avoid layout thrashing.
  */
  const style = styleBlock();
  assert.match(style, /\.brand-card:hover .brand-card-image[^}]*transform: scale/,
    'hover zoom must use transform: scale');
  assert.doesNotMatch(style, /\.brand-card:hover[^}]*(width:|height:|margin:)/,
    'hover must not animate layout properties');
});

test('cards are keyboard accessible with a visible focus ring', () => {
  const style = styleBlock();
  assert.match(style, /\.brand-card:focus-visible/,
    'cards must have a :focus-visible style');
  assert.match(style, /\.brand-card-hover-border/,
    'the hover border element provides the focus ring');
});

test('a hidden hub leaves the live site but stays visible in dev', () => {
  /*
    An unfinished hub should not be on the live site, but it must stay in front
    of the person finishing it — otherwise the only way to work on one is to
    keep toggling it back on.
  */
  const lib = readFileSync(join(here, '..', 'src', 'lib', 'local-content.ts'), 'utf8');
  const fn = lib.slice(lib.indexOf('export function getFeaturedBrandsLocal'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /import\.meta\.env\.DEV/, 'dev must show every hub regardless of the flag');
  assert.match(body, /d\.hidden !== true/, 'a production build must drop hidden hubs');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION 2: /featured/[slug].astro — Hub Detail Page invariants
//  These tests are UNCHANGED from the original test file.
// ═══════════════════════════════════════════════════════════════════════════

test('the hub trailer hands over to the first rail tile when it stops', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8');

  assert.match(hub, /stage\.dataset\.stageArmed = '1'/,
    'the stage must record that a trailer is genuinely coming, so the rail can tell ' +
      'waiting-for-handover from nothing-will-ever-happen');
  assert.match(hub, /dispatchEvent\(new CustomEvent\('hub:stage-idle'\)\)/,
    'teardown must announce the stage is empty — that is the single signal covering ' +
      'ended, timed out, and never started');
  assert.match(hub, /addEventListener\('hub:stage-idle', handOver\)/,
    'the rail must hand over on every idle. `{ once: true }` was wrong once replay ' +
      'existed — the second trailer would end and hand over to nothing. It is safe ' +
      'to re-run because handOver returns early when a tile is already active, and ' +
      'show() unloads the frame directly rather than through teardown().');
  assert.match(hub, /state === 0 && stage!?\.classList\.contains\('is-playing'\)/,
    'playerState 0 is ENDED, but the player also reports states before it starts — ' +
      'without the is-playing guard a pre-roll report tears the trailer down early');
  assert.match(hub, /if \(cards\.some\(\(c\) => c\.classList\.contains\('active'\)\)\) return;/,
    'a visitor who has already picked a tile must never have the stage yanked away');

  assert.doesNotMatch(hub, /hub-rail-card \$\{i === 0 \? 'active'/,
    'the rail must not hardcode tile 0 active — that is the bug this replaced');
});

test('the hub trailer can be played again without a reload', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8');

  assert.match(hub, /const arm = \(delay: number[^)]*\) =>/,
    'arming must be a callable function — inline, the trailer can only ever play once');
  assert.match(hub, /arm\(HUB_LEAD_IN_MS\)/, 'the first play waits, so the mark is seen before it dissolves');
  assert.match(hub, /arm\(0[,)]/, 'a replay the visitor asked for starts immediately');

  assert.match(hub, /class="hub-stage-replay"/, 'there must be a control');

  const stageOpen = hub.indexOf('class="hero-trailer hub-stage animate-on-scroll"');
  assert.ok(stageOpen > 0, 'could not find the stage element; this test is no longer reading the markup');
  const stageMarkup = hub.slice(stageOpen, hub.indexOf('</section>', stageOpen));
  assert.ok(
    !stageMarkup.includes('hub-stage-replay'),
    'the replay control is inside .hub-stage again. On the stage it reads as a control for ' +
      'whatever the stage is showing, which is a rail card with its own PLAY button almost ' +
      'all of the time. It belongs in the copy column with the hub identity.',
  );

  assert.ok(
    !/class="hub-stage-replay"[^>]*aria-label/.test(hub),
    'an aria-label here replaces the name built from the visible words. Name it from content.',
  );
  assert.match(hub, /<span class="hub-stage-replay-text">Play trailer<\/span>/,
    'the visible words are what a speech-input user will say');
  assert.match(hub, /<span class="sr-only"> for \{event\.title\}<\/span>/,
    'the hub name belongs in the accessible name, after the visible text so it still contains it');

  assert.match(hub, /\.hero-grid-container:has\(\.hub-stage\.is-playing\) \.hub-stage-replay \{\s*display: none/,
    'replay must vanish while the trailer plays; the old .hub-stage.is-playing selector ' +
      'cannot match a button that is no longer inside the stage');

  assert.match(hub, /\{trailerId && \(/,
    'the replay control must be gated on trailerId');
  assert.ok(
    !/\{hasPlayableVideo && \(\s*\/\*[\s\S]{0,400}?WATCH IT AGAIN/.test(hub),
    'the replay control is gated on hasPlayableVideo again, which renders a dead button ' +
      'on a hub whose only videos are in the rail',
  );

  assert.match(hub, /dispatchEvent\(new CustomEvent\('hub:stage-replay'\)\)/,
    'the stage must ASK the rail to stand down rather than setting card state itself');
  assert.match(hub, /addEventListener\('hub:stage-replay'/, 'and the rail must answer');
});

test('the calendar dialog does not land on its own close button', () => {
  const modal = readFileSync(join(here, '..', 'src', 'components', 'SpanningCalendarModal.astro'), 'utf8');
  assert.match(modal, /class="modal-inner" tabindex="-1" autofocus/,
    'the dialog needs a non-button landing spot, or showModal() paints a focus ring on the X');
  assert.match(modal, /\.modal-inner:focus-visible \{\s*outline: none/,
    'the landing spot must not paint a ring of its own');
  assert.match(modal, /\.close-btn:focus-visible \{/,
    'the X must STILL show a ring when a keyboard user Tabs to it — that is not the bug');
});

test('the hub hero rail never cuts a card at any edge', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

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
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const hero = hub.slice(hub.indexOf('hub-stage-item-copy'), hub.indexOf('</section>'));
  assert.doesNotMatch(hero, /data-action="open-video"/,
    'the hero must not hand its video to the full-screen modal');
  assert.match(hub, /data-hub-play=/, 'the hero plays in its own stage');
  assert.match(hub, /stage\.classList\.add\('is-playing'\)/, 'pressing play must reveal the stage frame');

  assert.match(hub, /hasPlayableVideo/, 'the frame is gated on any playable video, not just the trailer');

  assert.doesNotMatch(hub, /hub-stage-guard/, 'no bar may cover the picture');
});

test('the hub hero is the deck page\'s stage, and keeps its own height', () => {
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
  assert.doesNotMatch(hub, /\.src\s*=\s*['""]{2}/, "HARD RULE 4: never assign src = ''");
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

  assert.match(hub, /hub-rail-card/, 'the hero features recent coverage');
  assert.match(hub, /<button\s+type="button"\s+class="hub-rail-card"/,
    'rail items must be real buttons — the deck shipped as divs once and was unreachable');
  assert.match(hub, /data-action="open-video"/, 'video panes reuse the site\'s modal handler');
  assert.match(hub, /pickHeroItems/, 'what the hero features must live in ONE function');

  // Articles are first-class here, not an afterthought.
  assert.match(hub, /contentType === 'video' \? 'Watch' : 'Read'/, 'articles feature too');

  // Choosing an item must UNLOAD the trailer, not merely hide it.
  const railjs = hub.slice(hub.indexOf('function initHubRail'));
  assert.match(railjs, /frame\.src = 'about:blank'/,
    'a hidden iframe still holds its document, its script and its connections');

  // Identity appears exactly once: the mark carries it, or the copy does.
  assert.match(hub, /event\.logo \?[\s\S]{0,120}sr-only/,
    'with a logo the h1 is sr-only — the mark on the stage is the visible name');
});

test('pressing Play once is enough', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // The URL the Play button writes, isolated from the resting trailer's.
  const at = hub.indexOf('data-hub-play');
  assert.ok(at > -1, 'the Play button must carry data-hub-play');
  const from = hub.indexOf('[data-hub-play]', at);
  const handler = hub.slice(from, from + 900);
  const at2 = hub.indexOf('const embedUrl =');
  assert.ok(at2 > -1, 'the press must build its embed URL in one place');
  const url = hub.slice(at2, at2 + 600);

  assert.match(url, /autoplay=1/, 'one press must start it');
  assert.match(url, /enablejsapi=1/, 'without the API nothing can be asked of the player');
  assert.match(url, /origin=\$\{encodeURIComponent/, 'the player will not answer without an origin');
  assert.match(url, /playsinline=1/, 'iOS goes full screen without it');
  assert.doesNotMatch(url, /controls=0/, "a chosen video keeps the player's own controls");

  assert.match(handler, /const withSound = .*!soundBlocked\(\)/, 'the press must try for sound');
  assert.match(handler, /embedUrl\(id, !withSound\)/, 'and open the video accordingly');
  assert.match(hub, /mute=\$\{muted \? '1' : '0'\}/, 'mute is decided per load, not hardcoded');

  assert.match(handler, /await didStart\(frame, HUB_SOUND_GRACE_MS\)/, 'the press must verify it started');
  assert.match(handler, /rememberSoundBlocked\(\)[\s\S]{0,140}embedUrl\(id, true\)/,
    'a refusal must fall back to muted, or the press is wasted');
  assert.match(handler, /token !== playToken/,
    'the fallback runs after an await and must not stomp a video chosen since');

  assert.doesNotMatch(handler, /unMute/, 'never unmute a frame that is already playing');

  // It plays HERE. The modal was the previous bug and must not come back.
  assert.doesNotMatch(handler, /data-action="open-video"/, 'this panel is the player, not a modal trigger');

  assert.match(hub, /\.hub-stage\.is-playing \.hub-stage-item \{[^}]*opacity: 0/,
    'a playing video must not be covered by the pane that launched it');
  assert.match(hub, /\.hub-stage\.is-playing \.hub-stage-item \{[^}]*visibility: hidden/,
    'opacity alone still leaves it hit-testable on top of the player');
});

test('a phone held sideways gets the two-column hero', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const split = '@media (min-width: 900px), (orientation: landscape) and (min-width: 820px) {';
  assert.ok(hub.includes(split), 'the split must key off orientation, not width alone');

  const stacked = '@media (max-width: 899px) and (orientation: portrait), (max-width: 819px) {';
  assert.ok(hub.includes(stacked), 'the stacked backdrop must invert the split exactly');
  assert.ok(!hub.includes('@media (max-width: 1023px) {'),
    'the old flat breakpoint overlapped the split');

  assert.match(hub, /@media \(orientation: landscape\) and \(max-height: 450px\) \{[\s\S]{0,220}padding-top: 5\.25rem/,
    'a short landscape viewport cannot afford the full clearance');
});

test('the visitor can turn the sound on', () => {
  const hub = readFileSync(join(here, '..', 'src', 'pages', 'featured', '[slug].astro'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(hub, /class="hub-stage-sound"/, 'the stage needs a sound control');
  assert.match(hub, /<button type="button" class="hub-stage-sound"/, 'it must be a real button');
  assert.match(hub, /\.hub-stage\.is-playing(?:[^{]+)? \.hub-stage-sound \{[^}]*display: inline-flex/,
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

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
