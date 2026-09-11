/*
  The event hero's lockup — the three mark slots, the metadata row's
  placement, and where "Event Details" actually goes.

  Offline. The two hero components are read as source, in the style of the
  other structural guards in this directory.

  ─── WHAT THIS FILE EXISTS TO STOP ─────────────────────────────────────────

  Three separate reports, all of them about the same corner of the page:

  1. "it just looks like I've got multiple of the same events". The hero
     renders a mark in THREE slots and all three read from `logo`, so PAX
     West, East, Aus and Unplugged — which share one PAX wordmark — were
     four visually identical heroes. `heroLogo` overrides the left slot.

  2. "metadata tag placement must never change". It changed twice over: with
     the logo's height, and with whether the event had a CTA at all.

  3. "Event Details link is going to the wrong link". It pointed at
     `signUpLink`, which is a ticket checkout, not the event's details.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');

/* The comments below describe the very bugs the negative assertions hunt. */
const stripComments = (text) =>
  text
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

/*
  Both event layouts, because they are near-copies of each other and the whole
  reason they keep drifting is that a fix lands in one of them.
*/
const HERO_COMPONENTS = ['EventAnnouncement.astro', 'EventFeatured.astro'];
const heroSource = (rel) => stripComments(readSrc('src', 'components', rel));

console.log('\nthe event hero lockup');

test('the left mark can be overridden without touching the stage', () => {
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.match(code, /const heroLockupLogo = event\.heroLogo \|\| event\.logo;/,
      `${rel} must resolve the left mark from heroLogo first. Without the override the four ` +
        'PAX events render the same shared wordmark and read as one event four times.');

    assert.match(code, /class="hero-logo-wrap"[\s\S]{0,240}urlFor\(heroLockupLogo\)/,
      `${rel}: the small top-left mark must render the RESOLVED lockup logo, not event.logo`);

    /*
      And the hero lockup's override reaches NOTHING else. `heroLogo` naming
      the stage would put the same asset back in two slots, which is the bug
      the field exists to undo.
    */
    const heroLogoUses = code.match(/event\.heroLogo/g) || [];
    assert.equal(heroLogoUses.length, 1,
      `${rel}: heroLogo must be read exactly once, by heroLockupLogo. It is the override for ` +
        'the top-left slot alone.');
  }
});

test('the stage has its own mark, and its own switch', () => {
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.match(code, /const stageMarkLogo = event\.stageLogo \|\| event\.logo;/,
      `${rel}: the stage's mark is stageLogo, falling back to logo — never the hero lockup's`);
    assert.match(code, /const stageShowsMark = event\.stageShowMark === true;/,
      `${rel}: the stage mark must be OFF unless a document turns it on. A default-on toggle ` +
        'reintroduces the repetition for every event that never touches the field.');
    assert.match(code, /const stageMarkUrl = stageShowsMark && stageMarkLogo/,
      `${rel}: the mark renders only when the switch is on`);
  }
});

test('the idle stage is key art, not a second copy of the logo', () => {
  /*
    ─── WHY THE DEFAULT CHANGED ────────────────────────────────────────────

    The hero states the event's identity at the top left, the tagline falls
    back to the event's own name directly under it, and the stage put the
    same mark on screen a third time at 520px. Reported against the Doomsday
    premiere: "there is repeating everywhere. It's too repetitive."
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.match(code, /const stageArtUrl = !stageMarkUrl && event\.heroImage/,
      `${rel}: with no mark asked for, the stage fills with the event's key art`);

    /*
      ONE LAYER, NOT TWO. Every state the stage has is written against
      `.hub-stage-mark` — is-playing fades it to 0.28, is-item takes it to 0,
      reduced-motion drops its transition — so the art has to live in that
      same element or it is left behind by all three.
    */
    assert.match(code, /class:list=\{\['hub-stage-mark', \{ 'hub-stage-mark--art': !!stageArtUrl \}\]\}/,
      `${rel}: art mode must be a modifier on the existing idle layer, not a new layer`);
    assert.doesNotMatch(code, /class="hub-stage-art"/,
      `${rel}: a separate art layer would need every state rule written a second time`);

    assert.doesNotMatch(code, /\.hero-trailer\.hub-stage \{[^}]*overflow: hidden;/,
      `${rel}: HARD RULE 3 — the stage holds the iframe and must never clip`);
  }
});

