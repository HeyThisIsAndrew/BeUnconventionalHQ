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
const PREVIEW_PORT = 4321;
const PROXY_PORT = 4322;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const BASE_URL = `http://localhost:${PROXY_PORT}`;
const THRESHOLD = 0.9; // 90%
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const PAGES = ['/', '/feed', '/events', '/featured', '/about'];
const SERVER_READY_TIMEOUT_MS = 30_000;
const REPORTS_DIR = path.join(ROOT, '.lighthouse-reports');
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
  const server = spawn('npm', ['run', 'preview'], { cwd: ROOT, stdio: 'pipe', detached: true });
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
    if (chrome) chrome.kill();
    if (proxy) proxy.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
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
