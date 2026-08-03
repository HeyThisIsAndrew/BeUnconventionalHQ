/**
 * E2E: the hero survives a device rotation while the splash curtain is down.
 *
 * ─── THE BUG THIS PINS ────────────────────────────────────────────────────
 * Reported from an iPhone: open the homepage in portrait, rotate to
 * landscape, and the hero copy and the "Explore The HQ" button sit far below
 * the middle of the screen, pushed toward the bottom edge.
 *
 * The cause is the splash's own scroll lock. `html.splash-armed` puts
 * `overflow: hidden` on the ROOT element, and iOS Safari then stops
 * re-resolving `lvh`/`svh` — the units the hero is sized in on phones — when
 * the device is rotated. The media queries flip, so landscape's rules apply,
 * but `100svh` keeps handing back the height it computed in portrait: an
 * 844px-tall hero inside a 390px-tall viewport, whose `align-items: center`
 * puts the copy at ~422px, past the bottom of the screen.
 *
 * ─── WHY THE FREEZE IS SIMULATED ──────────────────────────────────────────
 * The freeze is a WebKit behaviour and headless Chromium does not have it —
 * it re-resolves the units correctly, so simply rotating the viewport here
 * would pass with or without the fix and prove nothing. So the stale value is
 * injected: a stylesheet that pins landscape's own `min-height` to the
 * portrait number, at the SAME specificity as the real rule in
 * landscape.css. What is then measured is the thing that can actually be got
 * wrong in this codebase — whether the compensation in splash.css wins the
 * cascade against it, and whether Hero.astro's measurement keeps up with the
 * rotation. (The same reasoning as scripts/viewport-units.test.mjs, which
 * pins the unit itself because no browser test can tell lvh from svh.)
 *
 * The desktop case is asserted too, and is not a formality: an earlier
 * attempt at this fix applied the measured height globally and broke the
 * desktop hero outright.
 *
 * Serves the built `dist/client`, so it exercises exactly what ships.
 */
import { launchTestBrowser } from './e2e-browser.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist', 'client');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

if (!fs.existsSync(dist)) {
  console.error('[hero-rotation] No build found. Run `npm run build` first.');
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
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${name}`); passed += 1; }
  else { console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};

console.log('e2e-hero-rotation.test.mjs');

const browser = await launchTestBrowser();

/** Everything the assertions below need, read in one round trip. */
const readHero = (page) =>
  page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const cta = document.querySelector('.hero-cta');
    const heroBox = hero.getBoundingClientRect();
    const ctaBox = cta.getBoundingClientRect();
    return {
      armed: document.documentElement.classList.contains('splash-armed'),
      coarse: matchMedia('(pointer: coarse)').matches,
      viewportVar: getComputedStyle(document.documentElement).getPropertyValue('--hero-viewport-h').trim(),
      lift: getComputedStyle(document.documentElement).getPropertyValue('--splash-lift').trim(),
      minHeight: getComputedStyle(hero).minHeight,
      heroH: Math.round(heroBox.height),
      ctaCentre: Math.round(ctaBox.top + ctaBox.height / 2),
      innerHeight: window.innerHeight,
    };
  });

async function openPhone(width, height) {
  const page = await browser.newPage();
  /* `hasTouch` is the load-bearing flag: it is what makes
     `(pointer: coarse)` match, which is the media query the compensation is
     gated on. A phone user-agent string is not needed and does not affect
     it. */
  await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 500));
  return page;
}

/** Rotate an already-loaded page and let the measurement settle. */
async function rotate(page, width, height) {
  await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  /* Puppeteer's viewport change fires `resize`; `orientationchange` is the
     other half of what Hero.astro listens for, and iOS does not reliably
     fire both. Dispatching it here exercises that path. */
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await new Promise((r) => setTimeout(r, 500));
}

try {
  // ── Desktop: the compensation must not exist at all ─────────────────────
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));
    const s = await readHero(page);

    ok('desktop: splash arms', s.armed === true);
    ok('desktop: pointer is fine, so the rule cannot apply', s.coarse === false);
    /* The failure this catches is not subtle — a measured height forced onto
       the desktop hero threw the whole page's layout out. */
    ok('desktop: hero still fills exactly one viewport', s.heroH === 900, `${s.heroH}px`);
    ok('desktop: no min-height floor', s.minHeight === 'auto' || s.minHeight === '0px', s.minHeight);
    await page.close();
  }

  // ── Phone, no freeze: the floor must be INERT ───────────────────────────
  /*
     The whole safety argument for this fix is that `min-height` can only ever
     raise the hero, so when the units resolve correctly it changes nothing.
     If that stops being true, the address-bar behaviour hero.css documents at
     length is back in play — hence asserting the no-op, not just the fix.
  */
  {
    const page = await openPhone(390, 844);
    const s = await readHero(page);
    ok('phone portrait: pointer is coarse', s.coarse === true);
    ok('phone portrait: --hero-viewport-h published', s.viewportVar === `${s.innerHeight}px`, s.viewportVar);
    ok('phone portrait: hero is still exactly one viewport', s.heroH === s.innerHeight, `${s.heroH} vs ${s.innerHeight}`);
    ok('phone portrait: CTA is on screen', s.ctaCentre > 0 && s.ctaCentre < s.innerHeight, `centre ${s.ctaCentre}`);
    await page.close();
  }

  // ── The reported bug: portrait → landscape with the freeze simulated ────
  {
    const page = await openPhone(390, 844);
    ok('rotation: armed before rotating', (await readHero(page)).armed === true);

    await page.addStyleTag({
      content: '@media (orientation: landscape) and (max-height: 500px) { .hero { min-height: 844px; } }',
    });
    await rotate(page, 844, 390);
    const s = await readHero(page);

    ok('rotation: still armed afterwards', s.armed === true);
    ok('rotation: --hero-viewport-h followed the rotation', s.viewportVar === '390px', s.viewportVar);
    ok('rotation: the stale 844px floor is overridden', s.minHeight === '390px', s.minHeight);
    ok('rotation: hero is not still sized for portrait', s.heroH < 500, `${s.heroH}px`);
    /* The reported symptom, stated directly: the button was off the bottom of
       the screen. Frozen, its centre lands at ~422px in a 390px viewport. */
    ok('rotation: the CTA is back on screen', s.ctaCentre > 0 && s.ctaCentre < 390, `centre ${s.ctaCentre}`);
    /* The lift is measured after the correction, so the curtain still travels
       exactly one hero — a stale lift leaves a seam at the end of the reveal. */
    ok('rotation: --splash-lift matches the corrected hero', s.lift === `${s.heroH}px`, `${s.lift} vs ${s.heroH}px`);
    await page.close();
  }

  // ── The mirror case: landscape → portrait, frozen SHORT ─────────────────
  /*
     Same freeze, read the other way: the hero keeps the landscape height and
     is far too short, so the section below shows through under it. Nobody
     reported this one, but it is the same defect and the floor covers it.
  */
  {
    const page = await openPhone(844, 390);
    await page.addStyleTag({
      content: '@media (pointer: coarse) { .hero { height: 390px; } }',
    });
    await rotate(page, 390, 844);
    const s = await readHero(page);

    ok('reverse rotation: the floor restores a full-screen hero', s.heroH === 844, `${s.heroH}px`);
    ok('reverse rotation: --splash-lift matches', s.lift === '844px', s.lift);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
