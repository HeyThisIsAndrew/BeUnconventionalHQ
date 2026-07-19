import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

// Helper to start the server, wait for it to be ready, run tests, and kill it.
async function runTests() {
  console.log('Starting Astro preview server...');
  const server = spawn('npm', ['run', 'preview'], { stdio: 'pipe' });

  // Wait for the server to be ready
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (text.includes('http://localhost:4321')) {
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      console.error(data.toString());
    });
    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Server exited with code ${code}. Output: ${output}`));
    });
    // Timeout
    setTimeout(() => reject(new Error('Server start timed out')), 15000);
  });

  console.log('Server is running. Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    
    // We assume there's at least one featured slug and event slug.
    // To make it robust, we'll navigate to /events, click the first event, and test there.
    console.log('Navigating to /events to find an event detail page...');
    await page.goto('http://localhost:4321/events');
    
    const eventLink = await page.$('a.video-card-home');
    if (!eventLink) {
      console.log('⚠️ No events found to test. Skipping event filter tests.');
    } else {
      const eventHref = await page.evaluate(el => el.href, eventLink);
      console.log(`Testing event page: ${eventHref}`);
      await page.goto(eventHref);
      await testFilterInteractions(page, 'Event Detail');
    }

    console.log('Navigating to /featured to find a featured detail page...');
    await page.goto('http://localhost:4321/featured');
    
    const featuredLink = await page.$('a.video-card-home');
    if (!featuredLink) {
      console.log('⚠️ No featured collections found to test. Skipping featured filter tests.');
    } else {
      const featuredHref = await page.evaluate(el => el.href, featuredLink);
      console.log(`Testing featured page: ${featuredHref}`);
      await page.goto(featuredHref);
      await testFilterInteractions(page, 'Featured Detail');
    }

    console.log('✅ All E2E filter tests passed.');
  } catch (error) {
    console.error('❌ E2E Test Failed:', error);
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
    process.exit(exitCode);
  }
}

async function testFilterInteractions(page, contextName) {
  // Wait for hydration (astro:page-load event completes)
  await page.waitForSelector('.filter-btn', { timeout: 5000 });
  
  // Get all content cards
  const cards = await page.$$('.content-card');
  console.log(`[${contextName}] Found ${cards.length} content cards.`);

  if (cards.length === 0) {
    throw new Error(`[${contextName}] Expected to find .content-card elements, found 0.`);
  }

  // Find filter buttons
  const articleBtn = await page.$('.filter-btn[data-filter="article"]');
  const videoBtn = await page.$('.filter-btn[data-filter="video"]');
  
  assert.ok(articleBtn, `[${contextName}] Article filter button not found`);
  assert.ok(videoBtn, `[${contextName}] Video filter button not found`);

  // Test: Click Article Filter
  await articleBtn.click();
  await new Promise(r => setTimeout(r, 100)); // wait for DOM update
  
  let isArticleBtnActive = await page.evaluate(el => el.classList.contains('active'), articleBtn);
  assert.equal(isArticleBtnActive, true, `[${contextName}] Article button should be active`);
  
  // Verify visibility
  const visibleCardsAfterArticleClick = await page.$$eval('.content-card', els => 
    els.filter(el => el.style.display !== 'none').map(el => el.getAttribute('data-type'))
  );
  
  const hasInvalidArticleTypes = visibleCardsAfterArticleClick.some(t => t !== 'article');
  assert.equal(hasInvalidArticleTypes, false, `[${contextName}] Only articles should be visible`);

  // Test: Click Video Filter
  await videoBtn.click();
  await new Promise(r => setTimeout(r, 100)); // wait for DOM update
  
  let isVideoBtnActive = await page.evaluate(el => el.classList.contains('active'), videoBtn);
  assert.equal(isVideoBtnActive, true, `[${contextName}] Video button should be active`);
  
  // Verify visibility
  const visibleCardsAfterVideoClick = await page.$$eval('.content-card', els => 
    els.filter(el => el.style.display !== 'none').map(el => el.getAttribute('data-type'))
  );
  
  const hasInvalidVideoTypes = visibleCardsAfterVideoClick.some(t => t !== 'video');
  assert.equal(hasInvalidVideoTypes, false, `[${contextName}] Only videos should be visible`);

  // Click again to unfilter (all)
  await videoBtn.click();
  await new Promise(r => setTimeout(r, 100));

  isVideoBtnActive = await page.evaluate(el => el.classList.contains('active'), videoBtn);
  assert.equal(isVideoBtnActive, false, `[${contextName}] Video button should toggle off`);
  
  const visibleCardsAfterToggleOff = await page.$$eval('.content-card', els => 
    els.filter(el => el.style.display !== 'none').length
  );
  assert.equal(visibleCardsAfterToggleOff, cards.length, `[${contextName}] All cards should be visible again`);
  
  console.log(`  ✓ ${contextName} interactions verified`);
}

runTests();
