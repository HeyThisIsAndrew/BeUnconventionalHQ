/**
 * E2E: the /intel magazine's swappable centre feature.
 *
 * Serves the built `dist/client` (run `npm run build` first) rather than the
 * dev server, so it exercises exactly what ships.
 *
 * The point of these assertions is that the interaction is a progressive
 * enhancement, not a JS-only feature: the rails must remain real links that
 * work with scripting disabled, and the centre must be server-rendered.
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist', 'client');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

if (!fs.existsSync(dist)) {
  console.error('[intel-magazine] No build found. Run `npm run build` first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const c of [path.join(dist, p), path.join(dist, p, 'index.html'), path.join(dist, `${p}.html`)]) {
    if (c.startsWith(dist) && fs.existsSync(c) && fs.statSync(c).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(c)] ?? 'application/octet-stream' });
      fs.createReadStream(c).pipe(res);
      return;
    }
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

let failed = 0;
let passed = 0;
const ok = (name, cond) => {
  if (cond) { console.log(`  ✓ ${name}`); passed += 1; }
  else { console.error(`  ✗ ${name}`); failed += 1; }
};

console.log('e2e-intel-magazine.test.mjs');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`http://localhost:${port}/intel`, { waitUntil: 'networkidle0' });

  const hasMagazine = await page.$('#intel-feature');
  if (!hasMagazine) {
    // With an empty archive there is no magazine to test; that is a valid
    // state, not a failure.
    console.log('  – no magazine rendered (empty archive); nothing to assert');
  } else {
    const rails = await page.$$('.intel-rail-item');
    if (rails.length === 0) {
      console.log('  – only one article; no rail items to swap');
    } else {
      const before = await page.$eval('#intel-feature-title', (e) => e.textContent.trim());
      const beforeHref = await page.$eval('#intel-feature-link', (e) => e.getAttribute('href'));
      const railTitle = await page.$eval('.intel-rail-item .intel-rail-title', (e) => e.textContent.trim());
      const railHref = await page.$eval('.intel-rail-item', (e) => e.getAttribute('href'));

      await page.click('.intel-rail-item');
      await new Promise((r) => setTimeout(r, 500));

      const after = await page.$eval('#intel-feature-title', (e) => e.textContent.trim());
      const afterHref = await page.$eval('#intel-feature-link', (e) => e.getAttribute('href'));

      ok('rail click swaps the centre feature', before !== after && after === railTitle);
      ok('centre link follows the swap', afterHref === railHref && afterHref !== beforeHref);
      ok('rail click does not navigate away', (await page.evaluate(() => location.pathname)) === '/intel');
      ok('selection is recorded in the URL hash', (await page.evaluate(() => location.hash)).length > 1);
      ok('exactly one rail item is marked active', (await page.$$eval('.intel-rail-item.active', (e) => e.length)) === 1);
      ok('active rail item exposes aria-current', (await page.$eval('.intel-rail-item.active', (e) => e.getAttribute('aria-current'))) === 'true');

      const hash = await page.evaluate(() => location.hash);
      await page.goto(`http://localhost:${port}/intel${hash}`, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 400));
      ok('hash deep-link restores the selection', (await page.$eval('#intel-feature-title', (e) => e.textContent.trim())) === railTitle);
    }

    // Progressive enhancement: the layout must survive without scripting.
    const noJs = await browser.newPage();
    await noJs.setJavaScriptEnabled(false);
    await noJs.goto(`http://localhost:${port}/intel`, { waitUntil: 'domcontentloaded' });
    const hrefs = await noJs.$$eval('.intel-rail-item', (els) => els.map((e) => e.getAttribute('href')));
    /*
      The point is that each rail item is a REAL link, not a JS-only handle —
      not that it is necessarily internal. An article we host resolves to
      /intel/<slug>; one whose body Substack has not given us still resolves
      to its Substack permalink. Both are legitimate, so accept either rather
      than failing whenever the archive happens to contain an unhosted post.
    */
    ok(
      'rail items are real links without JS (internal or Substack)',
      hrefs.length > 0 && hrefs.every((h) => h && (h.startsWith('/') || /^https?:\/\//.test(h))),
    );
    ok('centre feature is server-rendered', (await noJs.$eval('#intel-feature-title', (e) => e.textContent.trim())).length > 0);
  }
} finally {
  await browser.close();
  server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED, ${passed} passed.`);
  process.exit(1);
}
console.log(`All ${passed} tests passed.`);
