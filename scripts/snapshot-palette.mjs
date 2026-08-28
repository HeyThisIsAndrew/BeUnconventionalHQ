import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:4321', { waitUntil: 'networkidle2' });
  
  // Click the search button instead of Cmd+K (in case it's easier to trigger)
  await page.evaluate(() => {
    document.querySelector('.nav-search-btn').click();
  });
  
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '.visual-parity/command-palette.png' });
  await browser.close();
})();
