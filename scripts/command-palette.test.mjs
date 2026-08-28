/*
  THE SEARCH PALETTE'S NON-OBVIOUS CONTRACTS.

  Every assertion here corresponds to a bug that was real, and that neither
  Lighthouse, axe nor `astro check` reported. They are pinned as source reads
  because each of them is a rule about the RELATIONSHIP between two pieces of
  code, which no single-file linter can see:

    - a CSS override that loses to source order still parses perfectly
    - a modal that closes without running your teardown still closes
    - a `role="option"` with no `aria-selected` is still a valid attribute
    - a 38px button is still a button

  See src/components/CommandPalette.astro for the reasoning at each site.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const palette = readFileSync(join(ROOT, 'src/components/CommandPalette.astro'), 'utf8');
/*
  Several of the comments in that file QUOTE the code they replaced, so a
  plain search finds the old behaviour in the note explaining why it is gone.
  Checks for absence run against this stripped copy instead.
*/
const paletteCode = palette
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
/* There is more than one mobile media query; collect them all. */
const mobileCss = (palette.match(/@media \(max-width: 640px\) \{[\s\S]*?\n  \}\n/g) || []).join('\n');
const navbar = readFileSync(join(ROOT, 'src/components/Navbar.astro'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed += 1; }
}

console.log('\nCommand palette:');

/*
  A <dialog> opened with showModal() closes on Escape entirely by itself,
  without running a line of our code. Teardown that lives in closePalette()
  is therefore skipped on every Escape that does not go through it, which
  left `modal-open` on <html> and the page unscrollable with a reload as the
  only way out.
*/
test('scroll unlock hangs off the dialog\'s own close event, not closePalette()', () => {
  const closeListener = palette.match(/dialog\.addEventListener\('close',[\s\S]*?\n    \}\);/);
  assert.ok(closeListener, 'there must be a listener on the dialog\'s `close` event');
  assert.match(closeListener[0], /unlock\(\)|body\.style\.overflow = ''/,
    'the close listener is where the scroll unlock has to live: Escape reaches it on every ' +
    'path, and closePalette() only when focus happens to be in the input');
  const closeFn = palette.match(/const closePalette = \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(closeFn, 'closePalette must still exist');
  assert.doesNotMatch(closeFn[0], /unlock\(\)/,
    'the unlock must NOT be duplicated back into closePalette — one owner, or they drift');
});

/*
  Both selectors are a single class, so specificity ties and SOURCE ORDER
  decides. With the media query above the base rule, `max-height: 80vh` won
  and the mobile `60dvh` never applied: the panel measured 682px in an 852px
  viewport and 208px of results sat behind the keyboard. The fix was present
  in the file and doing nothing.
*/
test('the mobile max-height override is declared BELOW the base rule it overrides', () => {
  const base = palette.indexOf('max-height: 80vh');
  const mobile = palette.indexOf('max-height: 60dvh');
  assert.ok(base !== -1, 'the base .cmd-palette-content max-height must exist');
  assert.ok(mobile !== -1, 'the mobile override must exist');
  assert.ok(mobile > base,
    `the 60dvh override is at index ${mobile}, the 80vh base at ${base}. Equal specificity ` +
    'means the later rule wins, so an override above the base rule silently does nothing.');
});

/*
  `dvh` shrinks when the on-screen keyboard opens, which is the entire reason
  it is used here. `vh` does not, and this panel is only ever on screen while
  somebody is typing. This deliberately differs from the hero, which uses
  `lvh` — see scripts/viewport-units.test.mjs for why the opposite is right
  for an element sized to the scroll viewport.
*/
test('the mobile panel is sized in dvh, never vh', () => {
  assert.ok(mobileCss, 'the mobile media query must exist');
  assert.match(mobileCss, /max-height: \d+dvh/, 'the mobile panel height must be in dvh');
  assert.doesNotMatch(mobileCss, /max-height: \d+vh(?!h)/,
    'a `vh` height does not shrink for the keyboard, which is the whole point here');
});

/*
  aria-activedescendant says WHICH row is current. aria-selected is what a
  screen reader reads the selected STATE from. With only the first, the row
  is announced with no indication that Enter will open it.
*/
test('every result row carries aria-selected, and the active one flips it', () => {
  assert.match(palette, /a\.setAttribute\('aria-selected', 'false'\)/,
    'rows must be created with aria-selected="false" — a role="option" without it is incomplete');
  assert.match(palette, /item\.setAttribute\('aria-selected', 'true'\)/,
    'the active row must be set to true in updateActiveState()');
  assert.match(palette, /item\.setAttribute\('aria-selected', 'false'\)/,
    'and every other row reset to false, or several rows claim to be selected at once');
});

