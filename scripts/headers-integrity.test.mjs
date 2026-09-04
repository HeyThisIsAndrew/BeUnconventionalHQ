/*
  public/_headers declares each path exactly once.

  ─── THE OUTAGE THIS GUARDS ───────────────────────────────────────────────
  A second `/*` block was added to carry the RFC 8288 Link header for #192.
  It looked additive. It was not.

  Cloudflare applies the LAST matching rule for a path, not the union of the
  matching rules, so the new `/*` REPLACED the existing one. The site shipped
  to production with no Content-Security-Policy, no Strict-Transport-Security,
  no X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy and no
  Permissions-Policy on any page.

  It was invisible in review (the diff reads as "add a header"), invisible in
  `npm test`, and invisible to the Lighthouse gate, which runs against a local
  build. It surfaced as Best Practices 73 in a production Lighthouse run, with
  all four Trust and Safety audits failing at once.

  Losing the CSP also takes `unsafe-eval` with it, which Partytown requires to
  rehydrate its `resolveUrl`; the same report showed the CORS failures that
  issue #63 documented as the signature of exactly that.

  So: one block per path. Additions go inside the block that already exists.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = fs.readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');

/** Path lines are unindented and start with `/`; header lines are indented. */
const paths = raw
  .split('\n')
  .filter((line) => /^\/\S*\s*$/.test(line))
  .map((line) => line.trim());

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (error) { failures += 1; console.error(`  ✗ ${name}\n      ${error.message}`); }
}

console.log('\npublic/_headers integrity');

check('no path is declared twice', () => {
  const seen = new Map();
  const dupes = [];
  for (const p of paths) {
    if (seen.has(p)) dupes.push(p);
    seen.set(p, true);
  }
  assert.deepEqual(
    dupes,
    [],
    `duplicate path block(s): ${dupes.join(', ')}. Cloudflare keeps only the LAST ` +
      'one, so the earlier block is silently dropped. Merge into the existing block.',
  );
});

check('the site-wide block still carries every security header', () => {
  /* Each of these was live, then silently absent in production for the
     duration of the duplicate-block regression. Named individually so a
     future edit cannot quietly drop one. */
  const block = raw.slice(raw.indexOf('\n/*\n'), raw.indexOf('\n/admin\n'));
  for (const header of [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    assert.ok(block.includes(`${header}:`), `${header} is missing from the /* block`);
  }
});

check("the CSP keeps 'unsafe-eval', which Partytown cannot work without", () => {
  /* Not a nice-to-have: without it Partytown's `new Function` rehydration of
     resolveUrl is blocked, it loads vendor scripts cross-origin instead, and
     they fail CORS. See the long note in _headers and issue #63. */
  assert.match(raw, /script-src[^;]*'unsafe-eval'/);
});

check('the RFC 8288 Link header lives inside that same block', () => {
  const block = raw.slice(raw.indexOf('\n/*\n'), raw.indexOf('\n/admin\n'));
  assert.match(block, /Link: <\/\.well-known\/api-catalog>/, 'the Link header moved out of /*');
});

console.log(
  failures === 0
    ? '\n✅ _headers integrity checks passed.\n'
    : `\n❌ ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
