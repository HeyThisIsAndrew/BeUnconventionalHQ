/*
  Turnstile is loaded on interaction, not on page view.

  ─── WHAT THIS CAN AND CANNOT PROVE ───────────────────────────────────────
  challenges.cloudflare.com is unreachable from CI and from the dev sandbox,
  and pointing a test at Cloudflare's real challenge endpoint would be both
  flaky and rude. So the request is INTERCEPTED and fulfilled with a stub
  that behaves like the real API's explicit-render mode: it defines
  `window.turnstile` and invokes the `onload` callback named in the URL.

  That makes this an honest test of OUR half of the contract:
    - nothing is requested until the reader touches a form
    - the request is made on first interaction, exactly once
    - every widget container gets rendered, with the site key and the
      data-callback globals the components declare
    - widgets still mount after a client-side navigation, which the implicit
      renderer never did

  It does NOT prove a real challenge solves, that Cloudflare accepts the
  rendered widget, or that /api/subscribe validates the resulting token.
  Those need a live key against the deploy preview and are listed on the PR.
*/
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';

const TURNSTILE_HOST = 'challenges.cloudflare.com';

/**
 * Stand-in for api.js in explicit-render mode. Records every render() call on
 * the page so assertions can inspect what we asked Cloudflare to draw.
 */
function stubScript(onloadName) {
  return `
    window.__tsRenders = [];
    window.turnstile = {
      render: function (el, opts) {
        var id = 'w' + window.__tsRenders.length;
        window.__tsRenders.push({
          id: id,
          sitekey: opts && opts.sitekey,
          size: opts && opts.size,
          hasCallback: !!(opts && opts.callback),
          hasErrorCallback: !!(opts && opts['error-callback']),
          hasExpiredCallback: !!(opts && opts['expired-callback']),
          elementId: el && el.id,
          elementClass: el && el.className,
        });
        el.setAttribute('data-stub-widget', id);
        return id;
      },
      getResponse: function () { return 'stub-token'; },
      reset: function () {},
      remove: function () {},
    };
    if (typeof window[${JSON.stringify(onloadName)}] === 'function') {
      window[${JSON.stringify(onloadName)}]();
    }
  `;
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

async function newInstrumentedPage(browser) {
  const page = await browser.newPage();
  const requests = [];
  await page.setRequestInterception(true);

  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes(TURNSTILE_HOST)) {
      req.continue().catch(() => {});
      return;
    }
    requests.push(url);
    // Echo back the onload callback name the loader put in the query string,
    // which is also an assertion that it asked for explicit mode properly.
    const onload = new URL(url).searchParams.get('onload') || '';
    req
      .respond({
        status: 200,
        contentType: 'application/javascript',
        body: stubScript(onload),
      })
      .catch(() => {});
  });

  return { page, requests };
}

