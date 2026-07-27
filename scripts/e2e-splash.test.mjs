/**
 * E2E: the homepage splash / curtain reveal.
 *
 * ─── WHAT THIS PROTECTS ───────────────────────────────────────────────────
 * The curtain is the hero itself, lifted by a transform on #app-wrapper and
 * then swapped for a real scroll offset. Two things can go wrong invisibly:
 *
 *   1. The swap at the end leaves the page at the wrong scroll offset, or
 *      leaves a stray transform on the wrapper — the page looks fine until
 *      you scroll and everything is shifted.
 *   2. The splash arms somewhere it shouldn't (an interior page, a deep link)
 *      and hides the navbar on a page with no curtain to lift, which would
 *      strand the reader with no navigation at all.
 *
 * Both end states look plausible in a screenshot, so they are measured here.
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
  console.error('[splash] No build found. Run `npm run build` first.');
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

console.log('e2e-splash.test.mjs');

const browser = await launchTestBrowser();

try {
  for (const [label, width, height] of [['mobile', 390, 844], ['desktop', 1440, 900]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));

    const armed = await page.evaluate(() => ({
      armed: document.documentElement.classList.contains('splash-armed'),
      navVisible: getComputedStyle(document.getElementById('navbar')).visibility,
      ctaHref: document.querySelector('[data-splash-trigger]')?.getAttribute('href'),
      lift: getComputedStyle(document.documentElement).getPropertyValue('--splash-lift').trim(),
      heroH: Math.round(document.querySelector('.hero').offsetHeight),
    }));

    ok(`${label}: splash arms on the homepage`, armed.armed === true);
    ok(`${label}: navbar hidden while armed`, armed.navVisible === 'hidden', armed.navVisible);
    /* The no-JS fallback has to stay a real in-page anchor pointing BELOW the
       hero. If it becomes "/feed" again the bounce problem is back; if it
       points at a wrapper starting at offset 0 (as `#page-content` did) the
       button silently does nothing once the splash has been dismissed. */
    ok(`${label}: CTA anchors below the hero, not /feed`, armed.ctaHref === '#hq-content', String(armed.ctaHref));
    ok(
      `${label}: lift distance measured from the hero (${armed.lift})`,
      armed.lift === `${armed.heroH}px`,
      `hero=${armed.heroH}px var=${armed.lift}`,
    );

    // ── Lift ────────────────────────────────────────────────────────────
    await page.evaluate(() => document.querySelector('[data-splash-trigger]').click());
    /* Longer than the 900ms transition so the end-state swap has run. */
    await new Promise((r) => setTimeout(r, 1500));

    const after = await page.evaluate(() => ({
      armed: document.documentElement.classList.contains('splash-armed'),
      lifting: document.documentElement.classList.contains('splash-lifting'),
      transform: getComputedStyle(document.getElementById('app-wrapper')).transform,
      scrollY: Math.round(window.scrollY),
      navVisible: getComputedStyle(document.getElementById('navbar')).visibility,
      heroH: Math.round(document.querySelector('.hero').offsetHeight),
      hash: window.location.hash,
    }));

    ok(`${label}: disarms after the lift`, after.armed === false && after.lifting === false);
    ok(`${label}: navbar returns`, after.navVisible === 'visible', after.navVisible);
    /*
      The two assertions that catch the invisible failure: the transform must
      be fully released AND the scroll offset must have taken its place. If
      only one happened the page is silently shifted by a whole viewport.
    */
    ok(
      `${label}: wrapper transform released`,
      after.transform === 'none' || after.transform === 'matrix(1, 0, 0, 1, 0, 0)',
      after.transform,
    );
    ok(
      `${label}: scrolled to exactly the hero height`,
      Math.abs(after.scrollY - after.heroH) <= 2,
      `scrollY=${after.scrollY} heroH=${after.heroH}`,
    );
    /* preventDefault must have stopped the anchor, or the URL picks up a hash
       and a reload would skip the splash forever. */
    ok(`${label}: no #page-content left in the URL`, after.hash === '', after.hash);

    // ── Tiles ───────────────────────────────────────────────────────────
    /*
      Scroll to the BOTTOM of the grid, not its top. On a phone the tiles are a
      single column taller than the viewport, so aligning the grid's top leaves
      the last tile below the fold — it correctly stays hidden, and asserting
      otherwise would be testing that a viewport-triggered reveal ignores the
      viewport.
    */
    await page.evaluate(() => {
      const grid = document.querySelector('.cat-grid');
      if (grid) window.scrollTo(0, grid.getBoundingClientRect().bottom + window.scrollY);
    });
    await new Promise((r) => setTimeout(r, 1200));
    const tiles = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.cat-stagger')];
      return {
        total: t.length,
        inView: t.filter((el) => el.classList.contains('in-view')).length,
        opacity: t.map((el) => getComputedStyle(el).opacity),
        /* animation-delay, not transition-delay — see the note in splash.css
           on why the stagger is an animation. */
        delays: t.slice(0, 4).map((el) => getComputedStyle(el).animationDelay),
      };
    });
    ok(`${label}: all tiles revealed`, tiles.total > 0 && tiles.inView === tiles.total, `${tiles.inView}/${tiles.total}`);
    ok(`${label}: no tile stuck invisible`, tiles.opacity.every((o) => Number(o) > 0.9), tiles.opacity.join(','));
    ok(`${label}: tiles carry staggered delays`, new Set(tiles.delays).size > 1, tiles.delays.join(' | '));

    await page.close();
  }

  // ── Scrolling the curtain up must not fight the native scroll ─────────
  /*
    The reported "jumps around on the screen", reproduced 100% of the time by
    scrolling instead of pressing the button.

    The document used to stay natively scrollable behind the splash, so a
    scroll gesture did two things at once — scrolled the page AND triggered
    the lift. Both move content upward, so it travelled at double speed and
    then snapped. Compounding it, the `transitionend` listener on #app-wrapper
    had no target check, and since transitionend BUBBLES it was being ended
    early by a descendant's transform (the hero copy, a card, a tile).

    Asserting the end state alone would pass against both bugs — the page
    still finished at the right offset. So this measures the two things that
    were actually wrong: the scroll must not move while the curtain lifts, and
    the transform must run its full travel instead of being cut short.
  */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));

    ok(
      'scroll-trigger: page is scroll-locked while armed',
      (await page.evaluate(() => getComputedStyle(document.documentElement).overflow)) === 'hidden',
    );

    await page.evaluate(() => {
      window.__t = [];
      let n = 0;
      const tick = () => {
        const w = document.getElementById('app-wrapper');
        const m = new DOMMatrixReadOnly(getComputedStyle(w).transform);
        window.__t.push([Math.round(window.scrollY), Math.round(m.m42)]);
        if ((n += 1) < 90) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.mouse.move(195, 500);
    await page.mouse.wheel({ deltaY: 90 });
    await new Promise((r) => setTimeout(r, 1800));

    const t = await page.evaluate(() => window.__t);
    const heroH = await page.evaluate(() => Math.round(document.querySelector('.hero').offsetHeight));

    /* While the wrapper is still translated, the document must not have
       moved — that co-motion is the whole defect. */
    const scrollDuringLift = t.filter(([, ty]) => ty < -8).map(([sy]) => sy);
    ok(
      'scroll-trigger: document does not scroll while the curtain moves',
      scrollDuringLift.every((sy) => sy === 0),
      `saw scrollY ${[...new Set(scrollDuringLift)].join(',')} mid-lift`,
    );

    /* The curtain must actually travel the full distance. Cut short by a
       bubbled transitionend it only reached about a fifth of it. */
    const deepest = Math.min(...t.map(([, ty]) => ty));
    ok(
      'scroll-trigger: curtain completes its full travel',
      deepest <= -(heroH * 0.9),
      `deepest translateY ${deepest}px of ${-heroH}px`,
    );

    ok(
      'scroll-trigger: lands on the content',
      Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - heroH) <= 2,
    );
    await page.close();
  }

  // ── The CTA must still work once the splash is dismissed ──────────────
  /*
    Reported: dismiss the splash, scroll back to the top so the navbar is
    showing, press "Explore The HQ" — nothing happens.

    The handler used to bail out when not armed and leave it to the anchor,
    whose href was `#page-content` — a wrapper that starts at offset 0. So the
    button "scrolled" to where the reader already was. The href now points at
    the first section BELOW the hero, and the handler scrolls there itself.

    Note this cannot be caught by testing the armed path: that one always
    worked. The bug only existed in the state the button is in for the rest of
    the session.
  */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));

    ok(
      'dismissed CTA: href points below the hero, not at the page wrapper',
      (await page.evaluate(() =>
        document.querySelector('[data-splash-trigger]').getAttribute('href')
      )) === '#hq-content',
    );
    ok(
      'dismissed CTA: that target exists and is below the fold',
      await page.evaluate(() => {
        const el = document.getElementById('hq-content');
        return !!el && el.getBoundingClientRect().top + window.scrollY > 100;
      }),
    );

    // Dismiss, then return to the top the way a reader would.
    await page.evaluate(() => document.querySelector('[data-splash-trigger]').click());
    await new Promise((r) => setTimeout(r, 1600));
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 400));

    const state = await page.evaluate(() => ({
      armed: document.documentElement.classList.contains('splash-armed'),
      navVisible: getComputedStyle(document.getElementById('navbar')).visibility,
    }));
    ok('dismissed CTA: splash is down and the navbar is present', state.armed === false && state.navVisible === 'visible');

    await page.evaluate(() => document.querySelector('[data-splash-trigger]').click());
    await new Promise((r) => setTimeout(r, 1400));

    const moved = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      heroH: Math.round(document.querySelector('.hero').offsetHeight),
      hash: window.location.hash,
    }));
    ok(
      'dismissed CTA: pressing it scrolls to the content',
      moved.scrollY > moved.heroH * 0.8,
      `scrollY ${moved.scrollY} vs hero ${moved.heroH}`,
    );
    ok('dismissed CTA: leaves no hash behind', moved.hash === '', moved.hash);
    await page.close();
  }

  // ── Reverse pull-down ─────────────────────────────────────────────────
  /*
    Lift the curtain, scroll back to the very top, then pull down. The splash
    must come back — otherwise the effect is one-way and the brand moment is
    gone for the rest of the session.
  */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => document.querySelector('[data-splash-trigger]').click());
    await new Promise((r) => setTimeout(r, 1400));

    ok(
      'reverse: curtain is up before the pull',
      (await page.evaluate(() => document.documentElement.classList.contains('splash-armed'))) === false,
    );

    // Back to the absolute top, which is the only place a pull-down applies.
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 200));

    /* Put the cursor over the page first — Puppeteer dispatches wheel events
       at the current mouse position, which starts at (0,0) and does not
       reliably land on the document. */
    await page.mouse.move(195, 400);

    /*
      Keep pulling until it takes, up to a bound.

      The gesture is deliberately threshold-based (140px accumulated, reset
      after 220ms idle) so a single stray trackpad notch cannot fire it. A
      fixed number of synthetic wheel events is therefore the wrong shape for
      this test — whether it crosses the threshold depends on how many events
      land inside the idle window, which made it flaky. A real user simply
      keeps pulling, so the test does too, and the bound is what fails if the
      gesture is genuinely broken.
    */
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.wheel({ deltaY: -60 });
      await new Promise((r) => setTimeout(r, 25));
      const armed = await page.evaluate(() =>
        document.documentElement.classList.contains('splash-armed')
      );
      if (armed) break;
    }
    await new Promise((r) => setTimeout(r, 1400));

    const back = await page.evaluate(() => ({
      armed: document.documentElement.classList.contains('splash-armed'),
      dropping: document.documentElement.classList.contains('splash-dropping'),
      scrollY: Math.round(window.scrollY),
      transform: getComputedStyle(document.getElementById('app-wrapper')).transform,
      navVisible: getComputedStyle(document.getElementById('navbar')).visibility,
    }));
    ok('reverse: pull-down re-arms the splash', back.armed === true);
    ok('reverse: drop animation finished', back.dropping === false);
    ok('reverse: back at the top', back.scrollY === 0, String(back.scrollY));
    ok(
      'reverse: wrapper transform released again',
      back.transform === 'none' || back.transform === 'matrix(1, 0, 0, 1, 0, 0)',
      back.transform,
    );
    ok('reverse: navbar hidden again', back.navVisible === 'hidden', back.navVisible);
    await page.close();
  }

  // ── The pulse must not bleed outside the button ───────────────────────
  /*
    A hard constraint, so it is measured in PIXELS rather than inferred from
    the CSS. The animation is frozen at full opacity first, so this is the
    worst case rather than whatever frame the screenshot happened to catch.

    `maxDelta` is red minus the larger of green/blue — a colour-cast measure.
    The hero background is a dark neutral, so any red glow spilling onto it
    shows up as a positive delta immediately.
  */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await page.addStyleTag({
      content: '.hero-cta::after{animation:none!important;opacity:1!important}',
    });
    await new Promise((r) => setTimeout(r, 400));

    const box = await page.evaluate(() => {
      const r = document.querySelector('.hero-cta').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const shot = await page.screenshot();
    const sharp = (await import('sharp')).default;
    const img = sharp(shot);
    const D = 2;

    const cast = async (px, py, w, h) => {
      const { data } = await img
        .clone()
        .extract({ left: Math.round(px * D), top: Math.round(py * D), width: Math.round(w * D), height: Math.round(h * D) })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let max = 0;
      for (let i = 0; i < data.length; i += 3) {
        const d = data[i] - Math.max(data[i + 1], data[i + 2]);
        if (d > max) max = d;
      }
      return max;
    };

    const inside = await cast(box.x + 4, box.y + 2, box.w - 8, box.h - 4);
    ok('pulse: glow is actually visible inside the button', inside > 30, `red cast ${inside}`);

    const PAD = 14;
    for (const [side, x, y, w, h] of [
      ['left', box.x - PAD, box.y, PAD - 2, box.h],
      ['right', box.x + box.w + 2, box.y, PAD - 2, box.h],
      ['above', box.x, box.y - PAD, box.w, PAD - 2],
      ['below', box.x, box.y + box.h + 2, box.w, PAD - 2],
    ]) {
      const spill = await cast(x, y, w, h);
      ok(`pulse: no bleed ${side} of the button`, spill <= 4, `red cast ${spill}`);
    }
    await page.close();
  }

  // ── Must NOT arm off the homepage ─────────────────────────────────────
  const feed = await browser.newPage();
  await feed.setViewport({ width: 390, height: 844 });
  await feed.goto(`http://localhost:${port}/feed`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));
  const interior = await feed.evaluate(() => ({
    armed: document.documentElement.classList.contains('splash-armed'),
    navVisible: getComputedStyle(document.getElementById('navbar')).visibility,
  }));
  ok('interior page never arms the splash', interior.armed === false);
  ok('interior page keeps its navbar', interior.navVisible === 'visible', interior.navVisible);
  await feed.close();

  // ── Reduced motion: instant, never stuck ──────────────────────────────
  const rm = await browser.newPage();
  await rm.setViewport({ width: 390, height: 844 });
  await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await rm.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));
  await rm.evaluate(() => document.querySelector('[data-splash-trigger]').click());
  await new Promise((r) => setTimeout(r, 250)); // Far less than the 900ms curve.
  const rmAfter = await rm.evaluate(() => ({
    armed: document.documentElement.classList.contains('splash-armed'),
    scrollY: Math.round(window.scrollY),
    heroH: Math.round(document.querySelector('.hero').offsetHeight),
    tilesVisible: [...document.querySelectorAll('.cat-stagger')].every(
      (el) => Number(getComputedStyle(el).opacity) > 0.9
    ),
  }));
  ok('reduced motion: lift is immediate', rmAfter.armed === false && Math.abs(rmAfter.scrollY - rmAfter.heroH) <= 2,
    `scrollY=${rmAfter.scrollY} heroH=${rmAfter.heroH}`);
  ok('reduced motion: tiles are simply present', rmAfter.tilesVisible === true);
  await rm.close();
} finally {
  await browser.close();
  server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED, ${passed} passed.`);
  process.exit(1);
}
console.log(`All ${passed} tests passed.`);
