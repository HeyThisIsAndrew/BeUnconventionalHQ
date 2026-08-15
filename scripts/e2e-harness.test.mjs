/*
  THE E2E HARNESS ITSELF, PINNED.

  These are unit tests for the machinery that RUNS the browser suites, not for
  the site. They live in `npm test` rather than `npm run test:e2e` because they
  need no browser and take milliseconds — and because a harness bug takes all
  nineteen suites down at once, so it should be caught by the fast job.

  THE INCIDENT — the first CI run of the e2e job, 0/19 in nine minutes.

  Two independent faults, both in the harness.

  1. CHROME COULD NOT LAUNCH AS A NON-ROOT CI USER.

       FATAL:zygote_host_impl_linux.cc] No usable sandbox! If you are running
       on Ubuntu 23.10+ ... that has disabled unprivileged user namespaces
       with AppArmor ...

     e2e-browser.mjs passed `--no-sandbox` only when `process.getuid() === 0`.
     GitHub's ubuntu-latest runs as `runner`, not root, so the check did not
     fire — and the image restricts unprivileged user namespaces, so Chrome
     could neither use its sandbox nor fall back. Every suite failed to launch.

  2. THE RUNNER TURNED ONE CRASH INTO NINE MINUTES.

     The first suite died before its cleanup ran, leaving wrangler/workerd
     holding port 4321. The runner detected the held port, printed a helpful
     message, and moved on — to a suite that found the same held port.
     Nineteen suites x a 30s wait, to report a fact discovered in the first
     ten seconds. Detecting a stuck port and doing nothing about it is not a
     check, it is a slow way to fail.
*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const runner = fs.readFileSync(path.join(ROOT, 'scripts/e2e-run.mjs'), 'utf8');

import { sandboxUnavailableFor } from './e2e-browser.mjs';

console.log('E2E harness:');

test('CI disables the sandbox even as a NON-ROOT user', () => {
  /* The exact GitHub Actions case: uid 1001, CI=true. This is what the old
     root-only check missed, and it is why all nineteen suites died at launch. */
  assert.equal(
    sandboxUnavailableFor({ uid: 1001, ci: 'true' }),
    true,
    'GitHub runs as `runner` (non-root) on an image that blocks unprivileged\n' +
      '      user namespaces, so Chrome can neither sandbox nor fall back. Without\n' +
      '      --no-sandbox every suite dies at launch with "No usable sandbox!".',
  );
  assert.equal(sandboxUnavailableFor({ uid: 1001, ci: '1' }), true, 'CI=1 counts too');
});

test('root disables it regardless of CI', () => {
  assert.equal(sandboxUnavailableFor({ uid: 0, ci: undefined }), true);
});

test('a developer machine KEEPS the sandbox', () => {
  /* Pure function, so this holds no matter what uid the test itself runs as —
     which is the point of extracting it. */
  assert.equal(
    sandboxUnavailableFor({ uid: 1000, ci: undefined }),
    false,
    'Chrome\'s sandbox is a real security boundary and must stay ON locally.\n' +
      '      It is disabled only where it cannot work: root, or CI.',
  );
  assert.equal(sandboxUnavailableFor({ uid: 1000, ci: '' }), false);
  assert.equal(sandboxUnavailableFor({ uid: 1000, ci: 'false' }), false);
});

test('CI launches also get --disable-dev-shm-usage', () => {
  const browser = fs.readFileSync(path.join(ROOT, 'scripts/e2e-browser.mjs'), 'utf8');
  assert.ok(
    /--disable-dev-shm-usage/.test(browser),
    'CI containers give /dev/shm 64 MB and Chrome writes its shared memory\n' +
      '      there. Without this a browser that launches fine crashes partway through\n' +
      '      a page, and it reads like a test failure rather than an environment one.',
  );
});

test('the runner reclaims a port an orphaned process is holding', () => {
  assert.ok(
    /async function reclaimPort\(/.test(runner),
    'A suite that dies before its cleanup leaves wrangler/workerd on 4321, and\n' +
      '      every later suite then fails startPreviewServer\'s "already listening"\n' +
      '      check. The runner has to take the port back.',
  );
  assert.ok(
    /lsof -ti tcp:\$\{port\}/.test(runner),
    'kill the process actually bound to the port first, before any broad pkill',
  );
});

test('it does NOT kill a pre-existing server before the first suite', () => {
  assert.ok(
    /index > 0 && \(await reclaimPort\(/.test(runner),
    'Reclaiming must be gated on index > 0. Before the first suite, anything on\n' +
      '      4321 belongs to the developer — killing their `npm run dev` is not the\n' +
      '      harness\'s business. After a suite has run, an orphan is ours.',
  );
});

test('an unreclaimable port aborts the run instead of repeating per suite', () => {
  assert.ok(
    /aborted = true/.test(runner) && /if \(aborted\) break;/.test(runner),
    'When the port cannot be reclaimed, every remaining suite fails identically.\n' +
      '      The run must stop. The first CI run spent nine minutes rediscovering the\n' +
      '      same fact nineteen times.',
  );
  assert.ok(
    /failed\.push\(file, \.\.\.suites\.slice\(index \+ 1\)\)/.test(runner),
    'the un-run suites must still be reported as failed — silently skipping them\n' +
      '      would turn an aborted run into a green one.',
  );
});

test('the retry is still one, and still opt-out-able only by editing', () => {
  const m = runner.match(/const ATTEMPTS = (\d+)/);
  assert.ok(m, 'ATTEMPTS not found');
  assert.equal(
    Number(m[1]),
    2,
    'One retry. Two would start hiding genuinely intermittent bugs in the site,\n' +
      '      which is the opposite of what this gate is for.',
  );
});

test('suites are discovered from disk, never a hand-maintained list', () => {
  assert.ok(
    /readdirSync\(SCRIPTS_DIR\)[\s\S]{0,120}e2e-\.\*\\\.test\\\.mjs/.test(runner),
    'A hardcoded list that nothing verifies is how a suite goes unrun — the same\n' +
      '      failure that kept /intel out of the Lighthouse gate for as long as that\n' +
      '      list existed.',
  );
  /* And the discovery must actually see the suites that exist. */
  const onDisk = fs
    .readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => /^e2e-.*\.test\.mjs$/.test(f));
  assert.ok(
    onDisk.length >= 19,
    `only ${onDisk.length} e2e suites found on disk; expected at least 19`,
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
