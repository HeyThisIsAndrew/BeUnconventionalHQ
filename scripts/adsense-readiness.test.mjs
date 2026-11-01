/*
  AdSense readiness: what Google reviews before approving a site, and what has
  to be true before ads can run. Offline; pages are read as source.

  The publisher ID lives in ONE place, site.adsensePublisherId
  (src/data/site.js). Setting it emits Google's verification tag and the
  ads.txt seller line; nothing else has to change to connect the account.
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adsTxt } from '../src/pages/ads.txt.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    failed += 1;
  }
}

console.log('\nAdSense readiness');

test('the privacy policy makes the disclosures AdSense requires', () => {
  const privacy = read('src', 'pages', 'privacy.astro');
  assert.match(privacy, /<h2>Advertising<\/h2>/, 'no Advertising section');
  assert.match(privacy, /Third-party vendors, including Google, use cookies to serve ads based on your prior visits/,
    'the third-party vendor cookie disclosure is missing');
  assert.match(privacy, /Google's use of advertising cookies enables it and its partners/,
    'the Google advertising cookie disclosure is missing');
  assert.match(privacy, /href="https:\/\/adssettings\.google\.com"/, 'no link to opt out in Ads Settings');
  assert.match(privacy, /href="https:\/\/www\.aboutads\.info\/choices"/, 'no third-party vendor opt-out link');
  assert.match(privacy, /href="https:\/\/policies\.google\.com\/technologies\/partner-sites"/,
    'no link to how Google uses data from partner sites');
});

test('the ethics policy states the press kit\'s editorial standards, word for word', () => {
  const kit = read('src', 'pages', 'collaborations', 'press-kit.astro');
  const block = kit.slice(kit.indexOf('EDITORIAL STANDARDS'), kit.indexOf('</ul>', kit.indexOf('EDITORIAL STANDARDS')));
  const standards = [...block.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].trim());
  assert.equal(standards.length, 5, `expected the press kit's five standards, found ${standards.length}`);
  const ethics = read('src', 'pages', 'ethics.astro');
  for (const standard of standards) {
    assert.ok(ethics.includes(`'${standard}'`), `the ethics policy no longer states "${standard}"`);
  }
});

test('the ethics policy keeps advertising separate from editorial', () => {
  const ethics = read('src', 'pages', 'ethics.astro');
  assert.match(ethics, /<h2>Advertising<\/h2>/);
  assert.match(ethics, /href="\/privacy"/, 'the ethics page should point to the privacy policy for ad cookies');
});

test('both policy pages are linked from every page, in the footer', () => {
  const footer = read('src', 'components', 'Footer.astro');
  assert.match(footer, /<a href="\/privacy" class="footer-privacy-link">Privacy Policy<\/a>/);
  assert.match(footer, /<a href="\/ethics" class="footer-privacy-link">Ethics Policy<\/a>/);
  assert.match(footer, /Privacy Policy<\/a>\s*<span class="footer-legal-sep" aria-hidden="true">\|<\/span>\s*<a href="\/ethics"/,
    'the two policy links are separated by a pipe');
});

test('ads.txt authorises nobody until a publisher ID is set', () => {
  for (const id of ['', '   ', 'not-an-id', 'pub-12', undefined]) {
    const body = adsTxt(id);
    assert.ok(body.split('\n').every((line) => line === '' || line.startsWith('#')),
      `ads.txt for ${JSON.stringify(id)} must be comments only, got: ${body}`);
  }
});

test('ads.txt carries Google\'s exact line once the ID is set, either form', () => {
  const line = 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n';
  assert.equal(adsTxt('ca-pub-1234567890123456'), line, 'the ID as AdSense shows it');
  assert.equal(adsTxt('pub-1234567890123456'), line, 'and without the ca- prefix');
});

test('the verification tag is emitted only from the one setting', () => {
  const site = read('src', 'data', 'site.js');
  assert.match(site, /adsensePublisherId: '[^']*'/, 'site.adsensePublisherId is missing');
  const layout = read('src', 'layouts', 'Layout.astro');
  assert.match(layout,
    /\{site\.adsensePublisherId && <meta name="google-adsense-account" content=\{site\.adsensePublisherId\} \/>\}/,
    'Layout must emit the AdSense verification tag from site.adsensePublisherId, and only when it is set');
});

test('the site CSP lets Google\'s ad and consent scripts run, and nothing else changed', () => {
  // Without these, the AdSense script is blocked silently once it is added.
  const headers = read('public', '_headers');
  const policy = headers.split('\n').find((line) => /^\s*Content-Security-Policy:/.test(line));
  assert.ok(policy, 'no Content-Security-Policy line in public/_headers');
  const directive = (name) => (policy.match(new RegExp(`${name} ([^;]*)`)) || [])[1] || '';
  for (const host of ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com', 'https://*.doubleclick.net']) {
    assert.ok(directive('script-src').includes(host), `script-src is missing ${host}`);
  }
  for (const host of ['https://googleads.g.doubleclick.net', 'https://*.googlesyndication.com', 'https://fundingchoicesmessages.google.com']) {
    assert.ok(directive('frame-src').includes(host), `frame-src is missing ${host}`);
  }
  assert.ok(directive('connect-src').includes('https://pagead2.googlesyndication.com'), 'connect-src is missing pagead2');
  assert.ok(!/\bdata:/.test(directive('script-src')), 'script-src must never allow data:');
  assert.match(policy, /frame-ancestors 'self'/, 'frame-ancestors must stay self');
  assert.match(policy, /object-src 'none'/, 'object-src must stay none');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
