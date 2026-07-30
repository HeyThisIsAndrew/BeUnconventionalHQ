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
    await new Promise(r => setTimeout(r, 500));
    
    const isHidden = await page.evaluate(() => {
      const modal = document.getElementById('spanning-calendar-modal');
      return !modal.classList.contains('active');
    });
    assert.ok(isHidden, 'Calendar modal should be hidden after ESC key');

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
