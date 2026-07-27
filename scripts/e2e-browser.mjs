/**
 * Shared Puppeteer launcher for the e2e suites.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Every e2e file used to call `puppeteer.launch({ headless: true })` itself.
 * Seven identical calls, and any flag that turned out to be necessary had to
 * be added to all seven — which is exactly what went wrong: Chrome refuses to
 * start as root without `--no-sandbox`, so the suites ran fine on a laptop and
 * died immediately in a container. One launcher, one place to fix it.
 *
 * ─── ABOUT --no-sandbox ───────────────────────────────────────────────────
 * Chrome's sandbox is a real security boundary and this deliberately keeps it
 * ON wherever it can run. It is disabled only when the process is running as
 * uid 0, where Chrome will not start with the sandbox at all. That case is a
 * CI container loading pages from our own local build — no untrusted content
 * is involved.
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────
 *     import { launchTestBrowser } from './e2e-browser.mjs';
 *     const browser = await launchTestBrowser();
 */
import puppeteer from 'puppeteer';

/** True when the suite is running as root (containers, most CI images). */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * Launch a headless Chrome for an e2e suite.
 *
 * @param {import('puppeteer').LaunchOptions} [options] merged over the
 *        defaults; `args` are concatenated rather than replaced, so a caller
 *        adding a flag never silently drops the sandbox handling above.
 */
export async function launchTestBrowser(options = {}) {
  const { args = [], ...rest } = options;
  return puppeteer.launch({
    headless: true,
    args: [...(isRoot ? ['--no-sandbox'] : []), ...args],
    ...rest,
  });
}
