// Lighthouse CI gate. Audits a representative set of pages against a built
// `dist/` and fails (exit 1) if any category dips below the threshold.
//
// Requires `npm run build` to have already produced `dist/`. Boots the same
// preview server as `npm run preview` (patched entry.mjs + astro preview),
// polls it with real HTTP requests until it actually answers (the e2e
// suite's stdout-text-match readiness check is known-flaky — see the
// chaos-swarm audit), then runs Lighthouse against each page in one shared
// Chrome instance.
//
// `astro preview` (workerd's local simulation) serves everything
// uncompressed — verified empirically, no Content-Encoding header on any
// response. Real production is Cloudflare's edge, which brotli/gzip-
// compresses every text response automatically. Auditing the bare preview
// server measures a strictly slower target than what ships, so a small
// compressing reverse proxy sits between Lighthouse and the preview server
// to approximate real edge behavior. Without this the 90% gate would be
// unpassable regardless of code quality.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = 4323;
const PROXY_PORT = 4324;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const BASE_URL = `http://localhost:${PROXY_PORT}`;
const THRESHOLD = 0.9; // 90%
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
/*
  Every primary surface of the site. `/intel` was missing for as long as this
  list has existed — not for any reason, it was simply never added, and nothing
  checked the list against the site's actual routes. It is the articles index,
  one of the four things in the main nav, and it was the only one unaudited.

  Kept in sync by scripts/lighthouse-pages.test.mjs, which fails if a route in
  the main navigation is absent here.
*/
const PAGES = ['/', '/feed', '/intel', '/events', '/featured', '/about'];
const SERVER_READY_TIMEOUT_MS = 30_000;
/*
  Form factor. Lighthouse's default is MOBILE (a throttled mid-tier phone),
  which is the harder target and stays the default here so the gate cannot be
  softened by accident. `--desktop` audits the desktop preset instead, which
  is the number tracked separately (it runs materially higher — no CPU/network
  throttling and a wider viewport, so more of the page is in the initial
  view). Reports are written to separate files so a desktop run never
  overwrites the mobile evidence.
*/
const DESKTOP = process.argv.includes('--desktop');
const FORM_FACTOR = DESKTOP ? 'desktop' : 'mobile';
const REPORTS_DIR = path.join(ROOT, DESKTOP ? '.lighthouse-reports-desktop' : '.lighthouse-reports');
const COMPRESSIBLE_TYPES = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;

