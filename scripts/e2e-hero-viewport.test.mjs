/*
  THE HERO MUST BE THE HEIGHT THE READER ACTUALLY HAS.

  THE REPORT
  "Load the homepage and then rotate your phone" — the hero comes back the
  wrong height in landscape: its centred content sits out of position and the
  next section's header shows underneath.

  WHY NO VIEWPORT UNIT FIXES THIS
  Every static unit is a guess about the browser chrome, and each is wrong in
  one of its two states. Both were tried on the device and both were
  photographed failing:

    100svh — smallest, chrome expanded. Arrive with the chrome RETRACTED
             (after scrolling on the previous page, or after a rotation) and
             the hero is shorter than the screen; "EXPLORE THE HQ / WHAT WE
             COVER" shows under it.
    100lvh — largest, chrome retracted. Arrive with the chrome EXPANDED and
             the hero is taller than the screen; the flex-centred content is
             pushed down out of position.
    100dvh — always correct, but re-resolves during scroll, resizing the hero
             and re-rasterizing the blurred .hero-bg. That is the jitter
             hero.css rejects at length.

  So the hero is MEASURED. `--vv-height` is the real `visualViewport.height`:
  seeded inline in Layout.astro before first paint, republished by
  src/lib/viewport-anchor.ts once a rotation settles, and never touched on
  scroll — constant per orientation like svh/lvh, but the right constant.

  WHAT THIS TESTS, AND ITS ONE LIMIT
  Chromium's visualViewport.height always equals innerHeight because it has no
  retracting chrome, so the svh-vs-lvh divergence itself is not reproducible
  here — that is exactly why the unit was got wrong twice. What IS checkable,
  and is the whole contract, is: the value is published before the hero could
  paint, the hero exactly fills the viewport, a rotation republishes it and
  the hero exactly fills the NEW viewport, and a burst of chrome-collapse
  events resizes the hero zero times.
*/
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

const PORTRAIT = { width: 390, height: 844, hasTouch: true, isMobile: true };
const LANDSCAPE = { width: 844, height: 390, hasTouch: true, isMobile: true };

async function measure(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const r = hero.getBoundingClientRect();
    return {
      vh: window.innerHeight,
      heroHeight: Math.round(r.height),
      heroBottom: Math.round(r.bottom),
      heroTop: Math.round(r.top),
      vvHeight: document.documentElement.style.getPropertyValue('--vv-height'),
    };
  });
}

