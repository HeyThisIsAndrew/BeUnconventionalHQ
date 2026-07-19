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
      if (text.includes('http://localhost:4321')) resolve();
    });
    server.stderr.on('data', (data) => console.error(data.toString()));
    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Server exited with code ${code}`));
    });
    setTimeout(() => reject(new Error('Server start timed out')), 15000);
  });

  console.log('Server is running. Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    
    console.log('Navigating to homepage to test Contact Modal...');
    await page.goto('http://localhost:4321/');
    
    // Wait for hydration
    await page.waitForSelector('[data-modal-trigger="contact"]', { timeout: 5000 });
    
    const trigger = await page.$('[data-modal-trigger="contact"]');
    assert.ok(trigger, 'Contact modal trigger should exist');

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
    await closeBtn.click();
    
    // Wait for animation to finish closing
    await new Promise(r => setTimeout(r, 500));
    
    const isModalHidden = await page.evaluate(() => {
      const modal = document.getElementById('contact-modal');
      return window.getComputedStyle(modal).display === 'none' || window.getComputedStyle(modal).opacity === '0' || modal.hidden;
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
