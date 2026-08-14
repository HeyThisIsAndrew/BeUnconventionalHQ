import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

// Start Astro server
const server = spawn('npm', ['run', 'preview'], {
  stdio: 'pipe',
  detached: true
});

let output = '';
await new Promise((resolve, reject) => {
  server.stdout.on('data', (data) => {
    output += data.toString();
    if (output.includes('http://localhost:4321')) resolve();
  });
  server.stderr.on('data', (data) => console.error(data.toString()));
  server.on('error', reject);
});

console.log('Server started. Launching Puppeteer...');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const routes = [
  { name: 'home', url: '/' },
  { name: 'intel', url: '/intel' },
  { name: 'feed', url: '/feed' }
];

for (const route of routes) {
  console.log(`Taking screenshot of ${route.name}...`);
  await page.goto(`http://localhost:4321${route.url}`, { waitUntil: 'networkidle0' });
  await page.screenshot({ 
    path: `/Users/thisisandrew/.gemini/antigravity/brain/c0987d32-a75f-44e1-b9ee-9074db5fe9be/scratch/screenshot-${route.name}.png`, 
    fullPage: true 
  });
}

await browser.close();
process.kill(-server.pid);
console.log('Done.');
