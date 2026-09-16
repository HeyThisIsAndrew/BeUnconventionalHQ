import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed += 1; }
}

console.log('\nFeed UI regressions:');

test('Feed UI regressions', () => {
  const spotlightHeroPath = path.join(process.cwd(), 'src/components/FeedSpotlightHero.astro');
  const feedGridPath = path.join(process.cwd(), 'src/components/FeedGrid.astro');
  const feedLayoutPath = path.join(process.cwd(), 'src/layouts/FeedLayout.astro');
  const layoutPath = path.join(process.cwd(), 'src/layouts/Layout.astro');
  
  const spotlightHero = fs.readFileSync(spotlightHeroPath, 'utf8');
  const feedGrid = fs.readFileSync(feedGridPath, 'utf8');
  const feedLayout = fs.readFileSync(feedLayoutPath, 'utf8');
  const layout = fs.readFileSync(layoutPath, 'utf8');

  // 1. Mobile Portrait Hero Blowout
  assert.ok(
    spotlightHero.includes('max-width: 100%'),
    'FeedSpotlightHero.astro must constrain flex children to max-width 100% to prevent line-clamp from blowing out mobile view'
  );
  
  // 2. Isolate Pagination Transitions
  assert.ok(
    !layout.includes('transition:name="page-content"'),
    'Layout.astro must NOT declare a global transition:name, which breaks pagination encapsulation'
  );
  assert.ok(
    !feedLayout.includes('transition:name="feed-grid"'),
    'FeedLayout.astro must NOT declare transition:name, to prevent full-page navigation slides'
  );
  assert.ok(
    feedGrid.includes("viewTransitionName = 'feed-grid-manual'"),
    'FeedGrid.astro must dynamically assign viewTransitionName to strictly scope pagination transitions'
  );

  // 3. Filter Button Jump-to-Top
  assert.ok(
    feedGrid.includes('e.preventDefault()'),
    'FeedGrid.astro must call e.preventDefault() on category filter buttons to prevent native #hash jump-to-top'
  );
});

if (failed > 0) {
  process.exit(1);
} else {
  console.log(`\n✅ ${passed} passed, 0 failed.\n`);
}
