const puppeteer = require('puppeteer');

(async () => {
  let hasFailed = false;
  try {
    console.log("Starting overscroll and scroll-lock test...");
    const browser = await puppeteer.launch({ headless: 'new' });

    async function runTest(viewport, isMobile) {
      console.log(`\nTesting viewport: ${viewport.width}x${viewport.height} (Mobile/Touch: ${isMobile})`);
      const page = await browser.newPage();
      if (isMobile) {
        await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
      } else {
        await page.setViewport(viewport);
      }

      await page.goto('http://localhost:4321/');

      console.log('Page loaded. Triggering "Enter the HQ" button...');
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button'));
        const target = links.find(el => el.textContent.includes('Enter') || el.textContent.includes('Explore'));
        if (target) {
          target.scrollIntoView();
          target.click();
        } else {
          window.scrollBy(0, 1000);
        }
      });

      // Wait for animations
      await new Promise(r => setTimeout(r, 1000));

      console.log('Force rapid scroll to top (scrollY = 0)...');
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      // Wait a moment for observers to trigger
      await new Promise(r => setTimeout(r, 500));

      console.log('Attempting to trigger overscroll behavior...');
      if (isMobile) {
        await page.mouse.move(200, 200);
        await page.mouse.down();
        await page.mouse.move(200, 500, {steps: 10}); // pull down
        await page.mouse.up();
      } else {
        await page.mouse.wheel({ deltaY: -500 });
      }

      await new Promise(r => setTimeout(r, 500));

      // Diagnostics
      const diagnostics = await page.evaluate(() => {
        return {
          bodyOverflow: window.getComputedStyle(document.body).overflow,
          bodyBgColor: window.getComputedStyle(document.body).backgroundColor,
          htmlBgColor: window.getComputedStyle(document.documentElement).backgroundColor,
          htmlOverscroll: window.getComputedStyle(document.documentElement).overscrollBehavior,
          bodyOverscroll: window.getComputedStyle(document.body).overscrollBehavior,
          scrollLock: window.__hqScrollLock ? window.__hqScrollLock.isLocked() : false,
        };
      });

      console.log(diagnostics);

      await page.close();
    }

    // Desktop
    await runTest({ width: 1920, height: 1080 }, false);
    // iPad Pro
    await runTest({ width: 1024, height: 1366 }, true);

    await browser.close();
    console.log('\nTest suite finished.');
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