test('the placeholder is the picture, not an effect on it', () => {
  /*
    ─── WHAT THIS REPLACED ─────────────────────────────────────────────────

    The first version of art mode blurred the key art and overscanned it past
    a clip, borrowing the treatment every OTHER plate on this page uses. Both
    halves of that were wrong here: it was still an effect applied to the
    event's art rather than the art, and the overscan zoomed in on it. Asked
    for plainly: "it should just be the full image that is used for the hero
    but in the location of the trailer at the trailer's size displayed until
    the trailer shows."
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    const artRule = code.match(/\.hub-stage-art-img \{[^}]*\}/);
    assert.ok(artRule, `${rel}: the stage art needs a rule of its own`);
    assert.match(artRule[0], /inset: 0;/,
      `${rel}: the art sits at the frame's edges. An overscan is the zoom that was reported.`);
    assert.match(artRule[0], /object-fit: cover;/,
      `${rel}: cover fills the 16/9 frame — contain would letterbox a trailer box`);
    assert.doesNotMatch(artRule[0], /blur\(|filter:/,
      `${rel}: the placeholder must not be blurred`);

    const wrapRule = code.match(/\.hub-stage-mark--art \{[^}]*\}/);
    assert.ok(wrapRule, `${rel}: art mode needs its wrapper rule`);
    assert.match(wrapRule[0], /filter: none;/,
      `${rel}: the base rule's drop-shadow glow is shaped for a mark, not a full-bleed frame`);
    assert.doesNotMatch(wrapRule[0], /overflow: hidden;/,
      `${rel}: nothing overflows now, so nothing needs clipping`);
  }
});

test('losing the blur means the request has to match the box', () => {
  /*
    A blurred plate is deliberately requested SMALL — 640px on /featured,
    900px on a hub page — because the blur destroys more detail than the
    upsample costs. Crisp, that reasoning inverts: 900px into a 760px frame
    on a 2x screen is 0.6x density and visibly soft, which is exactly what
    "the image is not sized properly" would look like.
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.match(code, /const STAGE_WIDTHS = \[600, 760, 1200, 1520\];/,
      `${rel}: the ladder must reach 2x of the widest stage (760 CSS px)`);
    assert.match(code, /srcset=\{stageArtSrcset\}/,
      `${rel}: the stage art needs a srcset now that nothing hides its resolution`);
    assert.match(code, /sizes=\{stageArtSizes\}/,
      `${rel}: and sizes, or the browser assumes 100vw and picks the largest every time`);
    assert.doesNotMatch(code, /stageArtSizes = '100vw'/,
      `${rel}: 100vw would have a phone fetch a viewport-wide image for a 343px box`);
  }
});

test('the ghost follows whatever is in front of it', () => {
  /*
    Crisp over a blown-up blurred copy of ITSELF is the lockup /featured uses.
    In art mode there is no mark in front, so a logo-shaped glow around the
    frame is a leftover of a lockup that is not there — and one more
    appearance of the mark, which is the thing being removed.
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);
    assert.match(code, /const stageGhostSource = stageMarkUrl \? stageMarkLogo : \(stageArtUrl \? event\.heroImage : null\);/,
      `${rel}: the ghost's source must follow the stage's`);
    assert.match(code, /'hub-stage-plate--art': !stageMarkUrl/,
      `${rel}: and key art has to cover rather than contain, so it needs the modifier`);
    assert.doesNotMatch(code, /const stageGhostUrl = event\.logo/,
      `${rel}: the ghost must not be pinned to the logo any more`);
  }
});

test('the hero states the event\'s name once', () => {
  /*
    ─── THE LAST OF THE REPETITION ─────────────────────────────────────────

    18 of the 19 seeded events carry no tagline, and the tagline fell back to
    `event.title`, so all but one page printed the event's own name in type
    directly under its own mark. D23 was the only clean one, and only because
    somebody had written it a real tagline.

    The fallback was not wrong to exist. The <h1> goes sr-only when a logo
    renders, so a stylised mark a visitor cannot parse — or one that fails to
    load — left nothing readable. That reason is now served where the problem
    is: the <h1> WRAPS the mark and the name is the image's alt, so a broken
    image paints the name in the mark's own place, and assistive technology
    reads it once instead of once per element.
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.doesNotMatch(code, /\? event\.tagline\.trim\(\)\s*\n?\s*: event\.title;/,
      `${rel}: the tagline must not fall back to the title — that is the duplicate`);
    assert.match(code, /\? event\.tagline\.trim\(\)\s*\n?\s*: null;/,
      `${rel}: null, not an empty string. An empty <p> still takes its line-height.`);
    assert.match(code, /\{taglineText && <p class="hero-tagline">\{taglineText\}<\/p>\}/,
      `${rel}: the paragraph must not render at all when there is no tagline`);

    assert.match(code, /<h1 class="hero-title-lockup">[\s\S]{0,400}?alt=\{event\.title\}/,
      `${rel}: the mark must BE the heading, and carry the name as its alt`);
    assert.doesNotMatch(code, /<h1 class="sr-only">\{event\.title\}<\/h1>/,
      `${rel}: the sr-only twin is gone; two elements naming the page is what was announced twice`);
    assert.doesNotMatch(code, /class="hero-logo-wrap" aria-hidden="true"/,
      `${rel}: the wrapper must not be hidden from assistive tech now that it holds the heading`);

    /*
      A heading element brings a browser-default 2em size and margin. The alt
      only paints when the image fails, and it has to land where the mark
      would have, not shove everything under it down the page.
    */
    assert.match(code, /\.hero-title-lockup \{[^}]*margin: 0;[^}]*\}/,
      `${rel}: the lockup heading must carry no margin of its own`);
    assert.match(code, /\.hero-title-lockup \{[^}]*font-size: inherit;[^}]*\}/,
      `${rel}: nor a heading's font size`);
  }
});

