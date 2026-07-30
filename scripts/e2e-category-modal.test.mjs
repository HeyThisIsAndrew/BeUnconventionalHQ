import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Category Modal E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // Mobile viewport
    console.log('Navigating to feed page...');
    await page.goto('http://localhost:4321/feed');
    
    await page.waitForSelector('#open-categories-btn', { timeout: 5000 });
    const trigger = await page.$('#open-categories-btn');
    assert.ok(trigger, 'Mobile filter trigger found');
    await trigger.click();

    const modalVisible = await page.waitForSelector('#category-fullscreen-overlay', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Category overlay should become visible');

    console.log('Closing overlay via close button...');
    const closeBtn = await page.$('#category-fullscreen-overlay .close-fullscreen-btn');
    if (closeBtn) {
      await page.evaluate(el => el.click(), closeBtn);
    } else {
      console.log('No specific close button found, clicking outside or using Escape.');
      await page.keyboard.press('Escape');
    }
    console.log('Waiting for overlay to hide...');
    const isHidden = await page.waitForFunction(() => {
      const modal = document.getElementById('category-fullscreen-overlay');
      return !modal || !modal.classList.contains('is-open');
    }, { timeout: 5000 });
    assert.ok(isHidden, 'Category overlay should be hidden after closing');

    /*
      REGRESSION GUARD: the overlay must actually cover the viewport.

      A `position: fixed` element resolves against the viewport ONLY when no
      ancestor has a transform, filter, perspective or containment. The Feed's
      filter wrapper once carried `.animate-on-scroll`, which sets both a
      transform and a filter — so the overlay became a 326x844 box offset
      230px down the page with its category buttons scrolled out of sight.
      Every assertion above still passed: the element existed, it was
      "visible", and it opened and closed correctly. Only its BOX was wrong.

      So measure the box, on both surfaces that share the component.
    */
    for (const route of ['/feed', '/intel']) {
      await page.goto(`http://localhost:4321${route}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#open-categories-btn', { timeout: 5000 });
      await page.click('#open-categories-btn');
      await new Promise((r) => setTimeout(r, 400));

      const box = await page.evaluate(() => {
        const overlay = document.getElementById('category-fullscreen-overlay');
        const rect = overlay.getBoundingClientRect();
        const buttons = [...overlay.querySelectorAll('.cat-btn')];
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          buttonCount: buttons.length,
          // Every category button must sit inside the viewport, not below it.
          allOnScreen: buttons.every((b) => {
            const r = b.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0;
          }),
        };
      });

      assert.equal(box.x, 0, `${route}: overlay must start at the left viewport edge`);
      assert.equal(box.y, 0, `${route}: overlay must start at the top viewport edge`);
      assert.equal(box.width, box.viewportW, `${route}: overlay must span the viewport width`);
      assert.equal(box.height, box.viewportH, `${route}: overlay must span the viewport height`);
      assert.equal(box.buttonCount, 4, `${route}: all four categories must render`);
      assert.ok(box.allOnScreen, `${route}: every category button must be on screen`);
      console.log(`  ✓ ${route}: overlay fills the viewport with ${box.buttonCount} categories`);
    }

    console.log('✅ Category Modal E2E tests passed.');
  } catch (error) {
    console.error('❌ E2E Test Failed:', error);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}
runTests();
