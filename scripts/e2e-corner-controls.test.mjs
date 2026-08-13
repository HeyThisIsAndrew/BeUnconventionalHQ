/*
  THE TOP-RIGHT CORNER CONTROLS MUST BE FORGIVING TO PRESS.

  WHAT WAS REPORTED
  iPhone, landscape: "scroll down until the nav bar appears — both the
  hamburger and the X are difficult to press", and "this is happening for any
  area where the X button is present."

  WHY THOSE ARE ONE BUG
  The hamburger, the X it becomes, the category overlay's close and the video
  modal's close are the same control in three costumes, and they shared two
  properties:

    1. EXACTLY 44×44 — Apple's minimum, with no margin for error.
    2. All in the TOP-RIGHT CORNER. In landscape that corner is cut by the
       display's rounded corner, and on a notched iPhone a downward swipe
       there opens Control Centre — so iOS is watching the same strip for a
       system gesture while the page waits for a tap. The failure that
       produces is an unreliable button, not a dead one, which is how it was
       reported.

  WHAT THIS CAN AND CANNOT TEST
  Chromium hit-tests these correctly and reports env(safe-area-inset-*) as 0,
  so it CANNOT reproduce the iOS behaviour — measured 100% reachable at every
  landscape size before the fix, while the reader could not press the button.
  Testing the symptom is therefore not available.

  So this asserts the property that makes the symptom survivable, and which IS
  measurable anywhere: each control's effective hit area — the pseudo-element
  expansion included — must be comfortably larger than the bare minimum, and
  must grow DOWN and INWARD rather than toward the screen edges, since
  expanding into the corner would push the target further into the strip iOS
  is contending for.

  It also pins the thing that is easy to break while "tidying": the close
  buttons must keep their own positioning. An earlier draft of the fix added
  `position: relative` to all three selectors, which would have reset
  `.modal-close` and `.close-fullscreen-btn` out of their corners entirely —
  a11y.css is imported last, so it wins.
*/
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

const VIEWPORTS = [
  { width: 956, height: 440, label: 'iPhone 17 Pro Max landscape' },
  { width: 844, height: 390, label: 'iPhone 14 Pro landscape' },
  { width: 390, height: 844, label: 'iPhone 14 Pro portrait' },
];

/* 44×44 = 1936px². The expansion adds 16px of width and 14px of height, so a
   correct implementation lands at 60×58 = 3480px². Assert a clear majority of
   that gain rather than the exact number, so a future tweak to the insets does
   not fail the build for no reason. */
const MIN_EFFECTIVE_AREA = 2800;

