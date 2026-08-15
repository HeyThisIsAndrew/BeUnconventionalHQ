import puppeteer from 'puppeteer';

async function runChaosClicker() {
  const targetUrl = 'http://localhost:4321';
  console.log(`[Chaos Clicker] Launching Puppeteer to test ${targetUrl}...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on('console', (msg) => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    };
    consoleLogs.push(entry);
    if (msg.type() === 'error') {
      consoleErrors.push(entry);
    }
  });

  page.on('pageerror', (err) => {
    const errorMsg = err.stack || err.message || String(err);
    pageErrors.push(errorMsg);
    console.error(`[Chaos Clicker Page Error]: ${errorMsg}`);
  });

  page.on('requestfailed', (req) => {
    requestFailures.push({
      url: req.url(),
      method: req.method(),
      error: req.failure()?.errorText || 'Unknown error',
    });
  });

  console.log(`[Chaos Clicker] Navigating to ${targetUrl}...`);
  let httpStatus = null;
  try {
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    httpStatus = response ? response.status() : null;
    console.log(`[Chaos Clicker] HTTP Status: ${httpStatus}`);
  } catch (err) {
    console.error(`[Chaos Clicker] Navigation note/error: ${err.message}`);
  }

  // Wait for .fh-row elements to be present
  try {
    await page.waitForSelector('.fh-row', { timeout: 10000 });
    console.log(`[Chaos Clicker] Found .fh-row elements on page.`);
  } catch (err) {
    console.error(`[Chaos Clicker] Timeout waiting for .fh-row: ${err.message}`);
  }

  // Settle time
  await new Promise((r) => setTimeout(r, 1000));

  const pageTitle = await page.title().catch(() => '');

  const rowCount = await page.evaluate(() => document.querySelectorAll('.fh-row').length);
  console.log(`[Chaos Clicker] Total .fh-row elements found: ${rowCount}`);

  const clickHistory = [];
  const stateViolations = [];

  const initialCheck = await page.evaluate(() => {
    const activeRows = document.querySelectorAll('.fh-row.is-active');
    const activeCards = document.querySelectorAll('.fh-hero-card.active');
    return {
      activeRowCount: activeRows.length,
      activeCardCount: activeCards.length,
      activeRowDataIndex: activeRows[0]?.getAttribute('data-index') ?? null,
      activeCardDataIndex: activeCards[0]?.getAttribute('data-index') ?? null,
    };
  });

  console.log('[Chaos Clicker] Initial state:', JSON.stringify(initialCheck));

  if (rowCount === 0) {
    console.error('[Chaos Clicker] No .fh-row elements available to click!');
  } else {
    console.log(`[Chaos Clicker] Starting 50 rapid random clicks with 10ms delays...`);

    for (let i = 1; i <= 50; i++) {
      const targetIndex = Math.floor(Math.random() * rowCount);

      // Perform click inside browser context
      const clickResult = await page.evaluate((idx) => {
        const rows = document.querySelectorAll('.fh-row');
        const targetRow = rows[idx];
        if (!targetRow) return { error: `Row at index ${idx} not found` };

        // Trigger click
        targetRow.click();

        // Check DOM state immediately
        const activeRows = document.querySelectorAll('.fh-row.is-active');
        const activeCards = document.querySelectorAll('.fh-hero-card.active');
        const activeRow = activeRows[0];
        const activeCard = activeCards[0];

        return {
          clickedDomIndex: idx,
          clickedDataIndex: targetRow.getAttribute('data-index'),
          activeRowCount: activeRows.length,
          activeCardCount: activeCards.length,
          activeRowDataIndex: activeRow?.getAttribute('data-index') ?? null,
          activeCardDataIndex: activeCard?.getAttribute('data-index') ?? null,
          ariaPressedValues: Array.from(rows).map((r) => r.getAttribute('aria-pressed')),
        };
      }, targetIndex);

      clickHistory.push({
        iteration: i,
        ...clickResult,
      });

      // Validate invariants
      if (clickResult.activeRowCount !== 1) {
        stateViolations.push({
          iteration: i,
          violation: `Active row count violation: expected 1, got ${clickResult.activeRowCount}`,
          clickResult,
        });
      }
      if (clickResult.activeCardCount !== 1) {
        stateViolations.push({
          iteration: i,
          violation: `Active hero card count violation: expected 1, got ${clickResult.activeCardCount}`,
          clickResult,
        });
      }
      if (clickResult.activeRowDataIndex !== clickResult.activeCardDataIndex) {
        stateViolations.push({
          iteration: i,
          violation: `Index mismatch: active row data-index (${clickResult.activeRowDataIndex}) != active card data-index (${clickResult.activeCardDataIndex})`,
          clickResult,
        });
      }

      // 10ms delay as requested
      await new Promise((r) => setTimeout(r, 10));
    }

    console.log(`[Chaos Clicker] Successfully completed 50 rapid random clicks.`);
  }

  // Let post-click state settle and observe for 2 seconds
  console.log(`[Chaos Clicker] Waiting 2 seconds post-test to catch any asynchronous errors or timers...`);
  await new Promise((r) => setTimeout(r, 2000));

  const finalCheck = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.fh-row'));
    const activeRows = document.querySelectorAll('.fh-row.is-active');
    const activeCards = document.querySelectorAll('.fh-hero-card.active');
    const activeRow = activeRows[0];
    const progress = activeRow?.querySelector('.fh-row-progress');
    const computedProgress = progress ? window.getComputedStyle(progress).transform : null;

    return {
      totalRows: rows.length,
      activeRowCount: activeRows.length,
      activeCardCount: activeCards.length,
      activeRowDataIndex: activeRow?.getAttribute('data-index') ?? null,
      activeCardDataIndex: activeCards[0]?.getAttribute('data-index') ?? null,
      progressTransform: computedProgress,
      ariaPressedList: rows.map((r) => ({
        index: r.getAttribute('data-index'),
        ariaPressed: r.getAttribute('aria-pressed'),
        isActive: r.classList.contains('is-active'),
      })),
    };
  });

  const findings = {
    targetUrl,
    httpStatus,
    pageTitle,
    totalRows: rowCount,
    totalClicksExecuted: clickHistory.length,
    initialCheck,
    finalCheck,
    stateViolationsCount: stateViolations.length,
    stateViolations,
    pageErrorsCount: pageErrors.length,
    pageErrors,
    consoleErrorsCount: consoleErrors.length,
    consoleErrors: consoleErrors.map((c) => ({ text: c.text, url: c.location?.url })),
    requestFailuresCount: requestFailures.length,
    invariants: {
      zeroOrMultipleActiveRowsDetected: stateViolations.some((v) => v.violation.includes('Active row count')),
      zeroOrMultipleActiveCardsDetected: stateViolations.some((v) => v.violation.includes('Active hero card count')),
      rowCardIndexMismatchDetected: stateViolations.some((v) => v.violation.includes('Index mismatch')),
      finalActiveRowCount: finalCheck.activeRowCount,
      finalActiveCardCount: finalCheck.activeCardCount,
    },
    status: {
      activeIndicesIntact: stateViolations.length === 0 && finalCheck.activeRowCount === 1 && finalCheck.activeCardCount === 1,
      pageErrorsEncountered: pageErrors.length > 0,
      consoleErrorsEncountered: consoleErrors.length > 0,
    },
  };

  console.log('\n================== CHAOS CLICKER REPORT ==================');
  console.log(JSON.stringify(findings, null, 2));
  console.log('==========================================================\n');

  await browser.close();
  return findings;
}

runChaosClicker()
  .then(() => {
    console.log('[Chaos Clicker] Execution finished successfully.');
  })
  .catch((err) => {
    console.error('[Chaos Clicker] Fatal error:', err);
    process.exit(1);
  });
