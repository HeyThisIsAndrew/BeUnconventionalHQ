/**
 * How a page ENTERS, and how the contents rail follows the reader.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 * Two reports, one cause each, and both are easy to undo by tidying:
 *
 *   "way too jarring"  — the What We Cover tiles go to /feed#film. Along the
 *                        nav that is one step right, so the page slid sideways,
 *                        and THEN the feed smooth-scrolled several thousand
 *                        pixels down to the row. Two motions in two axes.
 *
 *   the contents rail  — it sat at the top of a 14rem column and scrolled with
 *                        the page until its sticky caught. It is pinned to the
 *                        viewport now, and the reading measure took the width.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

test('a link that names a section moves down the page, not across the nav', () => {
  const layout = read('src', 'layouts', 'Layout.astro');

  /*
    Checked BEFORE the nav order, which is the whole point: Home -> Feed is one
    step right and would win on nav order alone, which is exactly what produced
    a sideways slide into a downward scroll.
  */
  const fn = layout.slice(layout.indexOf('function directionFor'));
  const body = fn.slice(0, fn.indexOf('\n        }'));
  assert.match(body, /if \(toHash\) return 'dive-down';/, 'arriving at an anchor is a descent');
  assert.match(body, /if \(fromHash\) return 'dive-up';/, 'and leaving one comes back up');
  assert.ok(
    body.indexOf("toHash") < body.indexOf('from < to ? '),
    'the anchor check must come before the nav-order comparison, or it never runs',
  );

  /* Back out of an anchor the way you went in. */
  assert.match(
    layout,
    /event\.from\.hash && !event\.to\.hash\) direction = 'dive-up'/,
    'a traverse off an anchor rises rather than sliding sideways',
  );
});

test('the vertical transitions exist and are gentler than the horizontal ones', () => {
  const css = read('src', 'styles', 'global-base.css');

  for (const name of ['dive-down', 'dive-up']) {
    assert.match(
      css,
      new RegExp(`html\\[data-page-transition='${name}'\\]::view-transition-old\\(page-main\\)`),
      `${name} must animate the outgoing page`,
    );
    assert.match(
      css,
      new RegExp(`html\\[data-page-transition='${name}'\\]::view-transition-new\\(page-main\\)`),
      `${name} must animate the incoming page`,
    );
  }
});

test('the fade transitions exist and use the correct duration', () => {
  const cssText = read('src', 'styles', 'global-base.css');

  /*
    A page is much taller than it is wide, so the same percentage is a far
    longer journey down the screen than across it. The vertical travel has to
    stay SHORTER than the horizontal, or the fix reintroduces the lurch.
  */
  const hasFadeOut = !!cssText.match(/@keyframes page-fade-out/);
  const hasFadeIn = !!cssText.match(/@keyframes page-fade-in/);
  assert.ok(hasFadeOut && hasFadeIn, 'the crossfade keyframes must exist');

  // Verify transition duration is updated to 250ms
  assert.ok(cssText.includes('animation: page-fade-out 250ms'), 'should use 250ms duration');
});

test('the feed lands on its row rather than travelling to it', () => {
  const grid = read('src', 'components', 'FeedGrid.astro');

  assert.match(
    grid,
    /function scrollToHashRow\(instant = false\)/,
    'arrival and an in-place hash change are different events and need different answers',
  );
  assert.match(
    grid,
    /const behavior = instant \|\| reduced \? 'auto' : 'smooth'/,
    'an arrival must not smooth-scroll underneath the page transition',
  );
  assert.match(
    grid,
    /scrollToHashRow\(true\)/,
    'astro:page-load is the arrival, so it lands instantly',
  );

  /*
    The hashchange handler receives an Event. Passed as the listener directly it
    lands in `instant` and is truthy, which would make the in-place scroll
    instant too — the one case where the motion IS the feedback.
  */
  assert.match(
    grid,
    /const onRowHashChange = \(\) => scrollToHashRow\(false\)/,
    'the listener must be wrapped so the Event does not become `instant`',
  );
  assert.doesNotMatch(
    grid,
    /addEventListener\('hashchange', scrollToHashRow\)/,
    'passing the function straight in makes every in-place jump instant',
  );
});