test('"Event Details" goes to the official website, not the ticket checkout', () => {
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    assert.match(code, /const heroCtaHref = event\.officialWebsite \|\| event\.signUpLink \|\| null;/,
      `${rel} must resolve the hero CTA from officialWebsite first`);

    assert.match(code, /href=\{heroCtaHref\}[\s\S]{0,200}Event Details/,
      `${rel}: the "Event Details" button must use the resolved href. It used to use ` +
        'signUpLink, which is an Axs listing for The Game Awards and a newsletter form ' +
        'for PAX East.');

    /*
      THE TWO LINKS STAY DIFFERENT THINGS. signUpLink is not dead — it is
      what the "Tickets / RSVP" button further down the page is for, and
      collapsing the two would make the hero button a checkout again by a
      different route.
    */
    assert.match(code, /href=\{event\.signUpLink\}[\s\S]{0,200}Tickets \/ RSVP/,
      `${rel}: signUpLink must still power the Tickets / RSVP button`);
  }
});

test('the metadata row does not move with the logo or the CTA', () => {
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);

    /*
      `align-self: end` on the copy column is the bug itself. It sized the
      column to its own content and pinned its BOTTOM edge, so a taller logo
      pushed the eyebrow up and `.has-cta` (which shortens the 1fr row)
      moved the edge it was pinned to.
    */
    assert.doesNotMatch(code, /\.hero-grid-container\.has-trailer \.hero-copy \{[^}]*align-self: end;/,
      `${rel}: the copy column must not be bottom-pinned — that is what moved the metadata row`);

    assert.match(code, /\.hero-grid-container\.has-trailer \.hero-copy \{[^}]*align-self: stretch;/,
      `${rel}: the copy column must stretch so the eyebrow sits at the top of the grid, a ` +
        'position nothing inside the column can change');

    assert.match(code, /\.hero-grid-container\.has-trailer \.hero-copy > \.hero-identity \{[^}]*margin-top: auto;/,
      `${rel}: the lockup must take the auto margin, so it stays bottom-anchored while the ` +
        'eyebrow stays put');
  }
});

test('the CTA row is keyed on the link the button will actually use', () => {
  /*
    `.has-cta` adds a grid row. Keying it on signUpLink while the button
    rendered on officialWebsite would reserve the row for the wrong set of
    events: the four with no signUpLink would draw a button into a row the
    grid never made.
  */
  for (const rel of HERO_COMPONENTS) {
    const code = heroSource(rel);
    assert.match(code, /'has-cta': !!heroCtaHref/,
      `${rel}: has-cta must follow heroCtaHref`);
    assert.doesNotMatch(code, /'has-cta': !!event\.signUpLink/,
      `${rel}: has-cta must not be keyed on signUpLink any more`);
  }
});

test('every shipped event can actually render that button', () => {
  /*
    The placement fix above no longer DEPENDS on this — the eyebrow is pinned
    to the grid, not to the CTA row — but an event with no destination still
    ships a hero with nothing to click, so it is worth knowing.
  */
  const docs = JSON.parse(readSrc('src', 'data', 'videos.json'));
  const events = docs.filter((d) => d._type === 'event');
  assert.ok(events.length > 0, 'the event store must not be empty');

  const linkless = events
    .filter((e) => !e.officialWebsite && !e.signUpLink)
    .map((e) => e.slug?.current);
  assert.deepEqual(linkless, [],
    `these events have neither an officialWebsite nor a signUpLink, so their hero CTA cannot ` +
      `render: ${linkless.join(', ')}`);
});

console.log(failed === 0 ? `\n✅ ${passed} passed, 0 failed.` : `\n❌ ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
