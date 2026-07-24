// Lighthouse CI gate. Audits a representative set of pages against a built
// `dist/` and fails (exit 1) if any category dips below the threshold.
//
// Requires `npm run build` to have already produced `dist/`. Boots the same
// preview server as `npm run preview` (patched entry.mjs + astro preview),
// polls it with real HTTP requests until it actually answers (the e2e
// suite's stdout-text-match readiness check is known-flaky — see the
// chaos-swarm audit), then runs Lighthouse against each page in one shared
// Chrome instance.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;
const THRESHOLD = 0.9; // 90%
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const PAGES = ['/', '/feed', '/events', '/featured', '/about'];
const SERVER_READY_TIMEOUT_MS = 30_000;
const REPORTS_DIR = path.join(ROOT, '.lighthouse-reports');

function fail(message) {
  console.error(`\n[lighthouse-check] ${message}`);
  process.exitCode = 1;
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function run() {
  if (!fs.existsSync(path.join(ROOT, 'dist/server/entry.mjs'))) {
    fail('dist/server/entry.mjs not found. Run `npm run build` first.');
    return;
  }

  console.log('[lighthouse-check] Starting preview server...');
  const server = spawn('npm', ['run', 'preview'], { cwd: ROOT, stdio: 'pipe' });
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

  let chrome;
  const results = [];
  try {
    const up = await waitForServer(`${BASE_URL}/`, SERVER_READY_TIMEOUT_MS);
    if (!up) {
      fail(`Preview server did not respond within ${SERVER_READY_TIMEOUT_MS}ms.`);
      return;
    }
    console.log('[lighthouse-check] Preview server is up. Launching Chrome...');

    chrome = await chromeLauncher.launch({
      chromePath: puppeteer.executablePath(),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    for (const pagePath of PAGES) {
      const url = `${BASE_URL}${pagePath}`;
      console.log(`[lighthouse-check] Auditing ${pagePath}...`);
      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        onlyCategories: CATEGORIES,
        logLevel: 'error',
      });

      const scores = {};
      for (const cat of CATEGORIES) {
        scores[cat] = runnerResult.lhr.categories[cat]?.score ?? null;
      }
      results.push({ pagePath, scores });

      const reportFile = path.join(
        REPORTS_DIR,
        `${pagePath === '/' ? 'home' : pagePath.replace(/\//g, '_')}.json`
      );
      fs.writeFileSync(reportFile, runnerResult.report);
    }
  } finally {
    if (chrome) await chrome.kill();
    server.kill();
  }

  console.log('\n[lighthouse-check] Results (threshold: 90%):\n');
  console.log(
    ['Page', ...CATEGORIES].map((h) => h.padEnd(16)).join(' | ')
  );
  console.log('-'.repeat(16 * (CATEGORIES.length + 1) + 3 * CATEGORIES.length));

  let anyFailed = false;
  for (const { pagePath, scores } of results) {
    const row = [pagePath.padEnd(16)];
    for (const cat of CATEGORIES) {
      const score = scores[cat];
      const pct = score === null ? 'N/A' : `${Math.round(score * 100)}%`;
      const failed = score !== null && score < THRESHOLD;
      if (failed) anyFailed = true;
      row.push((failed ? `❌ ${pct}` : `✅ ${pct}`).padEnd(16));
    }
    console.log(row.join(' | '));
  }

  console.log(`\nFull reports written to ${path.relative(ROOT, REPORTS_DIR)}/`);

  if (anyFailed) {
    fail('One or more pages scored below the 90% threshold.');
  } else {
    console.log('\n[lighthouse-check] All pages passed at 90%+ across all categories.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
