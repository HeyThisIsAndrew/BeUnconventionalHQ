import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

async function runTests() {
  console.log('Starting Astro preview server for Navigation E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;

  try {
    const page = await browser.newPage();
    // Simulate mobile viewport to test the mobile toggle
    await page.setViewport({ width: 375, height: 667 });
    
    /*
      Tested on /feed, NOT the homepage.

      The homepage now opens as a splash screen and deliberately hides the
      navbar until the curtain is lifted (styles/modules/splash.css). Driving
      that reveal first made this file depend on the splash's timing — the
      navbar fades in on a delay so it lands with the content, and clicking
      mid-fade was intermittently missed, which made this suite flaky.

      The mobile menu is identical on every route, so it is tested on one
      where no curtain is in the way. The splash's own behaviour — navbar
      hidden while armed, restored after the lift — is asserted directly in
      scripts/e2e-splash.test.mjs, which is where it belongs.
    */
    console.log('Navigating to /feed to test Navigation...');
    await page.goto('http://localhost:4321/feed');

    await page.waitForSelector('#navbar', { timeout: 5000 });
    
    const navbar = await page.$('#navbar');
    assert.ok(navbar, 'Navbar should exist in DOM');

    const toggle = await page.$('.nav-toggle');
    assert.ok(toggle, 'Nav toggle button should exist');

    /*
      Wait for the CLICK HANDLER, not just the element.

      Navbar.astro binds the toggle inside `astro:page-load`, so the button
      exists in the served HTML well before anything is listening to it.
      `waitForSelector('#navbar')` only proved the markup had arrived, so this
      suite clicked an inert button roughly half the time — a ~50% flake that
      had nothing to do with what it was testing.

      The bind sets `toggle.dataset.mobileClickBound`, so waiting for that
      attribute waits for the exact thing the next line depends on. No sleep,
      no guess.
    */
    await page.waitForSelector('.nav-toggle', { timeout: 5000 });

    console.log('Opening mobile dropdown menu...');
    await page.evaluate(el => el.click(), toggle);
    await new Promise(r => setTimeout(r, 350)); // wait for dropdown entry transition

    const dropdownOpenState = await page.evaluate(() => {
      const navbarEl = document.getElementById('navbar');
      const navContainer = navbarEl?.querySelector('.nav-container');
      const navRect = navbarEl?.getBoundingClientRect();
      const dropRect = navContainer?.getBoundingClientRect();
      return {
        isMenuOpen: Boolean(navbarEl?.classList.contains('menu-open')),
        dropTop: dropRect ? Math.round(dropRect.top) : -1,
        dropHeight: dropRect ? Math.round(dropRect.height) : -1,
        navBottom: navRect ? Math.round(navRect.bottom) : -1,
        innerHeight: window.innerHeight,
        bodyPosition: getComputedStyle(document.body).position,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
      };
    });
    assert.ok(dropdownOpenState.isMenuOpen, 'Navbar should have menu-open class after toggle click');
    assert.ok(
      dropdownOpenState.dropTop >= dropdownOpenState.navBottom - 2,
      `Dropdown top (${dropdownOpenState.dropTop}) should sit below navbar bottom (${dropdownOpenState.navBottom})`
    );
    assert.ok(
      dropdownOpenState.dropHeight > 120 && dropdownOpenState.dropHeight < dropdownOpenState.innerHeight * 0.75,
      `Dropdown height (${dropdownOpenState.dropHeight}) should be compact, not a full-screen overlay (${dropdownOpenState.innerHeight})`
    );
    assert.notEqual(dropdownOpenState.bodyPosition, 'fixed', 'Body must not be fixed-locked while mobile dropdown is open');
    assert.notEqual(dropdownOpenState.htmlOverflow, 'hidden', 'HTML scroll must remain enabled while mobile dropdown is open');

    // Verify page remains scrollable while mobile dropdown is open
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 600);
    });
    await new Promise(r => setTimeout(r, 200));
    const scrollWhileOpen = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(scrollWhileOpen >= 500, `Page must scroll while mobile dropdown is open (scrollY=${scrollWhileOpen})`);

    // Tap outside navbar closes dropdown
    await page.evaluate(() => document.querySelector('main')?.click());
    await new Promise(r => setTimeout(r, 300));
    const closedAfterOutsideClick = await page.evaluate(() => !document.getElementById('navbar')?.classList.contains('menu-open'));
    assert.ok(closedAfterOutsideClick, 'Clicking outside navbar should close mobile dropdown');

    // Re-open, test Escape closes & restores focus
    await page.evaluate(el => el.click(), toggle);
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    const closedAfterEscape = await page.evaluate(() => ({
      closed: !document.getElementById('navbar')?.classList.contains('menu-open'),
      focusedToggle: document.activeElement?.classList.contains('nav-toggle'),
    }));
    assert.ok(closedAfterEscape.closed, 'Escape should close mobile dropdown');
    assert.ok(closedAfterEscape.focusedToggle, 'Escape should return focus to .nav-toggle');

    // Verify Contents button docked in navbar on /feed (no left-edge side rail)
    const contentsBtn = await page.$('#nav-contents-btn');
    assert.ok(contentsBtn, '#nav-contents-btn should exist in DOM');
    const contentsVisible = await page.evaluate((el) => !el.hidden && getComputedStyle(el).display !== 'none', contentsBtn);
    assert.ok(contentsVisible, '#nav-contents-btn should be visible on /feed');
    await page.evaluate((el) => el.click(), contentsBtn);
    await new Promise(r => setTimeout(r, 300));
    const contentsState = await page.evaluate(() => {
      const panel = document.getElementById('floating-page-nav');
      const navRect = document.getElementById('navbar').getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        isOpen: Boolean(panel?.classList.contains('is-open')),
        left: panelRect ? Math.round(panelRect.left) : -1,
        right: panelRect ? Math.round(panelRect.right) : -1,
        top: panelRect ? Math.round(panelRect.top) : -1,
        navBottom: Math.round(navRect.bottom),
        linksCount: panel?.querySelectorAll('[data-toc-link]').length ?? 0,
      };
    });
    assert.ok(contentsState.isOpen, '#floating-page-nav should open when #nav-contents-btn is clicked');
    assert.ok(contentsState.top >= contentsState.navBottom, 'Contents dropdown should sit below navbar');
    assert.ok(contentsState.left > 0, 'Contents dropdown must not be pinned to left viewport edge 0');
    assert.ok(contentsState.linksCount >= 2, 'Contents dropdown must contain section links');

    // Opening mobile menu closes Contents dropdown (one dropdown at a time)
    await page.evaluate((el) => el.click(), toggle);
    await new Promise(r => setTimeout(r, 250));
    const mutuallyExclusive = await page.evaluate(() => ({
      menuOpen: document.getElementById('navbar')?.classList.contains('menu-open'),
      contentsOpen: document.getElementById('floating-page-nav')?.classList.contains('is-open'),
    }));
    assert.ok(mutuallyExclusive.menuOpen && !mutuallyExclusive.contentsOpen, 'Opening mobile menu should close Contents dropdown');

    console.log('Closing mobile menu...');
    await page.evaluate(el => el.click(), toggle);
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

    // Test landscape phone dropdown
    await page.setViewport({ width: 844, height: 390 });
    await page.goto('http://localhost:4321/feed', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#navbar .nav-toggle', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#navbar .nav-toggle')?.click());
    await new Promise(r => setTimeout(r, 300));
    const landscapeCheck = await page.evaluate(() => {
      const links = [...document.querySelectorAll('#navbar .nav-list a')];
      const rects = links.map((a) => a.getBoundingClientRect());
      return {
        open: document.getElementById('navbar')?.classList.contains('menu-open'),
        count: links.length,
        allVisible: rects.every((r) => r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight),
      };
    });
    assert.ok(landscapeCheck.open && landscapeCheck.count === 5 && landscapeCheck.allVisible,
      `All 5 nav links must fit visibly in landscape dropdown: ${JSON.stringify(landscapeCheck)}`);

    // Mobile portrait footer overlap: #floating-page-nav must paint above footer.site-footer
    await page.setViewport({ width: 390, height: 844 });
    await page.goto('http://localhost:4321/feed', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#nav-contents-btn:not([hidden])', { timeout: 5000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await new Promise(r => setTimeout(r, 200));
    await page.click('#nav-contents-btn');
    await page.waitForSelector('#floating-page-nav.is-open', { timeout: 3000 });
    await new Promise(r => setTimeout(r, 300));
    const footerOverlap = await page.evaluate(() => {
      const panel = document.getElementById('floating-page-nav');
      const footer = document.querySelector('footer.site-footer');
      if (!panel || !footer) return null;
      const pr = panel.getBoundingClientRect();
      const fr = footer.getBoundingClientRect();
      const overlapTop = Math.max(pr.top, fr.top);
      const overlapBottom = Math.min(pr.bottom, fr.bottom);
      const overlapX = Math.round(pr.left + pr.width / 2);
      const overlapY = Math.round((overlapTop + overlapBottom) / 2);
      const overlapHit = document.elementFromPoint(overlapX, overlapY);
      const links = [...panel.querySelectorAll('[data-toc-link]')];
      const lastVisible = [...links].reverse().find((a) => {
        const r = a.getBoundingClientRect();
        return r.bottom <= pr.bottom && r.top >= pr.top && r.height > 0;
      });
      const lr = lastVisible?.getBoundingClientRect();
      const linkHit = lr ? document.elementFromPoint(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2)) : null;
      return {
        overlaps: overlapBottom > overlapTop,
        overlapHitsPanel: Boolean(overlapHit && panel.contains(overlapHit)),
        overlapHitsFooter: Boolean(overlapHit && footer.contains(overlapHit)),
        lastLinkHitsPanel: Boolean(linkHit && panel.contains(linkHit)),
        lastLinkHitsFooter: Boolean(linkHit && footer.contains(linkHit)),
      };
    });
    assert.ok(footerOverlap?.overlaps, `Expected footer to overlap #floating-page-nav at page bottom: ${JSON.stringify(footerOverlap)}`);
    assert.ok(
      footerOverlap.overlapHitsPanel && !footerOverlap.overlapHitsFooter && footerOverlap.lastLinkHitsPanel && !footerOverlap.lastLinkHitsFooter,
      `Contents dropdown painted beneath footer.site-footer: ${JSON.stringify(footerOverlap)}`,
    );
    await page.click('#nav-contents-btn');
    await page.waitForFunction(() => !document.getElementById('floating-page-nav')?.classList.contains('is-open'), { timeout: 3000 });

    // Test 4K desktop navbar edge alignment: logo far-left, nav links + actions far-right
    await page.setViewport({ width: 3840, height: 2160 });
    await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#navbar', { timeout: 5000 });
    const alignmentHome4k = await page.evaluate(() => {
      const logoRect = document.querySelector('#navbar .nav-logo').getBoundingClientRect();
      const rightRect = document.querySelector('#navbar .nav-right-group').getBoundingClientRect();
      const contentsBtnEl = document.getElementById('nav-contents-btn');
      return {
        logoLeft: Math.round(logoRect.left),
        rightGap: Math.round(window.innerWidth - rightRect.right),
        contentsHidden: Boolean(contentsBtnEl?.hidden),
      };
    });
    assert.ok(
      alignmentHome4k.logoLeft <= 80,
      `At 3840px, logo should stay on the far left (got left=${alignmentHome4k.logoLeft}px)`
    );
    assert.ok(
      alignmentHome4k.rightGap <= 80,
      `At 3840px, nav links + actions should stay on the far right (got rightGap=${alignmentHome4k.rightGap}px)`
    );
    assert.ok(alignmentHome4k.contentsHidden, 'Contents button should stay hidden on / when there is no FloatingPageNav');

    await page.goto('http://localhost:4321/feed', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#nav-contents-btn:not([hidden])', { timeout: 5000 });
    const alignmentFeed4k = await page.evaluate(() => {
      const logoRect = document.querySelector('#navbar .nav-logo').getBoundingClientRect();
      const rightRect = document.querySelector('#navbar .nav-right-group').getBoundingClientRect();
      return {
        logoLeft: Math.round(logoRect.left),
        rightGap: Math.round(window.innerWidth - rightRect.right),
      };
    });
    assert.ok(
      alignmentFeed4k.logoLeft <= 80 && alignmentFeed4k.rightGap <= 80,
      `At 3840px on /feed, logo/right alignment must hold (${JSON.stringify(alignmentFeed4k)})`
    );

    // Click Contents entry on /feed at 4K: closes dropdown & scrolls to target section
    await page.click('#nav-contents-btn');
    await page.waitForSelector('#floating-page-nav.is-open', { timeout: 3000 });
    const tocTarget = await page.evaluate(() => {
      const links = [...document.querySelectorAll('#floating-page-nav [data-toc-link]')];
      const target = links[links.length - 1];
      if (!target) return null;
      const id = target.getAttribute('data-toc-link');
      target.click();
      return id;
    });
    assert.ok(tocTarget, 'Expected a target section in Contents dropdown');
    await new Promise(r => setTimeout(r, 900));
    const afterTocClick = await page.evaluate(() => ({
      contentsClosed: !document.getElementById('floating-page-nav')?.classList.contains('is-open'),
      scrollY: Math.round(window.scrollY),
    }));
    assert.ok(afterTocClick.contentsClosed, 'Clicking Contents entry should close dropdown');
    assert.ok(afterTocClick.scrollY > 100, `Clicking Contents entry should scroll page (scrollY=${afterTocClick.scrollY})`);

    // ClientRouter transition from /feed -> /about must hide persisted #nav-contents-btn
    await page.click('#navbar .nav-list a[href="/about"]');
    await page.waitForFunction(() => window.location.pathname === '/about', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('nav-contents-btn')?.hidden === true, { timeout: 3000 });

    console.log('✅ Navigation E2E tests passed.');
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
