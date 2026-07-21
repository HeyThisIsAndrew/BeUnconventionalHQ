import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Calendar Modal E2E...');
  const server = spawn('npm', ['run', 'preview'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('http://localhost:')) resolve();
    });
    server.stderr.on('data', (data) => console.error(data.toString()));
    server.on('error', reject);
    server.on('exit', (code) => { if (code !== 0) reject(new Error(`Server exited with code ${code}`)); });
    setTimeout(() => reject(new Error('Server start timed out')), 30000);
  });

  console.log('Server is running. Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // Mobile viewport
    console.log('Navigating to events page...');
    await page.goto('http://localhost:4321/events');
    
    await page.waitForSelector('.open-full-calendar-btn', { timeout: 5000 });
    const trigger = await page.$('.open-full-calendar-btn');
    assert.ok(trigger, 'Calendar modal trigger found');
    await trigger.click();

    const modalVisible = await page.waitForSelector('#spanning-calendar-modal', { visible: true, timeout: 3000 });
    assert.ok(modalVisible, 'Calendar modal should become visible');

    console.log('Closing modal via ESC...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    
    const isHidden = await page.evaluate(() => {
      const modal = document.getElementById('spanning-calendar-modal');
      return !modal.classList.contains('active');
    });
    assert.ok(isHidden, 'Calendar modal should be hidden after ESC key');

    console.log('✅ Calendar Modal E2E tests passed.');
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
