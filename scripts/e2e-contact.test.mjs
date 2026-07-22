import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Contact Modal E2E...');
  const server = spawn('npm', ['run', 'preview'], { stdio: 'pipe' });

  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (text.includes('http://localhost:')) resolve();
    });
    server.stderr.on('data', (data) => console.error(data.toString()));
    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Server exited with code ${code}`));
    });
    setTimeout(() => reject(new Error('Server start timed out')), 30000);
  });

  console.log('Server is running. Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    
    console.log('Navigating to homepage to test Contact Modal...');
    await page.goto('http://localhost:4321/');

    // The contact modal was intentionally hidden from the live UI (Footer's
    // and press-kit's [data-modal-trigger="contact"] links are commented
    // out) in favor of the Substack/YouTube subscribe CTA - no page ships a
    // visible trigger anymore. This is a regression guard: if one reappears
    // unintentionally, this test should be updated deliberately, not react
    // to a silent markup change.
    const liveTrigger = await page.$('[data-modal-trigger="contact"]');
    assert.equal(liveTrigger, null, 'No page should ship a live contact modal trigger right now - update this test if that changes');

    // The modal component and its open/close/inert logic are still intact
    // (document-level delegated click listener on [data-modal-trigger],
    // ContactModal.astro:159) - only the UI entry point was removed. Inject
    // a trigger matching what a real one would look like to exercise that
    // logic directly, rather than losing coverage of code the project still
    // ships.
    await page.evaluate(() => {
      const el = document.createElement('button');
      el.setAttribute('data-modal-trigger', 'contact');
      el.id = 'e2e-injected-contact-trigger';
      el.textContent = 'Contact (test-injected)';
      document.body.appendChild(el);
    });
    const trigger = await page.$('#e2e-injected-contact-trigger');
    assert.ok(trigger, 'Test-injected contact modal trigger should exist');

    console.log('Opening contact modal...');
    await trigger.click();

    // Verify modal is visible
    const modalVisible = await page.waitForSelector('#contact-modal', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Contact modal should become visible');

    // Verify inert lock is applied to main app
    const appWrapperInert = await page.evaluate(() => {
      const wrapper = document.getElementById('app-wrapper');
      return wrapper ? wrapper.hasAttribute('inert') : false;
    });
    assert.ok(appWrapperInert, '#app-wrapper should have inert attribute for accessibility');

    // Verify form exists
    const form = await page.$('#contact-modal-form');
    assert.ok(form, 'Contact modal form should exist inside modal');

    console.log('Closing contact modal...');
    const closeBtn = await page.$('#close-contact-modal');
    assert.ok(closeBtn, 'Modal close button should exist');
    await page.evaluate(el => el.click(), closeBtn);
    
    // Wait for animation to finish closing
    await new Promise(r => setTimeout(r, 500));
    
    const isModalHidden = await page.evaluate(() => {
      const modal = document.getElementById('contact-modal');
      return !modal.classList.contains('active');
    });
    assert.ok(isModalHidden, 'Contact modal should be hidden after closing');

    // Verify inert is removed
    const appWrapperActive = await page.evaluate(() => {
      const wrapper = document.getElementById('app-wrapper');
      return wrapper ? !wrapper.hasAttribute('inert') : true;
    });
    assert.ok(appWrapperActive, '#app-wrapper should no longer be inert');

    console.log('✅ Contact Modal E2E tests passed.');
  } catch (error) {
    console.error('❌ E2E Test Failed:', error);
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
    process.exit(exitCode);
  }
}

runTests();
