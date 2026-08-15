import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { launchTestBrowser } from './e2e-browser.mjs';

function canConnect(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: 'localhost' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try { server.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  }, 3000).unref?.();
}

async function ensureServer(port = 4321, timeoutMs = 30000) {
  const base = `http://localhost:${port}`;
  if (await canConnect(port)) {
    console.log(`[Chaos Resizer] Detected existing server listening on ${base}`);
    return null;
  }

  console.log(`[Chaos Resizer] Starting astro dev server on port ${port}...`);
  const astroBin = path.resolve('node_modules/.bin/astro');
  const server = spawn(astroBin, ['dev', '--port', String(port), '--host', 'localhost'], {
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: '1',
      HOME: path.resolve('.astro'),
      XDG_CONFIG_HOME: path.resolve('.astro'),
    },
  });

  let output = '';
  server.stdout?.on('data', (d) => { output += d.toString(); });
  server.stderr?.on('data', (d) => { output += d.toString(); });

  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Astro dev server exited with code ${server.exitCode}.\nOutput:\n${output}`);
    }
    if (await canConnect(port)) {
      try {
        const res = await fetch(base, { signal: AbortSignal.timeout(3000) });
        await res.arrayBuffer().catch(() => {});
        if (res.status < 500) {
          console.log(`[Chaos Resizer] Server ready at ${base}`);
          return { server, base, stop: () => stopServer(server) };
        }
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  stopServer(server);
  throw new Error(`Server never answered at ${base} within ${timeoutMs}ms. Output:\n${output}`);
}

async function runChaosResizer() {
  const targetUrl = 'http://localhost:4321';
  let serverHandle = null;

  try {
    serverHandle = await ensureServer(4321, 30000);
  } catch (err) {
    console.error('[Chaos Resizer] Server startup error:', err.message);
    throw err;
  }

  console.log('[Chaos Resizer] Launching Puppeteer browser...');
  const browser = await launchTestBrowser();
  const page = await browser.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      consoleErrors.push({ text, location: msg.location() });
    } else if (type === 'warning' || type === 'warn') {
      consoleWarnings.push({ text, location: msg.location() });
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  page.on('requestfailed', (req) => {
    requestFailures.push({
      url: req.url(),
      method: req.method(),
      error: req.failure()?.errorText || 'Unknown error',
    });
  });

  console.log(`[Chaos Resizer] Navigating to ${targetUrl}...`);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Allow initial scripts/layout to settle
  await new Promise((r) => setTimeout(r, 1200));

  const pageTitle = await page.title();
  console.log(`[Chaos Resizer] Page title: "${pageTitle}"`);

  const widths = [375, 768, 1440];
  const resizeHistory = [];
  const totalIterations = 20;

  console.log(`[Chaos Resizer] Starting ${totalIterations} rapid random resizes between [375px, 768px, 1440px]...`);

  for (let i = 1; i <= totalIterations; i++) {
    const targetWidth = widths[Math.floor(Math.random() * widths.length)];
    await page.setViewport({ width: targetWidth, height: 900 });

    // Rapid resize reflow delay
    await new Promise((r) => setTimeout(r, 100));

    const metrics = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const innerWidth = window.innerWidth;
      const clientWidth = document.documentElement.clientWidth;
      const hasOverflow = scrollWidth > innerWidth;
      const overflowPx = scrollWidth - innerWidth;

      return {
        scrollWidth,
        innerWidth,
        clientWidth,
        hasOverflow,
        overflowPx,
      };
    });

    resizeHistory.push({
      step: i,
      viewportWidth: targetWidth,
      ...metrics,
    });

    console.log(
      `Step ${String(i).padStart(2)}/20: ${String(targetWidth).padStart(4)}px -> scrollWidth: ${metrics.scrollWidth}px, innerWidth: ${metrics.innerWidth}px | Overflow: ${metrics.hasOverflow ? `YES (+${metrics.overflowPx}px)` : 'NO'}`
    );
  }

  console.log('\n[Chaos Resizer] Finished 20 random resizes.');
  console.log('[Chaos Resizer] Checking horizontal overflow (document.documentElement.scrollWidth vs window.innerWidth)...');

  // Final check at current state
  const postChaosEvaluation = await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const innerWidth = window.innerWidth;
    const clientWidth = document.documentElement.clientWidth;
    const bodyScrollWidth = document.body.scrollWidth;
    const bodyClientWidth = document.body.clientWidth;

    const hasOverflow = scrollWidth > innerWidth;
    const overflowDiff = scrollWidth - innerWidth;

    const offendingElements = [];
    if (hasOverflow) {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth + 1 || rect.left < -1) {
          offendingElements.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: typeof el.className === 'string' ? el.className.trim() : '',
            rect: {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            },
          });
        }
      }
    }

    return {
      scrollWidth,
      innerWidth,
      clientWidth,
      bodyScrollWidth,
      bodyClientWidth,
      hasOverflow,
      overflowDiff,
      offendingElements: offendingElements.slice(0, 10),
    };
  });

  // Post-chaos breakpoint inspection across 375px, 768px, and 1440px
  const breakpointChecks = {};
  for (const w of widths) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 150));

    breakpointChecks[`${w}px`] = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const innerWidth = window.innerWidth;
      const clientWidth = document.documentElement.clientWidth;
      const hasOverflow = scrollWidth > innerWidth;
      const diff = scrollWidth - innerWidth;

      const offending = [];
      if (hasOverflow) {
        document.querySelectorAll('*').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > window.innerWidth + 1) {
            offending.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              className: typeof el.className === 'string' ? el.className.trim() : '',
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            });
          }
        });
      }

      return {
        scrollWidth,
        innerWidth,
        clientWidth,
        hasOverflow,
        overflowDiff: diff,
        offendingElements: offending.slice(0, 5),
      };
    });
  }

  const report = {
    targetUrl,
    pageTitle,
    totalResizes: totalIterations,
    resizeHistory,
    postChaosEvaluation,
    breakpointChecks,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    requestFailures,
  };

  console.log('\n================ CHAOS RESIZER FINDINGS ================');
  console.log(JSON.stringify(report, null, 2));
  console.log('========================================================\n');

  await browser.close();
  if (serverHandle) {
    console.log('[Chaos Resizer] Stopping dev server...');
    serverHandle.stop();
  }

  return report;
}

runChaosResizer().catch((err) => {
  console.error('[Chaos Resizer] Execution failed:', err);
  process.exit(1);
});