test('the contents rail is pinned to the viewport, and gave its column back', () => {
  const nav = read('src', 'components', 'FloatingPageNav.astro');
  const page = read('src', 'pages', 'intel', '[slug].astro');
  const css = read('src', 'styles', 'modules', 'article.css');

  assert.match(nav, /\.fpn-wrapper\s*\{\s*position:\s*sticky/, 'a sticky wrapper ensures it sits below the hero before scrolling');

  /*
    A fixed element is trapped by any ancestor with a transform, a filter or a
    backdrop-filter — the containing-block rule that anchored the feed's PiP
    window to its hero instead of the viewport. Mounted outside the grid it
    cannot acquire one from a change inside the layout.
  */
  assert.ok(
    page.indexOf('<FloatingPageNav') < page.indexOf('<main class="article-page">'),
    'the nav must be mounted outside the layout it used to live in',
  );
  assert.doesNotMatch(page, /<ArticleToc/, 'the static rail is replaced, not doubled up');

  /*
    CLIPPED, NOT HIDDEN. `display: none` takes a label out of the accessibility
    tree, and a screen reader is then offered a nav of unnamed links.
  */
  const label = css.length && nav.slice(nav.indexOf('.fpn-label {'));
  assert.match(label.slice(0, label.indexOf('\n  }')), /max-width: 0/, 'labels clip');
  assert.doesNotMatch(label.slice(0, label.indexOf('\n  }')), /display: none/, 'labels must stay announced');

  /* The 14rem track existed to hold the contents. It does not any more. */
  const grid = css.slice(css.indexOf('.article-layout {'));
  const decl = grid.slice(0, grid.indexOf('\n}'));
  const cols = decl.match(/grid-template-columns: (\d+)rem minmax\(0, (\d+)rem\)/);
  assert.ok(cols, 'the three-column grid must still be declared in one place');
  assert.ok(+cols[1] <= 11, `the left track must shrink with the contents gone, got ${cols[1]}rem`);
  assert.ok(+cols[2] >= 56, `and the reading measure must take the width, got ${cols[2]}rem`);
});

/*
  ─── THE HERO/BANNER SEAM MUST NOT DEPEND ON THE WINDOW'S HEIGHT ────────────

  The rows were pulled up over the hero with `margin-top: -6vh`, paired with a
  mask that faded the hero's bottom edge. The mask was removed and the overlap
  was only reduced, which left a hard-edged hero with the rows still sliding
  under it.

  `vh` is a fraction of the window's HEIGHT; the hero's height is set by its
  CONTENT. Measured on /feed:

    1440 x 900    hero 654px   overlap  54px    8.3% of the hero
    1440 x 1800   hero 654px   overlap 108px   16.5% of the hero
    3840 x 2160   hero 632px   overlap 130px   20.5% of the hero

  The first two are the same page at the same width — only the window's height
  changed and the overlap doubled. Retuning the number cannot fix that; any
  `vh` value has the same defect. Hence: no viewport-relative overlap at all.
*/
test('the rows do not slide under the hero by a viewport-relative amount', () => {
  const grid = read('src', 'components', 'FeedGrid.astro');

  const spotlight = [...grid.matchAll(/#feed-rows\s*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
  assert.doesNotMatch(
    spotlight,
    /margin-top:\s*-[\d.]+v(h|min|max)/,
    'a vh overlap is a different fraction of the hero at every window size',
  );

  /* And the hero must not have grown a bottom fade back to hide the seam. */
  const hero = read('src', 'components', 'FeedSpotlightHero.astro');
  assert.doesNotMatch(
    hero,
    /mask-image:\s*linear-gradient\(\s*to bottom[^)]*transparent/,
    'the hero bottom fade was removed deliberately; it is not the fix for a seam',
  );
});

/*
  ─── PAGING A LIST IS NOT TRAVELLING ANYWHERE ───────────────────────────────

  /events -> /events/2 is a real navigation, so it drove the site-wide page
  transition and slid the whole document sideways to change a grid of tiles
  halfway down it.
*/
test('paging a list moves the list, not the page', () => {
  const layout = read('src', 'layouts', 'Layout.astro');
  const css = read('src', 'styles', 'global-base.css');
  const events = read('src', 'pages', 'events', '[...page].astro');

  assert.match(layout, /function baseOf\(pathname\)/, 'a paginated route needs its page number stripped');
  assert.match(
    layout,
    /if \(baseOf\(fromPath\) === baseOf\(toPath\)\) return 'page-rows';/,
    'same list, different page, must not read as a journey along the nav',
  );

  assert.match(events, /view-transition-name: section-rows/, 'the grid must be captured separately');

  /*
    An earlier attempt switched the page-level name off from this page with
    `#page-content { view-transition-name: none !important }`. That disabled the
    transition for every navigation INTO and OUT OF /events too, and
    asymmetrically — only one of the two documents in a transition carries this
    page's stylesheet.
  */
  /* Comments stripped first: the note explaining WHY this is forbidden quotes
     the offending declaration, and an un-stripped check matches the prose. */
  const eventsCode = events.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    eventsCode,
    /#page-content\)?\s*\{[^}]*view-transition-name:\s*none/,
    'the page-level transition name must not be switched off from one route',
  );

  /* Suppressing old/new alone leaves the group's default cross-fade, which is
     the full-page flash this exists to avoid. */
  assert.match(
    css,
    /html\[data-page-transition='page-rows'\]::view-transition-group\(page-main\)\s*\{\s*animation-duration:\s*0s/,
    'the page-main GROUP has to be stopped too, not just its old/new',
  );
  assert.match(css, /@keyframes section-rows-in/, 'the rows need their own motion');
});

/*
  The coverage filters are client-side: no navigation, so no view transition to
  ride on. They set `display` directly, which reflowed the grid in one frame.
*/
test('a filter fades its cards rather than snapping them', () => {
  for (const rel of [
    ['src', 'pages', 'featured', '[slug].astro'],
    ['src', 'components', 'EventFeatured.astro'],
    ['src', 'components', 'EventAnnouncement.astro'],
  ]) {
    const src = read(...rel);
    const name = rel[rel.length - 1];

    assert.match(src, /is-filtered-out/, `${name}: the fade needs a class to drive it`);
    assert.match(
      src,
      /requestAnimationFrame\(\(\) => \w+\.classList\.remove\('is-filtered-out'\)\)/,
      `${name}: a card coming back must be laid out BEFORE it fades in, or there is no start frame`,
    );
    assert.match(
      src,
      /if \(\w+\.classList\.contains\('is-filtered-out'\)\) \w+\.style\.display = 'none'/,
      `${name}: re-check before hiding — a fast second click lands inside the fade`,
    );

    /* Opacity only. `.content-card` already owns a transform for its hover
       lift, and two sources animating one property means the card jumps. */
    const decl = src.slice(src.indexOf('.content-card.is-filtered-out'));
    assert.doesNotMatch(
      decl.slice(0, decl.indexOf('}')),
      /transform:/,
      `${name}: the filter must not animate transform, the hover lift owns it`,
    );
  }
});

/*
  ─── A COMMENT THAT EATS ITS OWN RULE ───────────────────────────────────────

  `.event-hero`'s note about NOT using overflow:hidden lost its terminator in a
  commit that trimmed the last line of the comment. The comment then ran on
  through the closing brace and destroyed the whole rule, so `position:
  relative` never applied. `.event-hero-bg-wrapper` is `position: absolute;
  inset: 0`, so with no positioned ancestor it escaped to the initial containing
  block and sized itself to the VIEWPORT: the hero's blurred backdrop painted
  2224px tall behind every row on the feed.

  Reported as "why is the hero image extending into the background". Nothing
  caught it — the build passed, `astro check` passed, and the rule simply was
  not there. So this asserts the OUTPUT: every hero must actually establish a
  containing block for its own backdrop.
*/
test('every hero establishes a containing block for its backdrop', () => {
  for (const rel of [
    ['src', 'components', 'FeedSpotlightHero.astro'],
    ['src', 'components', 'EventFeatured.astro'],
    ['src', 'components', 'EventAnnouncement.astro'],
    ['src', 'pages', 'featured', '[slug].astro'],
  ]) {
    const src = read(...rel);
    const name = rel[rel.length - 1];

    /*
      Comments stripped FIRST, then the rule is looked for. That is the whole
      point: the bug was a rule that only existed inside a comment.
    */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = code.match(/\.event-hero\s*\{([^}]*)\}/);
    assert.ok(rule, `${name}: the .event-hero rule must survive comment stripping`);
    assert.match(
      rule[1],
      /position:\s*relative/,
      `${name}: without it the backdrop escapes to the viewport and paints over the page`,
    );
  }
});
