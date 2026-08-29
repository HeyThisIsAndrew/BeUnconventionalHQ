/*
  THE LOCAL CMS WRITE GUARD.

  Every case here is one that a running dev server accepted and wrote, before
  the guard existed. They were reproduced against `npm run dev` with curl, not
  imagined:

    POST 'null' to /api/local-cms/articles  -> {"success":true}, and
      src/data/articles.json became the four bytes `null`
    POST '[]'   to /api/local-cms/videos    -> {"success":true}, and
      src/data/videos.json lost all 211 documents

  The second is the one to keep in mind. `[]` is valid JSON AND the right type,
  and it is exactly what a React editor holds when a fetch failed and its state
  initialised to an empty list. The store it wipes carries editorial fields the
  YouTube sync seeds once and never rewrites (CLAUDE.md hard rule 5), so a wipe
  is not recoverable by re-running the syncs.
*/
import assert from 'node:assert/strict';
import { validateStorePayload } from '../src/lib/local-cms-store.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed += 1; }
}

console.log('\nLocal CMS write guard:');

/* ── The writes that must be refused ─────────────────────────────────────── */

test('a syntactically broken body is refused', () => {
  const r = validateStorePayload('{"broken": ', 'articles.json');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /left untouched/);
});

test('an empty body is refused', () => {
  const r = validateStorePayload('', 'articles.json');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('bare null is refused, though it parses', () => {
  const r = validateStorePayload('null', 'articles.json');
  assert.equal(r.ok, false, 'null parses as valid JSON and used to be written verbatim');
  assert.match(r.error, /got null/);
});

test('an EMPTY ARRAY is refused, though it parses AND is the right type', () => {
  const r = validateStorePayload('[]', 'videos.json');
  assert.equal(r.ok, false,
    'this is the one that wiped 211 documents: valid JSON, correct type, and ' +
    'exactly what a failed fetch leaves in an editor\'s state');
  assert.match(r.error, /blank videos\.json/);
  assert.match(r.error, /never restored by a sync/,
    'the message must say why this is unrecoverable, not just that it was refused');
});

test('an object is refused', () => {
  const r = validateStorePayload('{}', 'videos.json');
  assert.equal(r.ok, false);
  assert.match(r.error, /got an object/);
});

for (const [label, body, shape] of [['a string', '"hello"', 'a string'], ['a number', '7', 'a number']]) {
  test(`${label} is refused`, () => {
    const r = validateStorePayload(body, 'videos.json');
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp(`got ${shape}`));
  });
}

test('the store being written is named in every refusal', () => {
  for (const body of ['{"broken": ', 'null', '[]', '{}']) {
    const r = validateStorePayload(body, 'articles.json');
    assert.equal(r.ok, false);
    assert.match(r.error, /articles\.json/,
      `"${body}" was refused without saying which file was spared`);
  }
});

/* ── The writes that must still go through ───────────────────────────────── */

test('a normal array of documents is accepted', () => {
  const r = validateStorePayload('[{"_id":"a"},{"_id":"b"}]', 'videos.json');
  assert.equal(r.ok, true);
  assert.equal(r.parsed.length, 2);
});

test('a single remaining document is accepted', () => {
  /*
    The guard stops a store being BLANKED, not a store getting smaller.
    Deleting down to one article is a thing an editor legitimately does, and a
    rule that guessed at intent would block real edits to catch a case the
    empty check already covers.
  */
  const r = validateStorePayload('[{"_id":"only-one"}]', 'articles.json');
  assert.equal(r.ok, true);
});

test('shrinking a large store is still allowed', () => {
  const many = JSON.stringify(Array.from({ length: 211 }, (_, i) => ({ _id: `d${i}` })));
  const few = JSON.stringify([{ _id: 'd0' }, { _id: 'd1' }]);
  assert.equal(validateStorePayload(many, 'videos.json').ok, true);
  assert.equal(validateStorePayload(few, 'videos.json').ok, true,
    'going from 211 documents to 2 is a big delete, but it is the editor\'s call');
});

console.log(failed === 0 ? `\n✅ ${passed} passed, 0 failed.\n` : `\n❌ ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