/*
  Closing a modal onto <body> costs a keyboard user their place: the next Tab
  restarts at the top of the document. A tap does not reliably focus a
  <button> (iOS Safari leaves activeElement on <body>), so the opener is
  passed in rather than read off activeElement.
*/
test('focus returns to whatever opened the palette', () => {
  assert.match(palette, /const openPalette = \(opener\?: HTMLElement \| null\) =>/,
    'openPalette must accept the opener explicitly — activeElement is <body> after a tap');
  assert.match(palette, /openPalette\(trigger\)/,
    'the [data-action="open-search"] handler must pass the button it matched');
  assert.match(palette, /lastFocused\.focus\(\{ preventScroll: true \}\)/,
    'and the close listener must restore it, without scrolling the page to it');
});

/*
  The index is sorted newest first. "The ten newest things" opens the palette
  on whichever ONE kind of thing was published last — which is how it came to
  open on nothing but hubs.
*/
test('the empty query shows a curated mix, not the top of a date sort', () => {
  assert.match(palette, /const DEFAULT_MIX/, 'the curated default mix must exist');
  const mix = palette.match(/const DEFAULT_MIX[\s\S]*?\];/)[0];
  for (const type of ['article', 'video', 'hub', 'event', 'page']) {
    assert.match(mix, new RegExp(`'${type}'`), `the default mix must include ${type}`);
  }
  assert.doesNotMatch(paletteCode, /searchData\.slice\(0, 10\)/,
    'the raw date-sorted slice is what put 18 hubs above every article');
});

/*
  `cover` crops whatever does not fit, which is right for a video still and
  wrong for somebody else's logo. The Warner Bros shield and the DC disc were
  both losing their top and bottom.
*/
test('hub marks are contained, video stills are covered', () => {
  assert.match(palette, /item\.type === 'hub' \? 'cmd-result-image is-mark' : 'cmd-result-image'/,
    'hub images must be tagged so the stylesheet can treat them differently');
  const markRule = palette.match(/\.cmd-result-image\.is-mark \{[\s\S]*?\}/);
  assert.ok(markRule, 'there must be a .is-mark rule');
  assert.match(markRule[0], /object-fit: contain/, 'a brand mark must never be cropped');
});

/*
  Touch targets. The hamburger beside the search button is 44x44 and sets the
  house convention; search was 38x38 sitting 4px from it, so a thumb aimed at
  search that landed slightly right opened the menu instead.
*/
test('the mobile header search button is a 44px target', () => {
  const btn = navbar.match(/<button class="nav-search-btn" data-action="open-search"[^>]*>/);
  assert.ok(btn, 'the mobile search trigger must exist');
  assert.match(btn[0], /width: 44px/, 'the target must be 44px wide, matching .nav-toggle beside it');
  assert.match(btn[0], /height: 44px/, 'and 44px tall');
});