async function runTests() {
  console.log('Starting Astro preview server for Turnstile lazy-load E2E...');
  const { stop } = await startPreviewServer();
  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;

  try {
    // ─── 1. Nothing on page load ──────────────────────────────────────────
    const { page, requests } = await newInstrumentedPage(browser);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto('http://localhost:4321/', { waitUntil: 'networkidle0' });

    check('no Turnstile request on page load', () => {
      assert.deepEqual(
        requests,
        [],
        `expected zero requests to ${TURNSTILE_HOST}, got:\n    ${requests.join('\n    ')}`,
      );
    });

    /*
      The only widget the live site mounts is the newsletter one. The contact
      modal's `.cf-turnstile` is deliberately not rendered while that form is
      inactive (ContactModal.astro's RENDER_TURNSTILE flag) — a widget for a
      form nobody can reach is a live Turnstile session on every page view,
      which is what earned the 429 on api.js that PageSpeed flagged.
    */
    const preRender = await page.evaluate(() => ({
      newsletterHolder: !!document.getElementById('newsletter-turnstile'),
      contactWidgets: document.querySelectorAll('.cf-turnstile').length,
      rendered: document.querySelectorAll('[data-stub-widget]').length,
      apiPresent: typeof window.turnstile !== 'undefined',
    }));

    check('the newsletter widget container exists but nothing is rendered yet', () => {
      assert.ok(preRender.newsletterHolder, 'expected #newsletter-turnstile to be server-rendered');
      assert.equal(preRender.rendered, 0);
      assert.equal(preRender.apiPresent, false, 'window.turnstile must not exist before interaction');
    });

    check('the inactive contact form mounts NO widget', () => {
      assert.equal(
        preRender.contactWidgets,
        0,
        'contact modal is inactive — mounting its widget costs a Turnstile session per page view',
      );
    });

    // ─── 2. First interaction triggers the load ───────────────────────────
    /*
      Focus the NEWSLETTER form, not the contact one. The only .cf-turnstile
      on the homepage lives inside the contact modal, which is closed — and
      .focus() on a field in a hidden subtree is a no-op that fires no
      focusin, so triggering from there would test nothing. The newsletter
      form is visible in the subscribe band and is what a reader actually
      touches first.
    */
    const focused = await page.evaluate(() => {
      const field = document.querySelector('#newsletter-form input[type=email]');
      if (!field) return false;
      field.focus();
      return true;
    });
    assert.ok(focused, 'could not find the newsletter email field');

    await page.waitForFunction(() => document.querySelectorAll('[data-stub-widget]').length > 0, {
      timeout: 5000,
    });

    check('focusing the form requests Turnstile exactly once', () => {
      assert.equal(requests.length, 1, `expected 1 request, got ${requests.length}`);
    });

    check('it asks for explicit render mode with an onload callback', () => {
      const url = new URL(requests[0]);
      assert.equal(url.searchParams.get('render'), 'explicit');
      assert.ok(url.searchParams.get('onload'), 'onload callback name missing from the URL');
    });

    const renders = await page.evaluate(() => window.__tsRenders);

    check('the newsletter widget is rendered with its site key', () => {
      const nl = renders.find((r) => r.elementId === 'newsletter-turnstile');
      assert.ok(nl, `newsletter widget never rendered; got ${JSON.stringify(renders)}`);
      assert.ok(nl.sitekey, 'render() called without a sitekey');
    });

    check('exactly ONE widget is rendered — no session for the dead form', () => {
      assert.equal(
        renders.length,
        1,
        `expected only the newsletter widget; got ${JSON.stringify(renders)}`,
      );
      assert.equal(renders[0].elementId, 'newsletter-turnstile');
    });

    // ─── 3. Interacting again does not re-request or double-render ────────
    await page.evaluate(() => {
      const field = document.querySelector('#newsletter-form input[type=email]');
      field.blur();
      field.focus();
    });
    await new Promise((r) => setTimeout(r, 300));

    check('a second interaction does not request the script again', () => {
      assert.equal(requests.length, 1, `expected still 1 request, got ${requests.length}`);
    });

    const afterSecond = await page.evaluate(() => window.__tsRenders.length);
    check('and does not render the same container twice', () => {
      assert.equal(afterSecond, renders.length);
    });

    /*
      The newsletter widget renders itself with an options object and carries
      no data-* callbacks, so the assertions above never exercise the OTHER
      path: renderPendingWidgets reading `data-callback` and friends off a
      `.cf-turnstile` container and resolving those names as window globals.
      That is the path the contact form would use if it were re-enabled, so it
      must not rot while the form is switched off.

      Inject exactly the container that component ships and fire the
      astro:page-load sweep the renderer listens on.
    */
    const attributeRender = await page.evaluate(async () => {
      window.onTurnstileSuccess = () => {};
      window.onTurnstileError = () => {};
      window.onTurnstileExpired = () => {};

      const el = document.createElement('div');
      el.className = 'cf-turnstile';
      el.setAttribute('data-sitekey', 'test-site-key');
      el.setAttribute('data-size', 'flexible');
      el.setAttribute('data-callback', 'onTurnstileSuccess');
      el.setAttribute('data-error-callback', 'onTurnstileError');
      el.setAttribute('data-expired-callback', 'onTurnstileExpired');
      document.body.appendChild(el);

      document.dispatchEvent(new Event('astro:page-load'));
      await new Promise((r) => setTimeout(r, 200));

      return window.__tsRenders.find((r) => (r.elementClass || '').includes('cf-turnstile'));
    });

    check('the renderer wires data-* callbacks through as window globals', () => {
      assert.ok(attributeRender, 'the injected .cf-turnstile container was never rendered');
      assert.equal(attributeRender.sitekey, 'test-site-key');
      assert.equal(attributeRender.hasCallback, true, 'success callback not passed');
      assert.equal(attributeRender.hasErrorCallback, true, 'error callback not passed');
      assert.equal(attributeRender.hasExpiredCallback, true, 'expired callback not passed');
    });


    await page.close();

    // ─── 4. Widgets still mount after a client-side navigation ────────────
    /*
      This is the bug the implicit renderer had and never fixed: its scan runs
      once, at script load, so a ClientRouter navigation left a fresh, empty
      container behind. Deferring the load would have made that permanent, so
      the explicit re-render on astro:page-load is load-bearing.
    */
    const nav = await newInstrumentedPage(browser);
    await nav.page.setViewport({ width: 390, height: 844 });
    await nav.page.goto('http://localhost:4321/', { waitUntil: 'networkidle0' });

    await nav.page.evaluate(() => {
      document.querySelector('#newsletter-form input[type=email]').focus();
    });
    await nav.page.waitForFunction(() => document.querySelectorAll('[data-stub-widget]').length > 0, {
      timeout: 5000,
    });

    const navigated = await nav.page.evaluate(async () => {
      const link = Array.from(document.querySelectorAll('a[href]')).find((a) => {
        const href = a.getAttribute('href') || '';
        return href.startsWith('/') && !href.startsWith('//') && href !== '/' && !href.includes('#');
      });
      if (!link) return null;
      link.click();
      return link.getAttribute('href');
    });

    if (navigated) {
      await nav.page.waitForFunction(
        (from) => window.location.pathname !== from,
        { timeout: 8000 },
        '/',
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));

      const afterNav = await nav.page.evaluate(() => ({
        containers: document.querySelectorAll('.cf-turnstile').length,
        rendered: document.querySelectorAll('[data-stub-widget]').length,
        requests: null,
      }));

      check(`after navigating to ${navigated}, every container is still rendered`, () => {
        if (afterNav.containers === 0) return; // that page has no form; nothing to assert
        assert.ok(
          afterNav.rendered >= afterNav.containers,
          `${afterNav.containers} container(s) but only ${afterNav.rendered} rendered — ` +
            'the astro:page-load re-render did not run',
        );
      });

      check('the script is not re-requested after navigation', () => {
        assert.equal(nav.requests.length, 1, `expected 1 request, got ${nav.requests.length}`);
      });
    } else {
      console.log('  (no internal link found to exercise ClientRouter — skipped)');
    }

    await nav.page.close();

    /*
      ─── A WIDGET THAT RENDERS BUT NEVER DRAWS ─────────────────────────────

      turnstile.render() returning an id does not mean the reader can see
      anything. A site key scoped to the production hostname refuses to draw
      on a preview deploy, silently — confirmed against the real site, which
      works on beunconventionalhq.com and fails on *.workers.dev. A sustained
      429 on the challenge endpoint looks identical.

      Before this, that state told the reader to "complete the verification
      challenge above" while pointing at empty space. This drives exactly that
      condition — a stub that accepts render() and draws nothing — and asserts
      the form says something true and offers a way out instead.
    */
    console.log('Widget renders but never draws...');
    const blind = await browser.newPage();
    await blind.setViewport({ width: 390, height: 844 });
    await blind.setRequestInterception(true);
    blind.on('request', (req) => {
      const url = req.url();
      if (!url.includes(TURNSTILE_HOST)) {
        req.continue().catch(() => {});
        return;
      }
      const onload = new URL(url).searchParams.get('onload') || '';
      // Accepts render(), returns an id, and deliberately draws NO iframe.
      req
        .respond({
          status: 200,
          contentType: 'application/javascript',
          body: `
            window.turnstile = {
              render: function () { return 'never-draws-1'; },
              getResponse: function () { return ''; },
              reset: function () {},
              remove: function () {},
            };
            if (typeof window[${JSON.stringify(onload)}] === 'function') window[${JSON.stringify(onload)}]();
          `,
        })
        .catch(() => {});
    });

    await blind.goto('http://localhost:4321/', { waitUntil: 'networkidle0' });
    await blind.evaluate(() => {
      document.querySelector('#newsletter-form input[type=email]').focus();
    });
    await new Promise((r) => setTimeout(r, 600));

    await blind.evaluate(() => {
      const input = document.querySelector('#newsletter-form input[type=email]');
      input.value = 'reader@example.com';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await blind.evaluate(() => {
      document.querySelector('.newsletter-submit').click();
    });
    await new Promise((r) => setTimeout(r, 500));

    const blindState = await blind.evaluate(() => ({
      message: document.getElementById('newsletter-status').textContent.trim(),
      isError: document.getElementById('newsletter-form').classList.contains('is-error'),
      hasIframe: !!document.querySelector('#newsletter-turnstile iframe'),
    }));

    check('an undrawn widget does not claim there is a challenge to complete', () => {
      assert.equal(blindState.hasIframe, false, 'precondition: the stub must draw nothing');
      assert.ok(
        !/complete the verification challenge/i.test(blindState.message),
        `told the reader to complete a challenge that is not on screen: "${blindState.message}"`,
      );
    });

    check('...and says what is actually wrong, with a way out', () => {
      assert.equal(blindState.isError, true, 'should be in the error state');
      assert.match(
        blindState.message,
        /bot check/i,
        `expected an honest bot-check message, got: "${blindState.message}"`,
      );
      assert.match(blindState.message, /substack/i, 'should offer the Substack fallback');
    });

    await blind.close();

    console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
    if (failed > 0) exitCode = 1;
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
