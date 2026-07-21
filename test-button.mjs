import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:4321/events');
  
  // Try clicking the get in touch button
  const button = await page.$('.cta-button-primary');
  if (button) {
    console.log("Button found! Clicking...");
    await button.click();
    
    // Wait a bit
    await new Promise(r => setTimeout(r, 1000));
    
    // Check if modal has is-active class
    const modalClasses = await page.$eval('#contact-modal', el => Array.from(el.classList));
    console.log("Modal classes:", modalClasses);
  } else {
    console.log("Button not found!");
  }
  
  await browser.close();
})();
