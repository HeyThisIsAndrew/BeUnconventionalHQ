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
      And the stage keeps the BRAND mark. The ghost plate and the big right
      mark are one asset on purpose — crisp over a blown-up blurred copy of
      itself — so pointing them at the override would break that lockup and
      leave nothing showing the brand.
    */
    assert.match(code, /const stageGhostUrl = event\.logo \? urlFor\(event\.logo\)/,
      `${rel}: the blurred stage ghost stays on event.logo`);
    assert.match(code, /const stageMarkUrl = event\.logo \? urlFor\(event\.logo\)/,
      `${rel}: the large stage mark stays on event.logo`);
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
