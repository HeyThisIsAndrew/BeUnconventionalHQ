import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Navigation E2E...');
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
    // Simulate mobile viewport to test the mobile toggle
    await page.setViewport({ width: 375, height: 667 });
    
    console.log('Navigating to homepage to test Navigation...');
    await page.goto('http://localhost:4321/');
    
    await page.waitForSelector('#navbar', { timeout: 5000 });
    
    const navbar = await page.$('#navbar');
    assert.ok(navbar, 'Navbar should exist in DOM');

    const toggle = await page.$('.nav-toggle');
    assert.ok(toggle, 'Nav toggle button should exist');

    console.log('Opening mobile menu...');
    await toggle.click();
    await new Promise(r => setTimeout(r, 300)); // wait for transition

    const isMenuOpen = await page.evaluate(() => {
      return document.getElementById('navbar')?.classList.contains('menu-open');
    });
    assert.ok(isMenuOpen, 'Navbar should have menu-open class after toggle click');

    console.log('Closing mobile menu...');
    await toggle.click();
    await new Promise(r => setTimeout(r, 300));

    const isMenuClosed = await page.evaluate(() => {
      return !document.getElementById('navbar')?.classList.contains('menu-open');
    });
    assert.ok(isMenuClosed, 'Navbar should lose menu-open class after second toggle click');

    // Test sticky scroll (must scroll past the hero anchor for the IntersectionObserver to trigger)
    await page.evaluate(() => window.scrollTo(0, 2000));
    await new Promise(r => setTimeout(r, 300)); // wait for IntersectionObserver

    const isScrolled = await page.evaluate(() => {
      const identity = document.getElementById('nav-identity');
      return identity && window.getComputedStyle(identity).opacity === '1';
    });
    assert.ok(isScrolled, 'Navbar identity should become visible after scrolling down');

    console.log('✅ Navigation E2E tests passed.');
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
