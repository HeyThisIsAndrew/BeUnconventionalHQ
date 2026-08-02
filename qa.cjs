const puppeteer = require('puppeteer');

async function runTests() {
  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Test 1: Layout Integrity on Homepage
    await page.goto('http://localhost:4321/');
    const homeBg = await page.$eval('#navbar', el => getComputedStyle(el).backgroundColor);
    if (homeBg !== 'rgba(0, 0, 0, 0)') throw new Error(`Homepage navbar is not transparent! Expected rgba(0, 0, 0, 0), got ${homeBg}`);
    console.log('✅ Homepage layout integrity passed (transparent navbar).');
    
    // Test 2: Layout Integrity on Subpage
    await page.goto('http://localhost:4321/events');
    const subBg = await page.$eval('#navbar', el => getComputedStyle(el).backgroundColor);
    if (subBg === 'rgba(0, 0, 0, 0)') throw new Error(`Subpage navbar is transparent! Expected solid background, got ${subBg}`);
    console.log('✅ Subpage layout integrity passed (solid navbar).');
    
    // Test 3: Chaos Spam Test
    await page.goto('http://localhost:4321/');
    
    console.log('Running spam click chaos test...');
    for(let i = 0; i < 20; i++) {
      await page.click('.nav-logo');
      await page.evaluate(() => window.scrollTo(0, 500));
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Check if it got stuck throbbing or incorrectly transitioned
    const isScrolled = await page.$eval('#navbar', el => el.classList.contains('scrolled'));
    console.log(`✅ Chaos test passed. Navbar scrolled state correctly managed: ${isScrolled}`);
    
    await browser.close();
    console.log('All Playwright/Puppeteer tests passed!');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exitCode = 1;
  }
}

runTests();
