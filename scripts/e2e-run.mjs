/*
  ─── THE E2E RUNNER ─────────────────────────────────────────────────────────

  `test:e2e` used to be nineteen `node scripts/e2e-*.test.mjs` calls joined by
  `&&`. That had three problems, and the third is why the suites had never been
  wired into CI.

  1. IT STOPPED AT THE FIRST FAILURE. `&&` short-circuits, so one red suite hid
     the result of every suite after it. You fixed one thing, re-ran six
     minutes, and found the next one.

  2. NOTHING VERIFIED THE LIST. Every suite had to be added to the chain by
     hand. A new `e2e-*.test.mjs` that nobody remembered to append simply never
     ran — the same failure mode that left `/intel` out of the Lighthouse gate
     for as long as that list existed. This discovers them from disk instead.

  3. IT WAS FLAKY UNDER LOAD, WHICH IS DISQUALIFYING FOR A GATE.

     Each suite starts its own preview server (wrangler + a workerd child) and
     its own Chrome. Run nineteen of those back to back and they contend:
     measured here, every suite passes in isolation, but a full chained run
     died on `e2e-scroll-lock` with `TimeoutError: Timed out after waiting
     8000ms` — a Puppeteer wait inside the test, not server startup, which the
     server helper already polls for with a 120s budget.

     A flaky gate is worse than no gate: it teaches everyone to ignore red.
     So this runner removes the contention rather than papering over it —
     it waits for the previous suite's port to be released before starting the
     next, and retries a suite once before calling it failed. A genuine
     failure fails twice; a load flake does not.

  Exit code is non-zero if any suite failed BOTH attempts.
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const PREVIEW_PORT = 4321;
/* One retry. Two would start hiding real intermittent bugs in the site. */
const ATTEMPTS = 2;
/* Long enough for wrangler's workerd child to release the port after SIGTERM. */
const PORT_FREE_TIMEOUT_MS = 30_000;

/** Every e2e suite on disk, in a stable order. */
function discoverSuites() {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((name) => /^e2e-.*\.test\.mjs$/.test(name))
    .sort();
}

/*
  A raw TCP connect, for the same reason scripts/e2e-server.mjs uses one: in a
  sandbox an HTTP proxy can answer for a port nothing is bound to, so "a failed
  fetch means nothing is listening" reports a phantom server. A TCP connect
  cannot be answered by a proxy.
*/
function canConnect(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: 'localhost' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Block until the preview port is free.
 *
 * startPreviewServer() THROWS if something is already listening — deliberately,
 * so a suite can never test against an orphan from a previous run. That check
 * turns a slow teardown into a hard failure of the next suite, so the runner
 * waits for the handover instead of racing it.
 */
async function waitForPortFree(port) {
  const deadline = Date.now() + PORT_FREE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await canConnect(port))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

const suites = discoverSuites();
if (suites.length === 0) {
  console.error('[e2e] No e2e-*.test.mjs suites found. That is certainly wrong.');
  process.exit(1);
}

console.log(`[e2e] Running ${suites.length} suites (up to ${ATTEMPTS} attempts each).\n`);

const failed = [];
const flaky = [];
const startedAt = Date.now();

for (const [index, file] of suites.entries()) {
  let passed = false;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= ATTEMPTS && !passed; attempt++) {
    attemptsUsed = attempt;
    if (!(await waitForPortFree(PREVIEW_PORT))) {
      console.error(
        `[e2e] Port ${PREVIEW_PORT} is still held after ${PORT_FREE_TIMEOUT_MS}ms — ` +
          'an orphaned wrangler/workerd is likely. Try `pkill -f workerd`.'
      );
      break;
    }

    console.log(
      `\n[e2e] (${index + 1}/${suites.length}) ${file}` +
        (attempt > 1 ? `  — retry ${attempt - 1}` : '')
    );
    passed = await runSuite(file);

    if (!passed && attempt < ATTEMPTS) {
      console.warn(
        `[e2e] ${file} failed on attempt ${attempt}. Retrying once — these suites ` +
          'each launch a worker and a browser, and contend under load.'
      );
    }
  }

  if (!passed) {
    failed.push(file);
  } else if (attemptsUsed > 1) {
    /* Passed, but only on the retry. Reported without failing the run — a
       suite that needs the retry EVERY time is a suite to fix, and that is
       only visible if it is named. */
    flaky.push(file);
  }
}

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`\n${'─'.repeat(60)}`);
console.log(`[e2e] ${suites.length - failed.length}/${suites.length} suites passed in ${seconds}s.`);

if (flaky.length > 0) {
  console.log(`[e2e] Passed on retry (worth a look): ${flaky.join(', ')}`);
}

if (failed.length > 0) {
  console.error(`[e2e] FAILED (both attempts): ${failed.join(', ')}`);
  process.exit(1);
}

console.log('[e2e] All suites passed.');
