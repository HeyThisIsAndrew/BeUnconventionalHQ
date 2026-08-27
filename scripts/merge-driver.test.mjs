/*
  The synced-data merge driver.

  This code rewrites src/data/*.json during a merge, unattended. If it is
  wrong it does not throw — it silently drops documents or overwrites
  editorial work, and nobody finds out until a page renders empty. So its
  contract is pinned here rather than trusted.

  Runs the real driver as a subprocess against temp files, the same way git
  invokes it. No git repository needed.
*/
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), 'merge-sync-json.mjs');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed += 1; }
}

/** Run the driver as git would. Returns { ok, output, result }. */
function merge(ancestor, ours, theirs, name = 'src/data/videos.json') {
  const dir = mkdtempSync(join(tmpdir(), 'mergedrv-'));
  const p = (n, v) => { const f = join(dir, n); writeFileSync(f, JSON.stringify(v, null, 2)); return f; };
  const O = p('O', ancestor), A = p('A', ours), B = p('B', theirs);
  let ok = true, output = '';
  try { output = execFileSync('node', [DRIVER, O, A, B, name], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); }
  catch (e) { ok = false; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
  return { ok, output, result: JSON.parse(readFileSync(A, 'utf8')) };
}

const doc = (id, over = {}) => ({ videoId: id, views: 1, featured: false, _updatedAt: '2026-01-01', ...over });

console.log('Synced-data merge driver:');

test('a document only one side has is never dropped', () => {
  const { ok, result } = merge([], [doc('a'), doc('b')], [doc('a'), doc('c')]);
  assert.ok(ok, 'should auto-resolve');
  assert.deepEqual(result.map((d) => d.videoId).sort(), ['a', 'b', 'c']);
});

test('freshness is compared PER DOCUMENT, not per side', () => {
  /*
    The bug this pins was in the first draft: it picked the fresher SIDE
    wholesale. A side can be newer overall while holding a stale copy of one
    document the other side re-fetched, and that document silently kept its
    stale values. Here `ours` is newer overall (b) and `theirs` is newer for a.
  */
  const ours   = [doc('a', { views: 10, _updatedAt: '2026-01-01' }), doc('b', { views: 20, _updatedAt: '2026-09-01' })];
  const theirs = [doc('a', { views: 99, _updatedAt: '2026-05-01' }), doc('b', { views: 30, _updatedAt: '2026-02-01' })];
  const { ok, result } = merge([], ours, theirs);
  assert.ok(ok);
  const by = Object.fromEntries(result.map((d) => [d.videoId, d.views]));
  assert.equal(by.a, 99, 'a: theirs is newer and must win');
  assert.equal(by.b, 20, 'b: ours is newer and must win');
});

test('ANY editorial disagreement refuses the merge', () => {
  // CLAUDE.md hard rule 5. A sync must never overwrite what a human set.
  for (const field of ['featured', 'notes', 'status', 'manualTaxonomyOverride',
                       'hubs', 'topics', 'requiresReview', 'hidden', 'order']) {
    const { ok, output } = merge([], [doc('a', { [field]: 'HUMAN' })], [doc('a', { [field]: 'SYNC' })]);
    assert.equal(ok, false, `${field} disagreement must NOT auto-resolve`);
    assert.match(output, /EDITORIAL/, `${field}: the refusal must say why`);
    assert.match(output, new RegExp(field), `${field}: the refusal must name the field`);
  }
});

test('a newer factual value does NOT license overwriting editorial', () => {
  // The dangerous near-miss: theirs is newer, so a naive "newest wins" would
  // take its featured:false over a human's featured:true.
  const { ok } = merge([],
    [doc('a', { featured: true,  _updatedAt: '2026-01-01' })],
    [doc('a', { featured: false, _updatedAt: '2026-12-01' })]);
  assert.equal(ok, false, 'must refuse regardless of which side is fresher');
});

test('object-shaped files merge by key and stay objects', () => {
  // article-images.json is an object keyed by source URL, not an array. The
  // first draft handled arrays only and declined on the file most likely to
  // conflict — every article sync rewrites it.
  const { ok, result } = merge({}, { 'a.jpg': { local: 1 } }, { 'b.jpg': { ci: 1 } }, 'src/data/article-images.json');
  assert.ok(ok, 'should auto-resolve an object-shaped file');
  assert.ok(!Array.isArray(result), 'must be written back as an object');
  assert.deepEqual(Object.keys(result).sort(), ['a.jpg', 'b.jpg']);
});

test('every id field the real data files actually use is recognised', () => {
  // instagram.json keys on a bare `id` and matched none of the first draft's
  // list, which would have aborted every Instagram merge.
  for (const [label, mk] of [
    ['_id', (v) => ({ _id: 'x', v })],
    ['videoId', (v) => ({ videoId: 'x', v })],
    ['id', (v) => ({ id: 'x', v })],
    ['slug.current', (v) => ({ slug: { current: 'x' }, v })],
    ['guid', (v) => ({ guid: 'x', v })],
  ]) {
    const { ok, result } = merge([], [mk(1)], [mk(2)]);
    assert.ok(ok, `${label}: should auto-resolve`);
    assert.equal(result.length, 1, `${label}: the two sides must align to ONE document, not two`);
  }
});

test('an unidentifiable document aborts rather than guessing', () => {
  const { ok, output } = merge([], [{ noIdHere: 1 }], [{ noIdHere: 2 }]);
  assert.equal(ok, false);
  assert.match(output, /no id field/);
});

test('mismatched shapes abort rather than coercing', () => {
  const { ok, output } = merge([], [doc('a')], { 'a.jpg': {} });
  assert.equal(ok, false);
  assert.match(output, /different shapes/);
});

test('setup-git does nothing in an automated build', () => {
  /*
    The registration script runs from `postinstall`, so it fires on every CI
    and deploy build too. Its comment claimed it no-ops on "CI checkouts" —
    but a CI checkout IS a git work tree, so the work-tree guard passes there
    and it registered the driver anyway. Caught in a Cloudflare Workers Build
    log, printing its whole success banner on a production deploy.

    Harmless (the config lands in a container that never merges anything) but
    pointless work and noise in every release log. An automated build has no
    interactive merges to resolve.
  */
  const setup = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'setup-git.mjs'), 'utf8');
  for (const name of ['CI', 'GITHUB_ACTIONS']) {
    assert.ok(
      setup.includes(`'${name}'`),
      `setup-git.mjs must recognise ${name} as an automated build and skip. ` +
        'The work-tree check alone does NOT cover CI — a CI checkout is a work tree.',
    );
  }
  assert.match(setup, /const automated = /, 'the automation check must gate the exit');

  // And prove it, rather than trusting the source read.
  const run = (env) => execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'setup-git.mjs')],
    { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  assert.equal(run({ CI: 'true' }).trim(), '', 'CI=true must produce no output at all');
  assert.equal(run({ GITHUB_ACTIONS: 'true' }).trim(), '', 'GITHUB_ACTIONS=true must produce no output');
});

test('.gitattributes names the driver for every file the syncs rewrite', () => {
  const attrs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.gitattributes'), 'utf8');
  for (const f of ['videos', 'articles', 'instagram', 'article-images']) {
    assert.match(attrs, new RegExp(`src/data/${f}\\.json\\s+merge=sync-json`),
      `src/data/${f}.json must be routed to the driver, or it conflicts wholesale as before`);
  }
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
