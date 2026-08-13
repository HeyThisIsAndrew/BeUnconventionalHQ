/*
  FIXED CONTROLS MUST SURVIVE THE BROWSER RESIZING THE WEB VIEW.

  THE REPORT
  iPhone, iOS Safari, landscape: the hamburger and the X are difficult to
  press — "at the moment that I closed all the tabs, it stopped happening."

  With more than one tab open, Safari on iPhone shows a tab bar in landscape,
  and that tab bar collapses as you scroll down and expands as you scroll up.
  Every collapse resizes the web view. iOS Safari does not reliably re-hit-test
  `position: fixed` elements afterwards: they are painted in the right place
  and their touch region is left behind. One tab means no tab bar, nothing
  resizes, and the buttons behave — which is the whole diagnosis.

  WHAT THIS CAN TEST, AND WHAT IT CANNOT
  Chromium hit-tests fixed elements correctly, so the stale region itself is
  not reproducible here and testing the symptom is not on offer. What IS
  checkable — and what would have caught this being deleted or silently
  broken — is that the correction is bound to the right signal, runs when that
  signal fires, and moves nothing when it does.

  That last part is the real risk in the fix. It works by writing each
  control's own computed `top` back onto it and reading layout, to force the
  engine to re-resolve the box. Get that wrong and you have shifted every
  fixed control on the site by a few pixels, or stamped an inline style over a
  stylesheet value, on every scroll. So this asserts positions are IDENTICAL
  across the event, and that no inline `top` is left behind.
*/
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

const VIEWPORTS = [
  { width: 956, height: 440, label: 'iPhone 17 Pro Max landscape' },
  { width: 390, height: 844, label: 'iPhone portrait' },
];

/* Routes chosen for what they mount: / has the navbar and the video modal,
   /feed adds the category overlay's close button. */
const ROUTES = ['/', '/feed'];

const CONTROLS = ['#navbar', '.nav-toggle', '.modal-close', '.close-fullscreen-btn'];

async function runTests() {
  console.log('Starting Astro preview server for Viewport Anchor E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;
  let passed = 0;

  try {
    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const page = await browser.newPage();
        await page.setViewport({ ...vp, hasTouch: true, isMobile: true });
        await page.goto(`http://localhost:4321${route}`, { waitUntil: 'networkidle2' });

        const result = await page.evaluate(async (CONTROLS) => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const root = document.documentElement;
          root.classList.remove('splash-armed', 'splash-lifting', 'splash-dropping');
          window.__hqScrollLock?.release?.();
          await wait(200);

          const snapshot = () => {
            const out = {};
            for (const sel of CONTROLS) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              out[sel] = {
                rect: `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`,
                inlineTop: el.style.top,
              };
            }
            return out;
          };

          const before = snapshot();

          /* The signal Safari sends when its chrome collapses. Nothing else on
             the page listens for it, so if the anchor is unbound this fires
             into the void and --vv-top never appears. */
          window.visualViewport?.dispatchEvent(new Event('resize'));
          await new Promise((r) => requestAnimationFrame(r));
          await new Promise((r) => requestAnimationFrame(r));

          const after = snapshot();

          return {
            before,
            after,
            vvTop: root.style.getPropertyValue('--vv-top'),
            present: Object.keys(before),
          };
        }, CONTROLS);

        assert.notEqual(
          result.vvTop,
          '',
          `${vp.label} ${route}: --vv-top was never published, so the visual-viewport ` +
            `anchor is not bound. keepFixedControlsTappable() must run from Layout.astro ` +
            `— without it, iOS keeps the stale touch regions that made the navbar ` +
            `and the X unpressable with multiple tabs open.`
        );

        for (const sel of result.present) {
          assert.equal(
            result.after[sel].rect,
            result.before[sel].rect,
            `${vp.label} ${route}: ${sel} MOVED across the viewport-resize correction ` +
              `(${result.before[sel].rect} -> ${result.after[sel].rect}). The correction ` +
              `must re-resolve the box without changing it.`
          );
          assert.equal(
            result.after[sel].inlineTop,
            result.before[sel].inlineTop,
            `${vp.label} ${route}: ${sel} was left with an inline top of ` +
              `"${result.after[sel].inlineTop}". The nudge must restore the previous ` +
              `inline value, or it will shadow the stylesheet on every scroll.`
          );
        }

        console.log(
          `  ✓ ${vp.label} ${route}: anchor bound (--vv-top ${result.vvTop}), ` +
            `${result.present.length} control(s) unmoved`
        );
        passed++;
        await page.close();
      }
    }

    console.log(`\n✅ Viewport Anchor E2E tests passed (${passed} checks).`);
  } catch (error) {
    console.error('\n❌ Viewport Anchor E2E failed:', error.message);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}

runTests();