async function runTests() {
  console.log('Starting Astro preview server for Hero Viewport E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;
  let passed = 0;
  const pass = (msg) => {
    console.log(`  ✓ ${msg}`);
    passed++;
  };

  try {
    /* ─── 1. PUBLISHED BEFORE THE HERO COULD PAINT ────────────────────────── */
    {
      const page = await browser.newPage();
      await page.setViewport(LANDSCAPE);
      /* `domcontentloaded`, not networkidle2: the point is that the value is
         there from the inline script, without waiting for modules. */
      await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
      const vv = await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--vv-height')
      );
      assert.notEqual(
        vv,
        '',
        '--vv-height was not set at DOMContentLoaded. It is seeded by an inline ' +
          'script in Layout.astro precisely so the hero never paints once at the ' +
          'fallback height and then resizes. If it only appears later, that ' +
          'inline seed has been removed or deferred.'
      );
      pass(`--vv-height is seeded before modules load (${vv})`);
      await page.close();
    }

    /* ─── 2. THE REPORTED REPRO: LOAD, THEN ROTATE ────────────────────────── */
    {
      const page = await browser.newPage();
      await page.setViewport(PORTRAIT);
      await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 900));

      const before = await measure(page);
      assert.equal(
        before.heroBottom,
        before.vh,
        `On load in portrait the hero ends at ${before.heroBottom} but the ` +
          `viewport is ${before.vh} tall.`
      );

      await page.setViewport(LANDSCAPE);
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      /* Past the 600ms settle — a rotation is animated, so an early read is a
         layout still in motion. */
      await new Promise((r) => setTimeout(r, 900));

      const after = await measure(page);

      assert.equal(
        after.vvHeight,
        `${after.vh}px`,
        `After rotating, --vv-height is "${after.vvHeight}" but the viewport is ` +
          `${after.vh}px. viewport-anchor.ts must republish it once the rotation ` +
          `settles, or the hero keeps a height belonging to the orientation it ` +
          `no longer has — which is the reported bug: "load the homepage and ` +
          `then rotate your phone".`
      );

      assert.equal(
        after.heroBottom,
        after.vh,
        `After rotating to landscape the hero ends at ${after.heroBottom} but ` +
          `the viewport is ${after.vh} tall — ` +
          `${after.heroBottom < after.vh
            ? `a ${after.vh - after.heroBottom}px gap, so the next section shows underneath`
            : `${after.heroBottom - after.vh}px of overflow, so the centred content is pushed down`}.`
      );
      pass(`rotation portrait -> landscape: hero fills exactly (${after.heroHeight}px)`);
      await page.close();
    }

    /* ─── 3. AND BACK, SO IT IS NOT ONE-WAY ───────────────────────────────── */
    {
      const page = await browser.newPage();
      await page.setViewport(LANDSCAPE);
      await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 900));

      for (const [label, vp] of [
        ['portrait', PORTRAIT],
        ['landscape', LANDSCAPE],
      ]) {
        await page.setViewport(vp);
        await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
        await new Promise((r) => setTimeout(r, 900));
        const m = await measure(page);
        assert.equal(
          m.heroBottom,
          m.vh,
          `Rotating to ${label}: hero ends at ${m.heroBottom}, viewport is ${m.vh}.`
        );
      }
      pass('rotating back and forth keeps the hero exact in both orientations');
      await page.close();
    }

    /*
      ─── 4. A *SIMULATED* CHROME COLLAPSE — THE ONLY HONEST WAY TO TEST THIS ─

      An earlier version of this block just dispatched visualViewport events
      and asserted the hero did not resize. It passed — and it also passed
      when the fix was deliberately broken to republish on every scroll,
      because Chromium's `visualViewport.height` never actually moves, so the
      republish wrote the SAME number and nothing resized. A guard that cannot
      fail is not a guard.

      So the collapse is simulated properly: `visualViewport.height` is
      overridden to report a shorter viewport, exactly as iOS does when its
      chrome retracts, and THEN the events are fired. Now the two behaviours
      are distinguishable — republishing on scroll changes `--vv-height` and
      resizes the hero; republishing on rotation only does not.
    */
    {
      const page = await browser.newPage();
      await page.setViewport(LANDSCAPE);
      await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 900));

      const before = await measure(page);

      const result = await page.evaluate(async () => {
        const vv = window.visualViewport;
        const real = vv.height;
        /* iOS reports a SHORTER visual viewport while the chrome overlays. */
        Object.defineProperty(vv, 'height', {
          configurable: true,
          get: () => real - 60,
        });

        const hero = document.querySelector('.hero');
        let resizes = 0;
        let last = hero.getBoundingClientRect().height;
        for (let i = 0; i < 25; i++) {
          vv.dispatchEvent(new Event('scroll'));
          vv.dispatchEvent(new Event('resize'));
          await new Promise((r) => requestAnimationFrame(r));
          const h = hero.getBoundingClientRect().height;
          if (h !== last) resizes++;
          last = h;
        }

        const afterScroll = document.documentElement.style.getPropertyValue('--vv-height');

        /* Now rotate with the same override in place: the value MUST follow. */
        window.dispatchEvent(new Event('orientationchange'));
        await new Promise((r) => setTimeout(r, 900));
        const afterRotate = document.documentElement.style.getPropertyValue('--vv-height');

        delete vv.height;
        return { resizes, afterScroll, afterRotate, expectedAfterRotate: `${Math.round(real - 60)}px` };
      });

      assert.equal(
        result.resizes,
        0,
        `The hero resized ${result.resizes} time(s) across 25 chrome-collapse ` +
          `events (visualViewport.height reporting 60px shorter). Resizing the ` +
          `hero on those re-rasterizes the blurred .hero-bg — the exact jitter ` +
          `100dvh was rejected for, reintroduced by hand. --vv-height must be ` +
          `republished on rotation ONLY.`
      );
      assert.equal(
        result.afterScroll,
        before.vvHeight,
        `--vv-height changed from "${before.vvHeight}" to "${result.afterScroll}" ` +
          `during a chrome collapse. It must stay constant per orientation.`
      );
      pass('a simulated chrome collapse resizes the hero 0 times (no jitter)');

      assert.equal(
        result.afterRotate,
        result.expectedAfterRotate,
        `After a rotation --vv-height is "${result.afterRotate}" but the visual ` +
          `viewport reports "${result.expectedAfterRotate}". The value must ` +
          `follow a rotation even though it ignores a scroll — that asymmetry ` +
          `IS the fix, and this asserts both halves of it.`
      );
      pass('...but a rotation still republishes it (both halves of the asymmetry)');
      await page.close();
    }

    console.log(`\n✅ Hero Viewport E2E tests passed (${passed} checks).`);
  } catch (error) {
    console.error('\n❌ Hero Viewport E2E failed:', error.message);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}

runTests();
