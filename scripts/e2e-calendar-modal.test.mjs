import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Calendar Modal E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // Mobile viewport
    console.log('Navigating to events page...');
    await page.goto('http://localhost:4321/events');

    await page.waitForSelector('.open-full-calendar-btn', { timeout: 5000 });
    const trigger = await page.$('.open-full-calendar-btn');
    assert.ok(trigger, 'Calendar modal trigger found');
    await trigger.click();

    const modalVisible = await page.waitForSelector('#spanning-calendar-modal', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Calendar modal should become visible');

    console.log('Closing modal via ESC...');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 500));

    const afterEscape = await page.evaluate(() => ({
      open: document.getElementById('spanning-calendar-modal').open,
      bodyPosition: document.body.style.position,
    }));
    assert.equal(afterEscape.open, false, 'Calendar modal should be closed after ESC key');
    /*
      Escape closes a <dialog> natively — no click, so no close-button handler
      runs. While the scroll-lock release was bound to that button, this path
      left <body> at position:fixed and the page frozen behind the dismissed
      modal. The release now hangs off the dialog's own `close` event.
    */
    assert.equal(afterEscape.bodyPosition, '', 'ESC must also release the body scroll lock');

    /*
      ─── COLD-LOAD REGRESSION ────────────────────────────────────────────────

      The wiring for this button used to live inside an `astro:page-load`
      callback. On an initial pageview Astro's ClientRouter fires that event
      from the window `load` event, which waits for EVERY subresource. On a
      cold cache that is seconds of a painted, tappable, completely dead
      button — reported from production on iOS Safari, and gone after a
      refresh because the second load is served from cache.

      This reproduces it deterministically: hold the remote images open so
      `load` can never fire, then click. `waitUntil: 'domcontentloaded'`
      matters as much as the stalling — the default `goto` waits for `load`
      itself, which is exactly why the assertion above never caught this.
    */
    console.log('Cold-load: modal must open before the window load event...');
    const cold = await browser.newPage();
    await cold.setViewport({ width: 375, height: 812 });
    await cold.setRequestInterception(true);
    const stalled = [];
    cold.on('request', (req) => {
      // Never resolved and never aborted: the request stays in flight, so the
      // document stays in its loading state for the duration of the test.
      if (req.resourceType() === 'image') stalled.push(req);
      else req.continue().catch(() => {});
    });

    await cold.goto('http://localhost:4321/events', { waitUntil: 'domcontentloaded' });
    await cold.waitForSelector('.open-full-calendar-btn', { timeout: 5000 });

    const loadFired = await cold.evaluate(() => document.readyState === 'complete');
    assert.equal(loadFired, false, 'Precondition: the window load event must NOT have fired yet');

    await cold.click('.open-full-calendar-btn');
    await cold.waitForSelector('#spanning-calendar-modal[open]', { timeout: 3000 });
    console.log('  ✓ opened with the document still loading');

    for (const req of stalled) req.abort().catch(() => {});
    await cold.close();

    console.log('✅ Calendar Modal E2E tests passed.');
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