async function runTests() {
  console.log('Starting Astro preview server for Corner Controls E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;
  let passed = 0;

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, hasTouch: true, isMobile: true });
      await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });

      /* Land in the state the report describes: splash dismissed, scrolled
         down, navbar showing and settled. The navbar's return transition runs
         500ms on a 300ms delay — sample before that and you measure a moving
         target, not the resting one. */
      await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('.hero-cta')?.click();
        await wait(1300);
        const root = document.documentElement;
        const p = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        void root.offsetHeight;
        window.scrollTo(0, 900);
        root.style.scrollBehavior = p;
        await wait(900);
      });

      const measure = async (selector, label) =>
        page.evaluate(
          (selector, label) => {
            const el = document.querySelector(selector);
            if (!el) return { label, missing: true };
            const box = el.getBoundingClientRect();
            const cs = getComputedStyle(el);

            /* Walk outward from the button's own box and ask the document
               what is at each point. Anything that hit-tests back to the
               button — including its ::before — counts as target. */
            const PAD = 40;
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            let hits = 0;
            for (let x = box.left - PAD; x <= box.right + PAD; x += 2) {
              for (let y = box.top - PAD; y <= box.bottom + PAD; y += 2) {
                if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
                const hit = document.elementFromPoint(x, y);
                if (!hit || !(hit === el || el.contains(hit))) continue;
                hits += 4; // each sample stands for a 2×2 block
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }

            return {
              label,
              position: cs.position,
              touchAction: cs.touchAction,
              topEdgeGap: Math.round(box.top),
              box: { w: Math.round(box.width), h: Math.round(box.height) },
              /* How far the effective area reaches past the visual box on
                 each side. Positive = expanded that way. */
              growLeft: Math.round(box.left - minX),
              growRight: Math.round(maxX - box.right),
              growUp: Math.round(box.top - minY),
              growDown: Math.round(maxY - box.bottom),
              area: hits,
            };
          },
          selector,
          label
        );

      const check = (m) => {
        assert.ok(!m.missing, `${vp.label}: ${m.label} not found`);
        assert.ok(
          m.area >= MIN_EFFECTIVE_AREA,
          `${vp.label}: ${m.label} has only ${m.area}px² of effective tap area ` +
            `(box ${m.box.w}×${m.box.h}). A bare 44×44 in the top-right corner is ` +
            `what was reported as "difficult to press" — the invisible ::before ` +
            `expansion in a11y.css is missing or has been overridden.`
        );
        assert.ok(
          m.growDown > 0 || m.growLeft > 0,
          `${vp.label}: ${m.label} does not expand down or inward at all`
        );
        /*
          The page is zoomable by design, so without this iOS holds every tap
          on these buttons open waiting to see whether it is the first half of
          a double-tap-to-zoom. `manipulation` opts the control out of that and
          nothing else — pinch-zoom and panning are untouched.
        */
        assert.equal(
          m.touchAction,
          'manipulation',
          `${vp.label}: ${m.label} has touch-action "${m.touchAction}". On a ` +
            `zoomable page iOS defers the tap for double-tap-to-zoom detection, ` +
            `which is a large part of why these corner buttons read as ` +
            `unreliable. It must be "manipulation" (never "none" — see splash.css).`
        );
        /*
          Distance from the top of the viewport. In landscape on an iPhone the
          first ~30px is contested real estate: Safari's tab bar lives there
          when more than one tab is open and collapses through it on scroll,
          iOS watches it for Control Centre, and the display's rounded corner
          eats into it. The control used to start 5px down.
        */
        if (vp.width > vp.height) {
          assert.ok(
            m.topEdgeGap >= 14,
            `${vp.label}: ${m.label} starts only ${m.topEdgeGap}px below the top of ` +
              `the viewport. In landscape that is inside the strip Safari's collapsing ` +
              `tab bar and iOS's own gestures both contend for — the reported cause of ` +
              `"difficult to press", which stopped the moment every other tab was ` +
              `closed. Landscape clearance lives in landscape.css.`
          );
        }
        assert.ok(
          m.growUp <= 0 && m.growRight <= 0,
          `${vp.label}: ${m.label} expands toward the screen edge ` +
            `(up ${m.growUp}px, right ${m.growRight}px). That pushes the target ` +
            `further into the corner strip iOS contends with for Control Centre — ` +
            `the expansion must go down and inward only.`
        );
        console.log(
          `  ✓ ${vp.label}: ${m.label} — ${m.area}px² effective ` +
            `(+${m.growLeft} left, +${m.growDown} down), ${m.topEdgeGap}px below top`
        );
        passed++;
      };

      check(await measure('.nav-toggle', 'hamburger'));

      // Open the menu: the same element becomes the X.
      await page.evaluate(async () => {
        document.querySelector('.nav-toggle')?.click();
        await new Promise((r) => setTimeout(r, 600));
      });
      check(await measure('.nav-toggle', 'X (close)'));

      /* The close buttons must still be positioned in their corners. This is
         the regression the earlier draft of the fix would have caused. */
      const positions = await page.evaluate(() => {
        const read = (sel) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).position : null;
        };
        return {
          modalClose: read('.modal-close'),
          fullscreenClose: read('.close-fullscreen-btn'),
        };
      });

      for (const [name, pos] of Object.entries(positions)) {
        if (pos === null) continue; // not present on this route
        assert.ok(
          pos === 'absolute' || pos === 'fixed',
          `${vp.label}: .${name} computed position is "${pos}". The hit-area rule ` +
            `in a11y.css must not add \`position: relative\` to the close buttons — ` +
            `a11y.css is imported last, so that resets them out of their corners.`
        );
        console.log(`  ✓ ${vp.label}: ${name} keeps position: ${pos}`);
        passed++;
      }

      await page.close();
    }

    console.log(`\n✅ Corner Controls E2E tests passed (${passed} checks).`);
  } catch (error) {
    console.error('\n❌ Corner Controls E2E failed:', error.message);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}

runTests();