/*
  The dismiss control was a ~30x20 chip reading "ESC": a key that does not
  exist on the device, at well under a touch target, and the only visible way
  out (the backdrop is mostly covered by the panel).
*/
test('the dismiss control is a key hint on desktop and a real close target on touch', () => {
  assert.match(palette, /class="close-btn-key"/, 'the ESC hint must be its own element');
  assert.match(palette, /class="close-btn-glyph"/, 'and the touch glyph another');
  assert.match(mobileCss, /\.close-btn \{[\s\S]*?width: 44px/, 'the close target must be 44px on mobile');
  assert.match(mobileCss, /\.close-btn-key \{\s*display: none/, 'and the ESC hint hidden there');
  assert.match(palette, /aria-label="Close search \(Esc\)"/,
    'the accessible name must stay a superset of the visible "ESC" (WCAG 2.5.3 Label in Name)');
});

/*
  Three attributes that only exist for the on-screen keyboard, plus the one
  that stops iOS zooming the whole page when the field takes focus.
*/
test('the input is set up for a phone keyboard', () => {
  const input = palette.match(/<input[\s\S]*?\/>/)[0];
  assert.match(input, /enterkeyhint="search"/, 'the return key should read Search, not Go');
  assert.match(input, /autocapitalize="off"/, 'or every query starts with a capital');
  assert.match(input, /autocorrect="off"/, 'or iOS rewrites the proper nouns this site is made of');
  const fontSize = palette.match(/#cmd-palette-input[^}]*font-size:\s*([\d.]+)rem/);
  if (fontSize) {
    assert.ok(parseFloat(fontSize[1]) * 16 >= 16,
      `the input is ${fontSize[1]}rem; under 16px Safari zooms the page on focus and does not zoom back`);
  }
});

/*
  A complete combobox or none at all. Half the pattern — options and an
  activedescendant with no combobox for them to belong to — is worse than
  plain text, because it promises a widget that is not there.
*/
test('the input declares the full combobox pattern', () => {
  const input = palette.match(/<input[\s\S]*?\/>/)[0];
  assert.match(input, /role="combobox"/, 'role');
  assert.match(input, /aria-controls="cmd-palette-results"/, 'pointing at the listbox');
  assert.match(input, /aria-expanded="false"/, 'with an initial expanded state');
  assert.match(input, /aria-autocomplete="list"/, 'and the autocomplete behaviour named');
  assert.match(palette, /role="listbox"/, 'the results container must be the listbox');
  assert.match(palette, /setAttribute\('aria-expanded', 'true'\)/,
    'aria-expanded must be kept in step in JS, or it lies from the first keystroke');
});

/*
  The panel introduced two greys DARKER than anything the site uses. CLAUDE.md
  records that the muted palette is a deliberate trade-off and that an audit of
  six routes found zero failures at rest, with `--color-white-muted` (#888888)
  as the floor for subordinate copy. `#555` placeholder text (2.66:1) and `#666`
  empty-state text (3.45:1) were both below that floor and below WCAG AA.

  Contrast is recomputed here rather than quoted, so it cannot drift from the
  tokens it describes.
*/
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('the panel reads no text darker than the site\'s own muted floor', () => {
  const base = readFileSync(join(ROOT, 'src/styles/global-base.css'), 'utf8');
  const muted = base.match(/--color-white-muted:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(muted, '--color-white-muted must be defined');
  /* The panel is rgba(10,10,10,.85) over a 70%-black backdrop: effectively #0a0a0a. */
  const PANEL = '#0a0a0a';
  assert.ok(ratio(muted[1], PANEL) >= 4.5,
    `the muted token itself must clear AA on the panel (got ${ratio(muted[1], PANEL).toFixed(2)}:1)`);

  for (const [what, sel] of [['placeholder', '#cmd-palette-input::placeholder'], ['empty state', '.cmd-palette-empty']]) {
    const rule = palette.match(new RegExp(sel.replace(/[.#*]/g, '\\$&') + '\\s*\\{[\\s\\S]*?\\}'));
    assert.ok(rule, `there must be a ${what} rule`);
    const hex = rule[0].match(/color:\s*(#[0-9a-fA-F]{3,6})/);
    if (hex) {
      const full = hex[1].length === 4
        ? '#' + hex[1].slice(1).split('').map((c) => c + c).join('')
        : hex[1];
      assert.fail(
        `${what} hardcodes ${full} at ${ratio(full, PANEL).toFixed(2)}:1 on the panel. ` +
        'Use var(--color-white-muted): it is the site\'s floor and it clears AA.');
    }
    assert.match(rule[0], /color:\s*var\(--color-white-muted\)/,
      `${what} text must use the muted token, not a darker one-off grey`);
  }
});

/*
  There are two reds and they are not interchangeable. The palette used
  `#ff4444`, which is neither of them: a near-miss of `--color-accent-text`
  that no other file would pick up if the token ever changed.
*/
test('the readable red comes from the token, not a near-miss of it', () => {
  const videoBadge = palette.match(/\.cmd-result-item\[data-action="open-video"\] \.cmd-result-badge \{[\s\S]*?\}/);
  assert.ok(videoBadge, 'the video badge rule must exist');
  assert.match(videoBadge[0], /color:\s*var\(--color-accent-text\)/,
    'read-me red is a token; #ff4444 was a hand-mixed near-miss of #ef4444');
});

/*
  The row is a flex line: [96x54 image][text column]. Section pages carry no
  image, so the image element was skipped, the text column became the first
  child, and that row's badge and title slid left into the thumbnail's lane.
  One row out of ten not lining up does not read as "this one is different",
  it reads as broken.
*/
test('a result with no image still renders the leading box, so the column line holds', () => {
  const imgBranch = paletteCode.match(/if \(item\.image\) \{[\s\S]*?a\.appendChild\(placeholder\);/);
  assert.ok(imgBranch,
    'the image branch must have an else that appends a placeholder — skipping the box ' +
    'entirely is what broke the alignment');
  assert.match(imgBranch[0], /\} else \{/, 'and it must be the else of the image branch');
  assert.match(paletteCode, /className = 'cmd-result-image is-placeholder'/,
    'the placeholder must reuse .cmd-result-image so it inherits the exact box metrics');
  assert.match(paletteCode, /placeholder\.setAttribute\('aria-hidden', 'true'\)/,
    'the glyph is decorative — the badge already says PAGE and the title says which');

  const rule = palette.match(/\.cmd-result-image\.is-placeholder \{[\s\S]*?\}/);
  assert.ok(rule, 'the placeholder must be styled');
  assert.doesNotMatch(rule[0], /width:|height:/,
    'it must NOT restate width/height — it inherits them from .cmd-result-image, ' +
    'which is what keeps the two cases identical when that size changes');
  assert.match(rule[0], /color: var\(--color-white-muted\)/,
    'the glyph sits at the muted token so it reads as a placeholder, not as content');
});

/*
  The empty-query view was volunteering D23, which finished on 16 August.
  Retrospective coverage is not something to put in front of somebody who has
  not asked for it. Past events stay indexed and stay findable by typing; this
  is only about what the panel offers unprompted.
*/
test('the default view only volunteers an event that is still ahead of us', () => {
  assert.match(paletteCode, /const eligibleForDefault =/,
    'there must be one eligibility rule for the default view');
  assert.match(paletteCode, /d\.type === 'event'\) return isStillAhead\(d\)/,
    'events must be gated on still being ahead of us');
  assert.match(paletteCode, /!out\.includes\(d\) && eligibleForDefault\(d\)/,
    'the backfill must apply the same rule, or a finished event walks back in ' +
    'through the side door when a bucket comes up short');
});

/*
  Hard rule 1. `new Date("2026-08-16")` is midnight UTC, which renders as the
  15th anywhere west of Greenwich, so an event would drop out of the panel a
  day early for most of the audience. Compare the strings.
*/
test('the still-ahead check compares date STRINGS and never builds a Date', () => {
  const fn = paletteCode.match(/const isStillAhead = \(d: any\) => \{[\s\S]*?\n    \};/);
  assert.ok(fn, 'isStillAhead must exist');
  assert.doesNotMatch(fn[0], /new Date\(/,
    'building a Date from a calendar string UTC-shifts it to the previous day');
  assert.match(fn[0], /end >= today/, 'a same-precision string comparison');
  assert.match(paletteCode, /import \{ toYMD \} from '\.\.\/lib\/events\.ts'/,
    "today must come from the site's own helper, not a reimplementation");
});

/*
  A multi-day show is not over on its opening morning. Gating on the start
  date alone would have hidden SDCC on 23 July, mid-event.
*/
test('the check uses the END of an event, not its start', () => {
  const fn = paletteCode.match(/const isStillAhead = \(d: any\) => \{[\s\S]*?\n    \};/)[0];
  assert.match(fn, /d\.endDate \|\| d\.date/,
    'end date first, falling back to the start for a single-day event');

  const index = readFileSync(join(ROOT, 'src/pages/api/search-index.json.ts'), 'utf8');
  assert.match(index, /endDate: e\.endDate \|\| e\.startDate/,
    'the index must carry an end date for every event, or the client cannot make this call');
  assert.match(index, /endDate\?: string \| null/, 'and it must be on the entry type');
});

/*
  The empty view already shows three articles. Intel is the page those
  articles live on: it is not a result, it is the container of results that
  are already on screen.
*/
test('Intel is kept out of the default view but stays searchable', () => {
  const index = readFileSync(join(ROOT, 'src/pages/api/search-index.json.ts'), 'utf8');
  const intel = index.match(/\{ id: 'intel'.*?\}/);
  assert.ok(intel, 'the Intel page entry must exist');
  assert.match(intel[0], /excludeFromDefault: true/, 'flagged out of the default view');
  assert.match(intel[0], /url: '\/intel'/,
    'and still present in the index, so typing "intel" finds it');
  assert.match(paletteCode, /if \(d\.excludeFromDefault\) return false/,
    'the client must honour the flag');

  /* The decision lives with the pages, not hardcoded in the palette. */
  assert.doesNotMatch(paletteCode, /'\/intel'/,
    'the palette must not name a specific URL — that couples it to the page list');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
