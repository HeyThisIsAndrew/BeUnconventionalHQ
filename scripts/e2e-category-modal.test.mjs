import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Category Modal E2E...');
  const server = spawn('npm', ['run', 'preview'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('http://localhost:4321')) resolve();
    });
    server.stderr.on('data', (data) => console.error(data.toString()));
    server.on('error', reject);
    server.on('exit', (code) => { if (code !== 0) reject(new Error(`Server exited with code ${code}`)); });
    setTimeout(() => reject(new Error('Server start timed out')), 15000);
  });

  console.log('Server is running. Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // Mobile viewport
    console.log('Navigating to feed page...');
    await page.goto('http://localhost:4321/feed');
    
    await page.waitForSelector('#open-categories-btn', { timeout: 5000 });
    const trigger = await page.$('#open-categories-btn');
    assert.ok(trigger, 'Mobile filter trigger found');
    await trigger.click();

    const modalVisible = await page.waitForSelector('#category-fullscreen-overlay', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Category overlay should become visible');

    console.log('Closing overlay via close button...');
    const closeBtn = await page.$('#category-fullscreen-overlay .close-fullscreen-btn');
    if (closeBtn) {
      await closeBtn.click();
    } else {
      console.log('No specific close button found, clicking outside or using Escape.');
      await page.keyboard.press('Escape');
    }
    await new Promise(r => setTimeout(r, 500));
    
    const isHidden = await page.evaluate(() => {
      const modal = document.getElementById('category-fullscreen-overlay');
      return !modal || window.getComputedStyle(modal).display === 'none' || window.getComputedStyle(modal).opacity === '0' || modal.hidden || modal.classList.contains('translate-y-full');
    });
    assert.ok(isHidden, 'Category overlay should be hidden after closing');

    console.log('✅ Category Modal E2E tests passed.');
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
