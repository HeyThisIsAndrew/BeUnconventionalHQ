import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Video Modal E2E...');
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
    
    console.log('Navigating to homepage to test Video Modal...');
    await page.goto('http://localhost:4321/');
    
    // Wait for hydration
    await page.waitForSelector('[data-action="open-video"]', { timeout: 5000 });
    
    const triggers = await page.$$('[data-action="open-video"]');
    console.log(`Found ${triggers.length} video modal triggers.`);
    
    if (triggers.length === 0) {
      throw new Error('No [data-action="open-video"] elements found on homepage.');
    }

    const firstTrigger = triggers[0];
    const expectedVideoId = await page.evaluate(el => el.getAttribute('data-video-id'), firstTrigger);
    assert.ok(expectedVideoId, 'Trigger must have a data-video-id attribute');

    console.log(`Clicking trigger with video ID: ${expectedVideoId}`);
    await firstTrigger.click();

    // Verify modal is visible
    const modalVisible = await page.waitForSelector('#video-modal', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Video modal should become visible');

    // Wait for iframe src to be set
    const iframeSrc = await page.evaluate(() => {
      const iframe = document.getElementById('modal-iframe');
      return iframe ? iframe.src : null;
    });
    
    assert.ok(iframeSrc, 'Iframe should have a src');
    assert.ok(iframeSrc.includes(expectedVideoId), `Iframe src should contain video ID ${expectedVideoId}`);

    // Verify inert lock is applied to main app
    const appWrapperInert = await page.evaluate(() => {
      const wrapper = document.getElementById('app-wrapper');
      return wrapper ? wrapper.hasAttribute('inert') : false;
    });
    assert.ok(appWrapperInert, '#app-wrapper should have inert attribute for accessibility');

    console.log('Closing modal...');
    const closeBtn = await page.$('#video-modal .modal-close');
    assert.ok(closeBtn, 'Modal close button should exist');
    await closeBtn.click();
    
    // Wait for animation to finish closing (it removes the open class or hides it)
    await new Promise(r => setTimeout(r, 500));
    
    const isModalHidden = await page.evaluate(() => {
      const modal = document.getElementById('video-modal');
      return window.getComputedStyle(modal).display === 'none' || window.getComputedStyle(modal).opacity === '0' || modal.hidden;
    });
    assert.ok(isModalHidden, 'Video modal should be hidden after closing');

    // Verify inert is removed
    const appWrapperActive = await page.evaluate(() => {
      const wrapper = document.getElementById('app-wrapper');
      return wrapper ? !wrapper.hasAttribute('inert') : true;
    });
    assert.ok(appWrapperActive, '#app-wrapper should no longer be inert');
    
    console.log('Testing ESC key close...');
    await firstTrigger.click();
    await page.waitForSelector('#video-modal', { visible: true, timeout: 3000 });
    
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    
    const isModalHiddenEsc = await page.evaluate(() => {
      const modal = document.getElementById('video-modal');
      return window.getComputedStyle(modal).display === 'none' || window.getComputedStyle(modal).opacity === '0' || modal.hidden;
    });
    assert.ok(isModalHiddenEsc, 'Video modal should be hidden after ESC key');

    console.log('✅ Video Modal E2E tests passed.');
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