function startCompressingProxy() {
  const proxy = http.createServer((clientReq, clientRes) => {
    const upstreamReq = http.request(
      {
        host: 'localhost',
        port: PREVIEW_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers, 'accept-encoding': 'identity', host: `localhost:${PREVIEW_PORT}` },
      },
      (upstreamRes) => {
        const contentType = upstreamRes.headers['content-type'] || '';
        const acceptsBr = (clientReq.headers['accept-encoding'] || '').includes('br');
        const compressible = COMPRESSIBLE_TYPES.test(contentType) && acceptsBr;

        if (!compressible) {
          clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
          upstreamRes.pipe(clientRes);
          return;
        }

        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          const body = Buffer.concat(chunks);
          const compressed = zlib.brotliCompressSync(body, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
          });
          const headers = { ...upstreamRes.headers };
          headers['content-encoding'] = 'br';
          headers['content-length'] = compressed.length;
          clientRes.writeHead(upstreamRes.statusCode, headers);
          clientRes.end(compressed);
        });
      }
    );
    upstreamReq.on('error', (err) => {
      clientRes.writeHead(502);
      clientRes.end(String(err));
    });
    clientReq.pipe(upstreamReq);
  });
  return new Promise((resolve, reject) => {
    proxy.on('error', reject);
    proxy.listen(PROXY_PORT, () => resolve(proxy));
  });
}

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
  // detached so the whole process group (npm -> astro preview -> workerd) can
  // be killed together in finally(). Killing just the npm PID leaves workerd
  // running, which orphans the port and hangs any process still piping this
  // script's stdout.
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT)], {
    cwd: ROOT,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', PUBLIC_DISABLE_ANALYTICS: 'true' },
  });
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

  let chrome;
  let proxy;
  const results = [];
  try {
    const up = await waitForServer(`${PREVIEW_URL}/`, SERVER_READY_TIMEOUT_MS);
    if (!up) {
      fail(`Preview server did not respond within ${SERVER_READY_TIMEOUT_MS}ms.`);
      return;
    }
    console.log('[lighthouse-check] Preview server is up. Starting compression proxy...');
    proxy = await startCompressingProxy();

    console.log('[lighthouse-check] Launching Chrome...');
    chrome = await chromeLauncher.launch({
      chromePath: await puppeteer.executablePath(),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    /*
      A Lighthouse score is a MEASUREMENT, not a property of the code, and on a
      shared CI runner the noisiest input by far is total-blocking-time — it is
      pure main-thread timing, so a noisy neighbour on the runner moves it
      tens of percent. This gate was failing on that noise:

        run 693 (push)         commit eda768a  ->  / = 96%  PASS
        run 694 (pull_request) commit eda768a  ->  / = 89%  FAIL

      Same commit, same workflow, opposite results; the same flip happened in
      reverse on a01eba2f (685 FAIL 88% / 686 PASS). Locally the same build
      scores 96-100 mobile and 100 desktop.

      So a page is only failed after being CONFIRMED: if any category comes in
      under the threshold, that page is re-audited and the MEDIAN of the
      samples decides. One unlucky sample can no longer fail the build, while a
      genuine regression — which reproduces every time — still fails all of
      them and still fails the gate. The samples are printed so a page that
      needed retries is visible rather than silently smoothed over.
    */
    const CONFIRM_SAMPLES = 3;
    const median = (values) => {
      const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
      if (!sorted.length) return null;
      return sorted[Math.floor(sorted.length / 2)];
    };

    /* One flags object, shared by the first pass and any confirmation runs, so
       a retry can never be audited under different conditions than the run it
       is confirming. */
    const lighthouseFlags = {
      port: chrome.port,
      output: 'json',
      onlyCategories: CATEGORIES,
      logLevel: 'error',
      /* `formFactor` alone does not change emulation — Lighthouse keeps the
         mobile screen and throttling unless screenEmulation and throttling
         are switched too, which silently produces a "desktop" run that is
         really a phone run. These are lighthouse's own desktop preset
         values. */
      ...(DESKTOP
        ? {
            formFactor: 'desktop',
            screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
            throttling: {
              rttMs: 40,
              throughputKbps: 10 * 1024,
              cpuSlowdownMultiplier: 1,
              requestLatencyMs: 0,
              downloadThroughputKbps: 0,
              uploadThroughputKbps: 0,
            },
          }
        : {}),
    };

    for (const pagePath of PAGES) {
      const url = `${BASE_URL}${pagePath}`;
      console.log(`[lighthouse-check] Auditing ${pagePath}...`);
      const runnerResult = await lighthouse(url, lighthouseFlags);

      const scores = {};
      for (const cat of CATEGORIES) {
        scores[cat] = runnerResult.lhr.categories[cat]?.score ?? null;
      }

      /* Confirm a sub-threshold result before believing it — see the note
         above the loop. Only failing pages pay the extra runtime. */
      let samples = null;
      let confirmed = runnerResult;
      if (CATEGORIES.some((cat) => scores[cat] !== null && scores[cat] < THRESHOLD)) {
        samples = {};
        for (const cat of CATEGORIES) samples[cat] = [scores[cat]];

        for (let attempt = 2; attempt <= CONFIRM_SAMPLES; attempt++) {
          console.log(`[lighthouse-check] ${pagePath} scored below ${THRESHOLD * 100}% — confirming (${attempt}/${CONFIRM_SAMPLES})...`);
          const retry = await lighthouse(url, lighthouseFlags);
          for (const cat of CATEGORIES) samples[cat].push(retry.lhr.categories[cat]?.score ?? null);
          /* Keep the worst run's report on disk: if the gate does fail, the
             uploaded artifact should show the failure, not the lucky sample. */
          const retryWorst = Math.min(...CATEGORIES.map((c) => retry.lhr.categories[c]?.score ?? 1));
          const heldWorst = Math.min(...CATEGORIES.map((c) => confirmed.lhr.categories[c]?.score ?? 1));
          if (retryWorst < heldWorst) confirmed = retry;
        }

        for (const cat of CATEGORIES) scores[cat] = median(samples[cat]);
      }

      results.push({
        pagePath,
        scores,
        samples,
        diagnostics: collectDiagnostics(confirmed.lhr),
      });

      const reportFile = path.join(
        REPORTS_DIR,
        `${pagePath === '/' ? 'home' : pagePath.replace(/\//g, '_')}.json`
      );
      fs.writeFileSync(reportFile, confirmed.report);
    }
  } finally {
    if (chrome) chrome.kill();
    if (proxy) proxy.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
  }

  console.log(`\n[lighthouse-check] Results — ${FORM_FACTOR} (threshold: 90%):\n`);
  console.log(
    ['Page', ...CATEGORIES].map((h) => h.padEnd(16)).join(' | ')
  );
  console.log('-'.repeat(16 * (CATEGORIES.length + 1) + 3 * CATEGORIES.length));

  let anyFailed = false;
  const retried = [];
  for (const { pagePath, scores, samples } of results) {
    const row = [pagePath.padEnd(16)];
    for (const cat of CATEGORIES) {
      const score = scores[cat];
      const pct = score === null ? 'N/A' : `${Math.round(score * 100)}%`;
      const failed = score !== null && score < THRESHOLD;
      if (failed) anyFailed = true;
      row.push((failed ? `❌ ${pct}` : `✅ ${pct}`).padEnd(16));
    }
    console.log(row.join(' | ') + (samples ? '  (median of 3)' : ''));
    if (samples) retried.push({ pagePath, samples });
  }

  /* Show the spread for any page that needed confirming. A tight spread that
     sits under the threshold is a real regression; a wide one is runner
     noise, and the difference matters when reading a red build. */
  if (retried.length) {
    console.log('\n--- confirmation samples (page scored below threshold on first pass) ---');
    for (const { pagePath, samples } of retried) {
      for (const cat of CATEGORIES) {
        const vals = samples[cat].filter((v) => v !== null);
        if (!vals.length || vals.every((v) => v >= THRESHOLD)) continue;
        console.log(
          `  ${pagePath.padEnd(12)} ${cat.padEnd(16)} ${vals.map((v) => `${Math.round(v * 100)}%`).join(' / ')}`
        );
      }
    }
  }

  console.log(`\nFull reports written to ${path.relative(ROOT, REPORTS_DIR)}/`);

  /*
    Print WHY a page failed, not just that it did.

    The table above is four numbers and no reason for any of them, and the
    JSON that holds the reason is an uploaded artifact — which means reading
    it costs a download, and is simply unavailable to anyone whose network
    cannot reach the artifact storage host. Chasing a red /events through
    several rounds of push-and-look-at-the-table is how you end up guessing:
    it is entirely possible to "fix" blocking time by 93%, watch the score
    move by one point, and still not know what the binding metric was.

    So the failing page explains itself in the log. Only failures print this,
    so a green run stays a five-line table.
  */
  for (const { pagePath, scores, diagnostics } of results) {
    const failedHere = CATEGORIES.some(
      (cat) => scores[cat] !== null && scores[cat] < THRESHOLD,
    );
    if (!failedHere || !diagnostics) continue;
    printDiagnostics(pagePath, diagnostics);
  }

  if (anyFailed) {
    fail('One or more pages scored below the 90% threshold.');
  } else {
    console.log('\n[lighthouse-check] All pages passed at 90%+ across all categories.');
  }
}

/*
  Pull the few things that actually explain a performance score out of the
  full LHR, so the failure path can print them without keeping whole reports
  (each is several megabytes) alive in memory for every page.
*/
function collectDiagnostics(lhr) {
  const audit = (id) => lhr.audits?.[id];

  const metrics = [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index',
    'interactive',
  ]
    .map((id) => {
      const a = audit(id);
      if (!a) return null;
      return {
        id,
        display: a.displayValue ?? '',
        // The per-metric score is the part that matters: a "3.2 s" LCP means
        // nothing on its own, but a score of 71 says exactly how many points
        // are sitting there to be won.
        score: a.score === null || a.score === undefined ? null : Math.round(a.score * 100),
      };
    })
    .filter(Boolean);

  /*
    Which element the LCP actually is, and where its time went. Guessing the
    element wrong sends you optimising an image the metric was never
    measuring — and the phase split is what separates "the file is too big"
    from "we discovered it too late" from "the server was slow", which are
    three completely different fixes.

    Lighthouse 13 moved this into `lcp-breakdown-insight`; the older
    `largest-contentful-paint-element` id is kept as a fallback so this keeps
    working across a version bump either way. Both nest a `type: 'node'`
    entry, sometimes at the top level of details.items and sometimes under a
    `.node` key, so accept both shapes.
  */
  let lcpElement = null;
  let lcpPhases = [];
  const lcpAudit = audit('lcp-breakdown-insight') ?? audit('largest-contentful-paint-element');

  const findNode = (items = []) => {
    for (const item of items) {
      if (item?.type === 'node' && (item.snippet || item.selector)) return item;
      if (item?.node?.snippet || item?.node?.selector) return item.node;
      const nested = findNode(item?.items ?? []);
      if (nested) return nested;
    }
    return null;
  };
  const node = findNode(lcpAudit?.details?.items ?? []);
  if (node) lcpElement = node.snippet || node.selector;

  const findPhases = (items = []) => {
    for (const item of items) {
      const rows = item?.items ?? [];
      if (rows.some((r) => r?.duration !== undefined && (r?.label || r?.subpart))) {
        return rows.map((r) => ({
          label: r.label || r.subpart,
          ms: Math.round(r.duration),
        }));
      }
      const nested = findPhases(rows);
      if (nested.length) return nested;
    }
    return [];
  };
  lcpPhases = findPhases(lcpAudit?.details?.items ?? []);

  // Opportunities, largest first — Lighthouse's own estimate of the ms each
  // would return.
  const opportunities = Object.values(lhr.audits ?? {})
    .filter((a) => a?.details?.type === 'opportunity' && (a.numericValue ?? 0) >= 100)
    .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))
    .slice(0, 5)
    .map((a) => ({ title: a.title, ms: Math.round(a.numericValue) }));

  // The heaviest things on the wire, with when they finished, which is what
  // exposes a slow third-party origin.
  const requests = (audit('network-requests')?.details?.items ?? [])
    .filter((r) => (r.transferSize ?? 0) > 20000)
    .sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))
    .slice(0, 6)
    .map((r) => ({
      kb: Math.round((r.transferSize ?? 0) / 1024),
      endMs: Math.round(r.networkEndTime ?? 0),
      url: String(r.url ?? ''),
    }));

  return { metrics, lcpElement, lcpPhases, opportunities, requests };
}

