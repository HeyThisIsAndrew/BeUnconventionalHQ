/*
  The "Official <X> Hub" card, and the rail it lives in.

  Offline: the label logic is exercised directly, the templates are read as
  source. No browser, no build step.

  ─── THE TWO THINGS THIS PINS ──────────────────────────────────────────────

  1. THE HEADING WAS A LIE FOR MOST HUBS. It was hardcoded as "Official
     Franchise Hub" in the event template, which called Netflix a franchise
     on every event it backed. It now comes from the hub's own hubCategory.

  2. A PHONE READER SAW NONE OF THE RAIL. article.css hid `.article-rail`
     outright below 1200px, so the hub card, the editorial desk and Support
     The HQ existed on desktop only. The event templates had already solved
     this for themselves, which is why an event page stacked its rail on a
     phone and an article page silently dropped it.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { HUB_KIND_LABELS, HUB_CATEGORY_LABELS, getHubKindHeading } from '../src/lib/hub-labels.ts';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
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

console.log('\nthe hub card heading');

test('a hub is called what it actually is', () => {
  assert.equal(getHubKindHeading({ hubCategory: 'universes' }), 'Official Franchise Hub');
  assert.equal(getHubKindHeading({ hubCategory: 'streaming' }), 'Official Streamer Hub');
  assert.equal(getHubKindHeading({ hubCategory: 'studios' }), 'Official Studio Hub');
  assert.equal(getHubKindHeading({ hubCategory: 'gaming' }), 'Official Gaming Hub');
});

test('an unknown or missing category says so rather than guessing', () => {
  /*
    A hub whose category was never set is a data gap. Falling back to
    "Franchise" would hide the gap behind something that reads fine, which is
    exactly how the hardcoded heading survived as long as it did.
  */
  assert.equal(getHubKindHeading({}), 'Official Hub');
  assert.equal(getHubKindHeading(null), 'Official Hub');
  assert.equal(getHubKindHeading({ hubCategory: 'nonsense' }), 'Official Hub');
});

test('every row on /featured has a singular name for one of its hubs', () => {
  /*
    The two maps have to move together. Add a category to HUB_CATEGORY_LABELS
    without adding it here and every hub in that row reads "Official Hub" --
    correct, but blank, and nobody would notice which row it was.
  */
  for (const key of Object.keys(HUB_CATEGORY_LABELS)) {
    assert.ok(HUB_KIND_LABELS[key],
      `hubCategory "${key}" is a row on /featured with no singular label, so its hubs will ` +
        'fall back to a bare "Official Hub"');
  }
});

test('"Games" is not singularised to "Game"', () => {
  /*
    The reason these are written out rather than derived by chopping an "s".
    It is right three times out of four, and the fourth is PlayStation
    getting an "Official Game Hub".
  */
  assert.equal(HUB_CATEGORY_LABELS.gaming, 'Games');
  assert.equal(HUB_KIND_LABELS.gaming, 'Gaming');
});

test('no template hardcodes the heading any more', () => {
  const templates = [
    ['EventAnnouncement.astro', join('src', 'components', 'EventAnnouncement.astro')],
    ['EventFeatured.astro', join('src', 'components', 'EventFeatured.astro')],
    ['ArticleSupportRail.astro', join('src', 'components', 'ArticleSupportRail.astro')],
  ];
  for (const [label, rel] of templates) {
    const code = stripComments(readSrc(rel));
    assert.ok(
      !/Official Franchise Hub/.test(code),
      `${label} writes the heading out. It is a property of the HUB, not of the page: ` +
        'hardcoded, it calls Netflix a franchise.',
    );
  }

  const card = readSrc('src', 'components', 'HubCard.astro');
  assert.match(card, /getHubKindHeading\(brand\)/,
    'HubCard must take its heading from the hub document');
});

console.log('\nthe rail on a phone');

test('the card and the rail are one component, used by both page types', () => {
  /*
    EventFeatured is on this list even though no event uses
    `layoutMode: 'featured'` today. That is exactly why it was missing the
    card: the gap was invisible, and would have surfaced as a card that
    simply was not there on the first event switched to that layout.
  */
  for (const rel of [
    join('src', 'components', 'EventAnnouncement.astro'),
    join('src', 'components', 'EventFeatured.astro'),
    join('src', 'components', 'ArticleSupportRail.astro'),
  ]) {
    const code = stripComments(readSrc(rel));
    assert.match(code, /<HubCard brand=\{/, `${rel} must render the shared card, not its own copy`);
    assert.ok(
      !/class="rail-hub-card"/.test(code),
      `${rel} has its own copy of the card markup again. Two copies is how the heading ` +
        'stayed wrong in one of them.',
    );
  }
});

test('an article resolves its own hub, because nothing tells it which', () => {
  const page = stripComments(readSrc('src', 'pages', 'intel', '[slug].astro'));
  assert.match(page, /findHubForItem\(article, getFeaturedBrandsLocal\(\)\)/,
    'the article page must infer its hub: unlike an event, it has no relatedBrandSlug');
  assert.match(page, /<ArticleSupportRail related=\{[^}]*\} brand=\{articleHub\} \/>/,
    'and must hand it to the rail');
});

test('below 1200px the support rail stacks instead of vanishing', () => {
  const css = readSrc('src', 'styles', 'modules', 'article.css');
  const block = css.slice(css.indexOf('@media (max-width: 1200px)'));

  assert.ok(
    !/\.article-rail \{\s*display: none/.test(css),
    'article.css hides BOTH rails again. That takes the hub card, the editorial desk and ' +
      'Support The HQ off every phone and tablet.',
  );
  assert.match(block, /\.article-rail-left \{\s*display: none/,
    'the TOC stays desktop-only: a jump-link list belongs beside the text or nowhere');
  assert.match(block, /grid-template-areas:\s*\n?\s*"column"\s*\n?\s*"support"/,
    'the rail must stack AFTER the article, not before it');
  assert.match(block, /\.article-rail-right \.article-rail-more \{\s*display: none/,
    '"More From Intel" must stay hidden when stacked, or it prints the same related ' +
      'articles the column already shows directly under them');
  assert.match(block, /position: static/,
    'a sticky element in a single-column flow pins itself to the viewport as you scroll past');
});

test('the stacked gap is paid for once, not twice', () => {
  /*
    The layout gap is a horizontal GUTTER side by side and becomes vertical
    space when stacked. With the rail's margin and the card's own margin on
    top of it that came to 144px at 390px, about a sixth of the screen.
  */
  const css = readSrc('src', 'styles', 'modules', 'article.css');
  const block = css.slice(css.indexOf('@media (max-width: 1200px)'));
  assert.match(block, /row-gap: 3\.5rem/, 'the row gap carries the separation');
  assert.match(block, /\.article-rail-right \.article-rail-more \+ \*,?\s*\{?[\s\S]{0,80}margin-top: 0/,
    'and the first VISIBLE block gives up its own margin. `display: none` does not stop ' +
      ':first-child matching, so the hidden "More From Intel" must be reached as a sibling.');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
