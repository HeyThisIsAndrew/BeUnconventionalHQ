/*
  THE LIGHTHOUSE GATE MUST AUDIT EVERY PAGE IN THE MAIN NAV.

  `/intel` was absent from scripts/lighthouse-check.mjs for as long as that
  list has existed. Not for a reason — nothing checked the hardcoded PAGES
  array against the site's actual routes, so a surface could be added to the
  navigation and never measured, and one was. It went unnoticed until the
  owner read a report and asked why Intel was not in it.

  A hardcoded list is fine; a hardcoded list nothing verifies is how a page
  ships unmeasured. src/data/site.js already declares the navigation, and the
  gate should cover at least that, plus the homepage.

  Deliberately a MINIMUM, not an exact match: auditing extra routes is a
  judgement call (a slow one-off like /media-kit may be worth watching), and
  failing the build for auditing too much would be silly. What must never
  happen again is a nav entry going unmeasured.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../src/data/site.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

const check = fs.readFileSync(path.join(ROOT, 'scripts/lighthouse-check.mjs'), 'utf8');

/** The PAGES array as the gate actually sees it — comments stripped. */
function auditedPages() {
  const code = check.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = code.match(/const PAGES = \[([^\]]*)\]/);
  assert.ok(m, 'could not find the PAGES array in lighthouse-check.mjs');
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

console.log('Lighthouse page coverage:');

test('every main-nav route is audited', () => {
  const audited = new Set(auditedPages());
  const navRoutes = site.nav.map((item) => `/${item.href}`);
  const missing = navRoutes.filter((r) => !audited.has(r));
  assert.deepEqual(
    missing,
    [],
    `These main-nav routes are not in the Lighthouse gate: ${missing.join(', ')}\n` +
      `      Audited: ${[...audited].join(', ')}\n` +
      '      A page in the navigation that nothing measures can degrade for months\n' +
      '      without anyone noticing — which is exactly what happened to /intel.',
  );
});

test('the homepage is audited', () => {
  assert.ok(
    auditedPages().includes('/'),
    'the homepage is the most-visited route and must be in PAGES',
  );
});

test('the gate still enforces a real threshold', () => {
  const m = check.match(/const THRESHOLD = ([\d.]+)/);
  assert.ok(m, 'THRESHOLD not found');
  assert.ok(
    Number(m[1]) >= 0.9,
    `THRESHOLD is ${m[1]}; it must stay at 0.9 or higher. Widening coverage is\n` +
      '      only an improvement if the bar it applies is still meaningful.',
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
