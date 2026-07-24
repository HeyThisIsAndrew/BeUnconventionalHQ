/**
 * Generates the media kit's downloadable PDF via headless Chromium instead
 * of relying on a visitor's own browser/OS print pipeline.
 *
 * window.print() hands rendering off to whatever print engine the visiting
 * device has, and that turned out to vary in ways CSS can't reconcile:
 * iOS Safari's AirPrint pipeline reserves its own margin and stamps a URL/
 * date/page-count footer onto every page (not controllable from web page
 * code at all), while desktop Chrome's print-to-PDF has a togglable
 * "headers and footers" *dialog* setting - a human choice made once, not a
 * permanent fix, and not exposed to the user at all on iOS's Share Sheet.
 * No single @media print stylesheet satisfies every device's print engine.
 *
 * This generates the PDF directly instead: same Chromium print pipeline
 * Puppeteer already uses for this project's e2e tests, driven by code with
 * zero margins and headers/footers explicitly off, every time. The output
 * is committed to public/downloads/ and both "Download PDF" buttons (there
 * is only one, shared between desktop/mobile via responsive CSS) just link
 * to that static file - no print action, on either platform, ever again.
 *
 * Run after `npm run refresh-analytics` (or whenever the media kit page's
 * design changes) and commit the regenerated PDF alongside it.
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '../public/downloads/be-unconventional-hq-media-kit.pdf');

console.log('[media-kit-pdf] Building the site...');
execSync('npx astro build', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

console.log('[media-kit-pdf] Starting preview server...');
const server = spawn('npm', ['run', 'preview'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });

const baseUrl = await new Promise((resolve, reject) => {
  let output = '';
  const onData = (data) => {
    output += data.toString();
    const match = output.match(/(https?:\/\/localhost:\d+)/);
    if (match) resolve(match[1]);
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
  server.on('error', reject);
  server.on('exit', (code) => {
    if (code !== 0) reject(new Error(`Preview server exited with code ${code}`));
  });
  setTimeout(() => reject(new Error('Preview server start timed out')), 30000);
});

let exitCode = 0;
try {
  console.log(`[media-kit-pdf] Rendering ${baseUrl}/media-kit/ to PDF...`);
  // --no-sandbox: needed when this runs as root (CI containers, some local
  // dev setups) - Chromium's sandbox refuses to start otherwise. Puppeteer's
  // own docs list this as the standard workaround for that specific case.
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1300 });
    await page.goto(`${baseUrl}/media-kit/`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType('print');

    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await page.pdf({
      path: OUT_FILE,
      printBackground: true,
      displayHeaderFooter: false,
      width: '8.5in',
      height: '11in',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    await browser.close();
  }
  console.log(`[media-kit-pdf] Saved to ${OUT_FILE}`);
} catch (err) {
  console.error(`[media-kit-pdf] Failed: ${err.message}`);
  exitCode = 1;
} finally {
  server.kill();
}

process.exit(exitCode);