function printDiagnostics(pagePath, { metrics, lcpElement, lcpPhases, opportunities, requests }) {
  console.log(`\n--- why ${pagePath} failed -------------------------------------------`);

  if (metrics.length) {
    console.log('  metric (score out of 100):');
    for (const m of metrics) {
      console.log(
        `    ${m.id.padEnd(26)} ${String(m.display).padStart(9)}   ${m.score === null ? '-' : m.score}`,
      );
    }
  }

  console.log(`\n  LCP element:\n    ${lcpElement ? String(lcpElement).slice(0, 160) : '(not reported)'}`);

  if (lcpPhases.length) {
    // Which phase dominates tells you which fix is the right one: time to
    // first byte -> the server; resource load delay -> the browser found it
    // late, so preload/priority; load duration -> the file is too big;
    // render delay -> the main thread was busy.
    console.log('\n  LCP phases:');
    for (const p of lcpPhases) {
      console.log(`    ${String(p.label).padEnd(26)} ${String(p.ms).padStart(6)}ms`);
    }
  }

  if (opportunities.length) {
    console.log('\n  opportunities:');
    for (const o of opportunities) {
      console.log(`    ${String(o.ms).padStart(6)}ms  ${o.title}`);
    }
  }

  if (requests.length) {
    console.log('\n  heaviest requests (kB, finished at):');
    for (const r of requests) {
      console.log(`    ${String(r.kb).padStart(5)}kB  ${String(r.endMs).padStart(6)}ms  ${r.url.slice(0, 96)}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
