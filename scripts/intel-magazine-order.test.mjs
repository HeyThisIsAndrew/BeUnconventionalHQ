/*
  Static guard on the Intel magazine's rail split.

  THE BUG THIS PINS — reported from production, 2026-08-22

  The magazine spread flanks a large feature image with two vertical rails of
  article tiles. Those rails used to be filled by ALTERNATING sides:

      leftRail  = articles.filter((_, i) => i % 2 === 0)   // 0, 2, 4
      rightRail = articles.filter((_, i) => i % 2 === 1)   // 1, 3, 5

  Each rail still descended by date on its own, so nothing in the data or the
  sort was wrong — and that is exactly why no existing test caught it. What
  broke was READING order. With six articles the page rendered:

      left:  Aug 21   Aug 19   May 5
      right: Aug 20   Aug 4    May 2

  The second-newest article sat at the top of the *other* column, so there was
  no single chronological list to follow. It only read correctly if you scanned
  row by row across the spread — and a full-height feature image sits between
  the rails, so nobody does that.

  WHY THIS IS A STATIC CHECK

  The ordering is correct in the data, correct in `getAllArticles()`, and
  correct in the props handed to the component. It goes wrong purely in how one
  already-sorted array is dealt into two columns, which no assertion about the
  data can see. Reading the source is the check that discriminates — same
  reasoning as scripts/viewport-units.test.mjs.

  Run:  node scripts/intel-magazine-order.test.mjs
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(
  path.join(ROOT, 'src/components/IntelMagazine.astro'),
  'utf8',
);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('\nIntel magazine rail order\n');

test('rails are NOT dealt out by alternating sides', () => {
  assert.ok(
    !/index\s*%\s*2/.test(source),
    'IntelMagazine.astro splits its rails with `index % 2`, which puts the\n' +
      '    second-newest article at the top of the opposite column and leaves the\n' +
      '    spread with no single chronological list. Split the sorted array into\n' +
      '    sequential halves instead — newest half left, older half right.',
  );
});

test('rails are split into sequential halves', () => {
  assert.ok(
    /\.slice\(0,\s*splitAt\)/.test(source) && /\.slice\(splitAt\)/.test(source),
    'Expected the left rail to take the first half of the sorted articles and\n' +
      '    the right rail the remainder, so DOM order equals reading order.',
  );
});

test('the split point rounds up, keeping the extra tile on the newer side', () => {
  assert.ok(
    /Math\.ceil\(\s*railArticles\.length\s*\/\s*2\s*\)/.test(source),
    'Expected Math.ceil(length / 2): with an odd count the extra tile belongs\n' +
      '    on the left rail, which is the half holding the newer articles.',
  );
});

test('the centre feature is still the newest article', () => {
  assert.ok(
    /const feature[^=]*=\s*articles\[0\]/.test(source),
    'The spread opens on articles[0]; the props are documented newest-first.',
  );
});

console.log(`\n${passed} passed\n`);
