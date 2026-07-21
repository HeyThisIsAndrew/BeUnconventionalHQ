import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://127.0.0.1:4321/events');
  
  const button = await page.$('.cta-button-primary');
  if (button) {
    console.log("Button found! Clicking...");
    await button.click();
    
    await new Promise(r => setTimeout(r, 1000));
    
    try {
      const modalClasses = await page.$eval('#contact-modal', el => Array.from(el.classList));
      console.log("Modal classes:", modalClasses);
    } catch(e) {
      console.log("Could not get modal classes:", e.message);
    }
  } else {
    console.log("Button not found!");
  }
  
  await browser.close();
})();
