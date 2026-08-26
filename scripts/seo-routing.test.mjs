/**
 * SEO ROUTING, PINNED.
 *
 * THE INCIDENT — Google Search Console, export 2026-08-26.
 * Twenty-seven URLs across five problem buckets traced back to two route
 * moves that were made correctly in the code and never finished at the edge:
 *
 *   1. src/pages/category/[slug].astro used to be a redirect stub:
 *
 *        return Astro.redirect(`/feed?category=${Astro.params.slug}`);
 *
 *      In a static Astro build that does not emit a 301. It emits an HTML
 *      file, and Astro's template for it carries BOTH a
 *      `<meta name="robots" content="noindex">` and a `<link rel="canonical">`
 *      pointing at the redirect target. So Google recorded /category/tv,
 *      /category/tv/, /category/events and /category/gaming as "Excluded by
 *      noindex", and learned about /feed?category=tv, ?category=gaming and
 *      ?category=events as canonical URLs in their own right. The stub was
 *      deleted in 87c450d; the URLs it taught Google are still in the index.
 *
 *   2. The same commit renamed src/pages/feed/[category]/ to
 *      src/pages/category/[category]/ without leaving a redirect, so
 *      /feed/film, /feed/tv and /feed/film/2 became unforwarded 404s while
 *      still sitting in Google's known-URL list.
 *
 * WHAT THIS TEST CAN AND CANNOT DO
 * It reads configuration, not a served response. It cannot prove Cloudflare
 * serves a 301, and it cannot prove Google re-crawled. What it CAN do is fail
 * the moment this repo grows another route that is advertised in the sitemap
 * and redirected at the same time, or loses the forwarding for a path Google
 * still holds. Both are silent in every other check.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const config = fs.readFileSync(path.join(repoRoot, 'astro.config.mjs'), 'utf-8');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('seo-routing');

/** The legacy paths Google still lists as known URLs for this site. */
const LEGACY_FEED_CATEGORY_PATHS = [
  '/feed/film',
  '/feed/film/2',
  '/feed/tv',
  '/feed/gaming',
  '/feed/events',
];

test('every legacy /feed/<category> path still forwards somewhere', () => {
  for (const legacy of LEGACY_FEED_CATEGORY_PATHS) {
    assert.ok(
      new RegExp(`'${legacy}':\\s*'/category/`).test(config),
      `${legacy} has no redirect in astro.config.mjs. Google still lists it; removing the redirect turns it back into a dead 404.`,
    );
  }
});

test('no redirected path is also advertised in the sitemap', () => {
  // Pull the redirect sources and the sitemap exclusion list out of the config
  // and assert the first is a subset of the second. A redirect in the sitemap
  // is the exact shape of the "Page with redirect" bucket in Search Console.
  const redirectBlock = config.slice(config.indexOf('redirects: {'), config.indexOf('prefetch:'));
  const redirectSources = [...redirectBlock.matchAll(/^\s*'(\/[^']*)':\s*'\/[^']*',/gm)].map((m) => m[1]);

  const excludedBlock = config.slice(config.indexOf('const excludedPaths = ['), config.indexOf('return !excludedPaths'));
  const excluded = new Set([...excludedBlock.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]));

  assert.ok(redirectSources.length >= 9, `expected to find the redirect map, parsed ${redirectSources.length} entries`);

  for (const source of redirectSources) {
    assert.ok(
      excluded.has(source),
      `${source} is a redirect but is not in the sitemap's excludedPaths. A sitemap must never advertise a URL that immediately redirects.`,
    );
  }
});

test('the sitemap stamps lastmod on article pages', () => {
  assert.match(config, /ARTICLE_LASTMOD/, 'the lastmod map is gone; the sitemap is back to carrying no lastmod at all');
  assert.match(config, /lastmod \? \{ \.\.\.item/, 'serialize() no longer attaches lastmod');
});

test('lastmod is derived only from dates an article actually carries', () => {
  // Guard against the tempting "just use Date.now()" regression. A lastmod
  // that changes on every build is a lie a crawler learns to ignore.
  const builder = config.slice(config.indexOf('function buildArticleLastmod'), config.indexOf('const ARTICLE_LASTMOD'));
  assert.match(builder, /record\.lastUpdated \|\| record\.isoDate/);
  assert.ok(!/Date\.now\(\)/.test(builder), 'lastmod must never be built from the current time');
});

test('no page route returns Astro.redirect (that emits a noindex stub, not a 301)', () => {
  // This is the incident above, made un-repeatable. Config `redirects` are
  // fine — the Cloudflare adapter turns those into real 301s in _redirects.
  // `Astro.redirect()` inside a prerendered page is NOT: it writes an HTML
  // file carrying `<meta name="robots" content="noindex">`.
  const pagesDir = path.join(repoRoot, 'src/pages');
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.astro')) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const frontmatter = source.startsWith('---') ? source.slice(3, source.indexOf('\n---', 3)) : '';
      if (/\bAstro\.redirect\s*\(/.test(frontmatter)) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(pagesDir);

  assert.deepEqual(
    offenders,
    [],
    `These pages call Astro.redirect() in frontmatter, which prerenders to a noindex HTML stub rather than a 301:\n  ${offenders.join('\n  ')}\nUse the \`redirects\` map in astro.config.mjs instead.`,
  );
});

if (failures > 0) {
  console.error(`\nseo-routing: ${failures} failing test(s)`);
  process.exit(1);
}
console.log('seo-routing: all passed');
