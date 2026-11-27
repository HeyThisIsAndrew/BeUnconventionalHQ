import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Category Dropdown E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

    /* ── 1. Open, anchored overlap (no layout shift), no scroll lock ───────── */
    for (const route of ['/category/film', '/intel']) {
      await page.goto(`http://localhost:4321${route}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#open-categories-btn', { timeout: 5000 });

      const siblingBeforeTop = await page.evaluate(() => {
        const row = document.querySelector('.mobile-category-row');
        const next = row?.nextElementSibling ?? document.querySelector('.intel-magazine, .feed-grid-section, .empty-state');
        return next ? Math.round(next.getBoundingClientRect().top) : null;
      });

      await page.click('#open-categories-btn');
      await page.waitForFunction(
        () => document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      await new Promise((r) => setTimeout(r, 300));

      const openState = await page.evaluate(() => {
        const trigger = document.getElementById('open-categories-btn');
        const panel = document.getElementById('category-dropdown-menu');
        const row = document.querySelector('.mobile-category-row');
        const next = row?.nextElementSibling ?? document.querySelector('.intel-magazine, .feed-grid-section, .empty-state');
        const tr = trigger?.getBoundingClientRect();
        const pr = panel?.getBoundingClientRect();
        const links = panel ? [...panel.querySelectorAll('a.cat-btn')] : [];
        return {
          position: panel ? getComputedStyle(panel).position : null,
          ariaHidden: panel?.getAttribute('aria-hidden'),
          ariaExpanded: trigger?.getAttribute('aria-expanded'),
          focusInside: panel?.contains(document.activeElement) ?? false,
          locked: window.__hqScrollLock ? window.__hqScrollLock.isLocked() : false,
          bodyPosition: getComputedStyle(document.body).position,
          hasOverlayClass: document.documentElement.classList.contains('category-overlay-open'),
          hasCloseFullscreenBtn: Boolean(document.querySelector('.close-fullscreen-btn')),
          topGap: tr && pr ? Math.round(pr.top - tr.bottom) : null,
          widthDiff: tr && pr ? Math.abs(Math.round(pr.width - tr.width)) : null,
          siblingAfterTop: next ? Math.round(next.getBoundingClientRect().top) : null,
          buttonCount: links.length,
          allOnScreen: links.every((b) => {
            const r = b.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height >= 44;
          }),
        };
      });

      assert.equal(openState.position, 'absolute', `${route}: dropdown must use position: absolute`);
      assert.equal(openState.ariaHidden, 'false', `${route}: open dropdown must clear aria-hidden`);
      assert.equal(openState.ariaExpanded, 'true', `${route}: trigger must report aria-expanded="true"`);
      assert.ok(openState.focusInside, `${route}: opening must move focus into the dropdown`);
      assert.equal(openState.locked, false, `${route}: opening dropdown must not lock page scroll`);
      assert.notEqual(openState.bodyPosition, 'fixed', `${route}: body must stay scrollable`);
      assert.equal(openState.hasOverlayClass, false, `${route}: old category-overlay-open class must not be set`);
      assert.equal(openState.hasCloseFullscreenBtn, false, `${route}: fullscreen close button must not exist`);
      assert.ok(
        openState.topGap !== null && Math.abs(openState.topGap) <= 12,
        `${route}: dropdown should anchor directly below trigger, got topGap=${openState.topGap}`,
      );
      assert.ok(
        openState.widthDiff !== null && openState.widthDiff <= 4,
        `${route}: dropdown width should match trigger width, got diff=${openState.widthDiff}`,
      );
      if (siblingBeforeTop !== null && openState.siblingAfterTop !== null) {
        assert.equal(
          openState.siblingAfterTop,
          siblingBeforeTop,
          `${route}: dropdown must overlap content without pushing it down`,
        );
      }
      assert.equal(openState.buttonCount, 4, `${route}: all 4 categories must render`);
      assert.ok(openState.allOnScreen, `${route}: all category links must sit on screen with >=44px height`);
      console.log(`  ✓ ${route}: anchored overlapping dropdown opens cleanly without shifting layout or locking scroll`);

      /* ── 2. Escape closes and restores focus to trigger ──────────────────── */
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => !document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      const afterEscape = await page.evaluate(() => {
        const panel = document.getElementById('category-dropdown-menu');
        const trigger = document.getElementById('open-categories-btn');
        return {
          ariaHidden: panel?.getAttribute('aria-hidden'),
          ariaExpanded: trigger?.getAttribute('aria-expanded'),
          focusReturned: document.activeElement === trigger,
        };
      });
      assert.equal(afterEscape.ariaHidden, 'true', `${route}: aria-hidden must restore after Escape`);
      assert.equal(afterEscape.ariaExpanded, 'false', `${route}: aria-expanded must restore after Escape`);
      assert.ok(afterEscape.focusReturned, `${route}: focus must return to #open-categories-btn after Escape`);
      console.log(`  ✓ ${route}: Escape closes dropdown and restores focus`);

      /* ── 3. Second trigger click and outside click close it ──────────────── */
      await page.click('#open-categories-btn');
      await page.waitForFunction(
        () => document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      await page.click('#open-categories-btn');
      await page.waitForFunction(
        () => !document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );

      await page.click('#open-categories-btn');
      await page.waitForFunction(
        () => document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      await page.evaluate(() => document.body.click());
      await page.waitForFunction(
        () => !document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      console.log(`  ✓ ${route}: second click and outside click close dropdown`);

      /* ── 4. Mutual exclusion with Navbar and Contents dropdowns ──────────── */
      await page.click('#open-categories-btn');
      await page.waitForFunction(
        () => document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );
      await page.click('#navbar .nav-toggle');
      await page.waitForFunction(
        () =>
          document.getElementById('navbar')?.classList.contains('menu-open') &&
          !document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
        { timeout: 3000 },
      );

      await page.evaluate(() => document.getElementById('open-categories-btn')?.click());
      await page.waitForFunction(
        () =>
          document.getElementById('category-dropdown-menu')?.classList.contains('is-open') &&
          !document.getElementById('navbar')?.classList.contains('menu-open'),
        { timeout: 3000 },
      );

      const hasContentsBtn = await page.evaluate(() => {
        const btn = document.getElementById('nav-contents-btn');
        return Boolean(btn && !btn.hidden);
      });
      if (hasContentsBtn) {
        await page.click('#nav-contents-btn');
        await page.waitForFunction(
          () =>
            document.getElementById('floating-page-nav')?.classList.contains('is-open') &&
            !document.getElementById('category-dropdown-menu')?.classList.contains('is-open'),
          { timeout: 3000 },
        );
        await page.evaluate(() => document.getElementById('open-categories-btn')?.click());
        await page.waitForFunction(
          () =>
            document.getElementById('category-dropdown-menu')?.classList.contains('is-open') &&
            !document.getElementById('floating-page-nav')?.classList.contains('is-open'),
          { timeout: 3000 },
        );
      }
      await page.keyboard.press('Escape');
      console.log(`  ✓ ${route}: mutual exclusion across Categories, Navbar, and Contents`);
    }

    /* ── 5. Label sync preserves chevron SVG ───────────────────────────────── */
    await page.goto('http://localhost:4321/category/film', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#open-categories-btn', { timeout: 5000 });
    await page.waitForFunction(
      () => /Categories \|/.test(document.getElementById('open-categories-btn')?.textContent ?? ''),
      { timeout: 3000 },
    );
    const labelled = await page.evaluate(() => {
      const btn = document.getElementById('open-categories-btn');
      return {
        text: btn?.querySelector('.category-trigger-label')?.textContent?.trim(),
        active: btn?.classList.contains('active'),
        hasChevron: Boolean(btn?.querySelector('.category-trigger-chevron')),
      };
    });
    assert.match(labelled.text, /^Categories \| /, 'the button label must name the active category');
    assert.ok(labelled.active, 'the button must carry .active on a category page');
    assert.ok(labelled.hasChevron, 'updating the label must preserve the chevron SVG');
    console.log(`  ✓ /category/film: button reads "${labelled.text}" with chevron intact`);

    await page.goto('http://localhost:4321/intel', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#open-categories-btn', { timeout: 5000 });
    const intelState = await page.evaluate(() => {
      const btn = document.getElementById('open-categories-btn');
      return {
        text: btn?.querySelector('.category-trigger-label')?.textContent?.trim(),
        hasChevron: Boolean(btn?.querySelector('.category-trigger-chevron')),
      };
    });
    assert.doesNotMatch(intelState.text, /\|/, `/intel: label should stay unfiltered, got "${intelState.text}"`);
    assert.ok(intelState.hasChevron, '/intel: chevron SVG must be present');
    console.log(`  ✓ /intel: button label "${intelState.text}" with chevron intact`);

    console.log('✅ Category Dropdown E2E tests passed.');
  } catch (error) {
    console.error('❌ E2E Test Failed:', error);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}
runTests();
