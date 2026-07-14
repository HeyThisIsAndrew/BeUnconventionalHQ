const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Emulate mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:4321/events-new/sdcc-2026', { waitUntil: 'networkidle0' });
  
  // Wait for iframe
  await page.waitForSelector('#hero-trailer-iframe', { timeout: 5000 }).catch(() => console.log('Iframe not found!'));
  
  // Check iframe size and visibility
  const iframeBox = await page.$eval('#hero-trailer-iframe', el => {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      display: computed.display, visibility: computed.visibility,
      pointerEvents: computed.pointerEvents, zIndex: computed.zIndex
    };
  });
  console.log('Iframe box:', iframeBox);
  
  // Check if anything is overlaying the iframe
  const overlayBox = await page.$eval('.trailer-poster-overlay', el => {
    const computed = window.getComputedStyle(el);
    return { display: computed.display };
  });
  console.log('Overlay display:', overlayBox.display);
  
  await browser.close();
})();
