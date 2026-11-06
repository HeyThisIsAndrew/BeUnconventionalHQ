/**
 * Newsletter topics on the site: signed preference links, Kit calls, and the
 * wiring of the signup form and /newsletter (src/lib/newsletter-prefs.ts,
 * src/actions/index.ts, NewsletterForm.astro, src/pages/newsletter.astro).
 * Offline: Kit is a fake. Runbook: scripts/hq-dispatch.md.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 *   1. Knowing an address is not enough to change its topics or unsubscribe
 *      it: the link is signed, expires, and is bound to one address.
 *   2. Kit receives topics in its custom field, in canonical form, and a new
 *      signup is added to the Kit form (Kit's confirmation email) only when
 *      configured.
 *   3. The signup form asks for topics inline, all on by default, and the
 *      preference page is gated like the other utility routes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  signPrefsToken, verifyPrefsToken, prefsLink, saveKitTopics, unsubscribeKit, findKitSubscriber, topicsOf, prefsEmail, LINK_TTL_HOURS,
} from '../src/lib/newsletter-prefs.ts';

const SECRET = 'test-secret-0123456789';
const NOW = Date.parse('2026-11-01T12:00:00Z');

test('a signed link opens for its own address, and only until it expires', async () => {
  const token = await signPrefsToken(SECRET, ' Reader@Example.com ', NOW);
  assert.equal(await verifyPrefsToken(SECRET, token, NOW), 'reader@example.com');
  assert.equal(await verifyPrefsToken(SECRET, token, NOW + (LINK_TTL_HOURS - 1) * 3600e3), 'reader@example.com');
  assert.equal(await verifyPrefsToken(SECRET, token, NOW + (LINK_TTL_HOURS + 1) * 3600e3), null, 'expired');
  assert.equal(await verifyPrefsToken('other-secret-0123456789', token, NOW), null, 'wrong secret');
});

test('a tampered link opens nothing: another address, a longer life, garbage', async () => {
  const token = await signPrefsToken(SECRET, 'reader@example.com', NOW);
  const [, sig] = token.split('.');
  const forge = (payload) => `${Buffer.from(payload).toString('base64url')}.${sig}`;
  const expires = Math.floor(NOW / 1000) + LINK_TTL_HOURS * 3600;
  assert.equal(await verifyPrefsToken(SECRET, forge(`victim@example.com\n${expires}`), NOW), null);
  assert.equal(await verifyPrefsToken(SECRET, forge(`reader@example.com\n${expires + 99999}`), NOW), null);
  for (const bad of ['', 'abc', 'a.b', `${token}x`, 'x'.repeat(700)]) assert.equal(await verifyPrefsToken(SECRET, bad, NOW), null, bad.slice(0, 10));
  await assert.rejects(signPrefsToken('', 'a@b.c'), /secret/);
  assert.equal(prefsLink('https://beunconventionalhq.com/', 'a.b'), 'https://beunconventionalhq.com/newsletter?t=a.b');
});

function fakeKit(subscribers = []) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, key: init.headers['X-Kit-Api-Key'] });
    if (init.method === 'GET') return Response.json({ subscribers: subscribers.filter((s) => s.email_address === u.searchParams.get('email_address')) });
    return Response.json({ ok: true });
  };
  return { calls, fetchImpl };
}

test("Kit gets topics without ever skipping its confirmation: new readers go in inactive, through the form", async () => {
  const kit = fakeKit();
  const status = await saveKitTopics({ apiKey: 'k', field: 'hq_topics', formId: '123' }, 'Reader@Example.com', ['tv', 'film'], { addToForm: true, fetchImpl: kit.fetchImpl });
  assert.equal(status, 'invited');
  assert.deepEqual(kit.calls.map((c) => [c.method, c.path]), [['GET', '/v4/subscribers'], ['POST', '/v4/subscribers'], ['POST', '/v4/forms/123/subscribers']]);
  assert.deepEqual(kit.calls[1].body, { email_address: 'reader@example.com', state: 'inactive', fields: { hq_topics: 'film,tv' } });
  assert.equal(kit.calls[1].key, 'k');
  // No form configured: a new reader is not created in Kit at all.
  const noForm = fakeKit();
  assert.equal(await saveKitTopics({ apiKey: 'k' }, 'a@b.c', ['games'], { addToForm: true, fetchImpl: noForm.fetchImpl }), 'skipped');
  assert.deepEqual(noForm.calls.map((c) => c.method), ['GET']);
});

test('a reader Kit already has: only the topics field changes, their state is never touched', async () => {
  const kit = fakeKit([{ id: 55, email_address: 'old@example.com', state: 'active', fields: { hq_topics: '' } }]);
  const status = await saveKitTopics({ apiKey: 'k', formId: '123' }, 'old@example.com', ['games'], { addToForm: true, fetchImpl: kit.fetchImpl });
  assert.equal(status, 'updated');
  assert.deepEqual(kit.calls.map((c) => [c.method, c.path]), [['GET', '/v4/subscribers'], ['PUT', '/v4/subscribers/55']]);
  assert.deepEqual(kit.calls[1].body, { fields: { hq_topics: 'games' } });
});

test('reading and unsubscribing go through the subscriber Kit has for the address', async () => {
  const kit = fakeKit([{ id: 77, email_address: 'reader@example.com', fields: { hq_topics: 'games,events' } }]);
  const sub = await findKitSubscriber({ apiKey: 'k' }, 'READER@example.com', kit.fetchImpl);
  assert.deepEqual(topicsOf(sub), ['games', 'events']);
  assert.deepEqual(topicsOf({ fields: { hq_topics: '' } }), ['film', 'tv', 'games', 'events'], 'empty field = everything');
  assert.equal(await unsubscribeKit({ apiKey: 'k' }, 'reader@example.com', kit.fetchImpl), true);
  assert.deepEqual(kit.calls.at(-1), { method: 'POST', path: '/v4/subscribers/77/unsubscribe', query: {}, body: {}, key: 'k' });
  assert.equal(await unsubscribeKit({ apiKey: 'k' }, 'nobody@example.com', kit.fetchImpl), false);
});

test('the link email carries the link and says what happens if it was not asked for', () => {
  const mail = prefsEmail('https://beunconventionalhq.com/newsletter?t=a.b');
  assert.match(mail.text, /newsletter\?t=a\.b/);
  assert.match(mail.text, /ignore this email and nothing changes/);
  assert.doesNotMatch(mail.text + mail.html, /—/);
});

test('wiring: inline topic toggles on signup, actions validate topics, /newsletter gated', () => {
  const form = readFileSync(new URL('../src/components/NewsletterForm.astro', import.meta.url), 'utf8');
  const topicsUi = readFileSync(new URL('../src/components/NewsletterTopics.astro', import.meta.url), 'utf8');
  assert.match(form, /<NewsletterTopics variant="modal" \/>/, 'the signup box keeps its size: the cards open in a dialog');
  assert.match(form, /\{!onPage && <button type="button" class="nl-hq-header nl-one-line nl-topics-link/, 'the box keeps its one trigger');
  assert.match(topicsUi, /<dialog class="nl-dialog"/);
  assert.match(topicsUi, /lockScroll\(\)/, 'the page behind locks through the one scroll lock');
  assert.match(topicsUi, /type="checkbox" name="topics" value=\{topic\} checked/);
  const content = readFileSync(new URL('../src/data/content.js', import.meta.url), 'utf8');
  assert.match(content, /newsletterTopicsTrigger: 'Choose what lands in your inbox'/, 'the trigger IS the descriptive sentence');
  // ONE trigger in the box (owner's call), and no paragraph re-explaining it.
  assert.equal((form.match(/<button[^>]*data-nl-open/g) ?? []).length, 1);
  assert.doesNotMatch(topicsUi, /<button[^>]*data-nl-open/, 'no second trigger from the component');
  assert.match(form, /\{MESSAGES\.newsletterTopicsTrigger\}/);
  assert.doesNotMatch(form + topicsUi, /Choosing topics changes|featured story for everyone|You'll get|Your topics:|Choose topics</, 'no repeated explanations');
  // The dialog: heading, tiles, one action, and the site's plain X.
  assert.match(topicsUi, /<button type="button" class="nl-dialog-x" data-nl-x aria-label="Close">&times;<\/button>/);
  assert.doesNotMatch(topicsUi, />\s*Close\s*</, 'no worded CLOSE box');
  assert.match(topicsUi, /class="nl-hq-header nl-one-line nl-dialog-title"/);
  assert.match(form, /class="nl-hq-header nl-one-line nl-topics-link/);
  assert.match(topicsUi, /data-nl-short aria-live="polite"/, 'the Selected line updates and is announced');
  assert.match(form, /topics,\n\s*\}\);/, 'the toggles reach actions.subscribe');
  const prefsPage = readFileSync(new URL('../src/pages/newsletter.astro', import.meta.url), 'utf8');
  // /newsletter (owner's final layout, 2026-11-01): masthead, subtitle,
  // the box's own form (email + SUBSCRIBE always visible), the topics in a
  // collapsed strip, the Selected line under it, the spam line centred,
  // then "Already subscribed?" in a second, independent strip.
  assert.match(prefsPage, /<NewsletterForm layout="page" \/>/, 'the same subscribe form and action as the box');
  assert.ok(prefsPage.indexOf('<NewsletterForm layout="page"') < prefsPage.indexOf('class="nl-acc prefs-accordion"'), 'subscribe first, the existing-subscriber strip last');
  assert.match(form, /<NewsletterTopics variant="accordion" id="prefs-topics" \/>/, 'page layout: the tiles live in the topics strip');
  assert.match(form, /<div class="newsletter-row">[\s\S]*?class="cta-button-primary newsletter-submit"[\s\S]*?<\/div>/, 'SUBSCRIBE sits with the email field, outside any strip');
  const acc = topicsUi.slice(topicsUi.indexOf('<div class="nl-acc nl-topics-accordion"'));
  assert.match(acc, /<div class="accordion-section collapsed" data-nl-accordion>/, 'closed by default');
  assert.match(acc, /<span class="accordion-chevron" aria-hidden="true"><\/span>/);
  assert.ok(acc.indexOf('data-nl-short') > acc.indexOf('</fieldset>'), 'the Selected line sits under the strip, outside its body');
  assert.match(topicsUi, /\[data-nl-accordion\]'\)\.forEach\(bindAccordion\)/);
  const accLib = readFileSync(new URL('../src/lib/nl-accordion.ts', import.meta.url), 'utf8');
  assert.match(accLib, /setAccordion\(section, !section\.classList\.contains\('expanded'\)\)/, 'each strip toggles itself only');
  assert.doesNotMatch(accLib, /querySelectorAll/, 'opening one strip never touches another');
  assert.match(form, /if \(form\.dataset\.prefsToken\) return;/, 'after a signed link, the subscribe handler stands aside');
  assert.match(prefsPage, /textContent = 'Save'/);
  assert.match(prefsPage, /setAccordion\(topicsStrip, true\)/, 'a signed link opens the topics strip');
  assert.doesNotMatch(topicsUi, /disabled=\{|is-preview|preview\?:/, 'no preview-only tiles anywhere');
  assert.doesNotMatch(prefsPage, /<NewsletterTopics|href="\/#subscribe"|Preview only/, 'no second copy of the tiles, no send-away link');
  assert.match(form, /\{MESSAGES\.newsletterFineprint\}/, 'the spam line, same words');
  assert.equal((prefsPage.match(/ data-nl-accordion>/g) ?? []).length, 1, 'one existing-subscriber strip');
  assert.match(prefsPage, /<h2 class="accordion-heading">\s*<button type="button" class="accordion-header" aria-expanded="false" aria-controls="prefs-panel">/);
  assert.match(prefsPage, />Already subscribed\? Change topics or unsubscribe</);
  assert.match(prefsPage, /There is no login, so we email you a link that proves the address is yours/);
  // The detail block: label, colon, value, one per line, values from code.
  assert.match(prefsPage, /<dt>From:<\/dt><dd class="prefs-keep">\{LINK_SENDER\}<\/dd>/);
  assert.match(prefsPage, /<dt>Subject:<\/dt><dd>\{LINK_SUBJECT\}<\/dd>/);
  assert.match(prefsPage, /<dt>Link valid:<\/dt><dd class="prefs-keep">\{LINK_TTL_HOURS\} hours<\/dd>/);
  assert.match(prefsPage, /If that address never subscribed, no email is sent\./);
  assert.match(prefsPage, /Link expired\? Ask for a new one with the form above\./);
  assert.match(prefsPage, /The Unsubscribe link at the bottom of any issue also works\./);
  // Left-aligned text; only the spam line is centred (newsletter.css).
  assert.doesNotMatch(prefsPage, /text-align:\s*(center|justify)/);
  const nlCss = readFileSync(new URL('../src/styles/modules/newsletter.css', import.meta.url), 'utf8');
  assert.match(nlCss, /\.newsletter-form--page \.newsletter-fineprint \{\n  margin-top: 1rem;\n  text-align: center;/);
  assert.match(nlCss, /\.subscribe-cta \.newsletter-fineprint \{\n  margin-top: var\(--nl-gap\);\n  text-align: center;/);
  assert.doesNotMatch(nlCss, /^\.accordion-/m, 'the accordion rules are scoped under .nl-acc, never bare (they would reach /featured)');
  assert.equal((prefsPage.match(/as="h1"/g) ?? []).length, 1);
  assert.doesNotMatch(prefsPage, /<h1\b/, 'the one h1 is the PageTitle lockup');
  const actions = readFileSync(new URL('../src/actions/index.ts', import.meta.url), 'utf8');
  assert.match(actions, /topics: z\.array\(z\.enum\(TOPICS\)\)/);
  assert.match(actions, /KIT_SYNC_SIGNUPS'\) === 'true'/, 'Kit sync stays off until switched on');
  assert.match(actions, /verifyPrefsToken\(/);
  assert.match(actions, /from: LINK_FROM, to: email/, 'the page and the email name the same sender');
  assert.match(actions, /prefslink:\$\{email\}`, '1', \{ expirationTtl: 600 \}/, 'one link per address per 10 minutes');
  const page = readFileSync(new URL('../src/pages/newsletter.astro', import.meta.url), 'utf8');
  assert.match(page, /<Layout [^>]*noindex/);
  const config = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /'\/newsletter',/);
  const shell = readFileSync(new URL('../email/hq-dispatch/template.html', import.meta.url), 'utf8');
  assert.match(shell, /href="https:\/\/beunconventionalhq\.com\/newsletter\?email=\{\{ subscriber\.email_address \| url_encode \}\}"/);
  assert.match(shell, /\{\{ unsubscribe_url \}\}/, "Kit's one-click unsubscribe stays");
});

test('the KV import: every record read, confirmation required, unsubscribed skipped, dry run writes nothing', async () => {
  const { listKvSubscribers, importSubscribers } = await import('./kv-subscribers-to-kit.mjs');
  const pages = { '': { result: [{ name: 'subscriber:a@x.com' }], result_info: { cursor: 'c2' } }, c2: { result: [{ name: 'subscriber:b@x.com' }, { name: 'subscriber:bad@x.com' }], result_info: { cursor: '' } } };
  const values = {
    'subscriber:a@x.com': JSON.stringify({ email: 'A@x.com', topics: 'film,tv' }),
    'subscriber:b@x.com': JSON.stringify({ email: 'b@x.com', unsubscribedAt: '2026-10-01' }),
    'subscriber:bad@x.com': 'not json',
  };
  const cf = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/keys')) return Response.json(pages[u.searchParams.get('cursor') ?? '']);
    return new Response(values[decodeURIComponent(u.pathname.split('/values/')[1])]);
  };
  const { records, unreadable } = await listKvSubscribers({ token: 't', fetchImpl: cf });
  assert.deepEqual(records.map((r) => r.email), ['a@x.com', 'b@x.com']);
  assert.deepEqual(unreadable, ['subscriber:bad@x.com']);
  await assert.rejects(importSubscribers(records, { apiKey: 'k' }), /KIT_FORM_ID is required/);
  const kit = fakeKit();
  const dry = await importSubscribers(records, { apiKey: 'k', formId: '9' }, { fetchImpl: kit.fetchImpl, sleep: async () => {} });
  assert.equal(kit.calls.length, 0, 'a dry run calls nothing');
  assert.deepEqual(dry.imported.map((r) => [r.email, r.topics.join(',')]), [['a@x.com', 'film,tv']]);
  assert.deepEqual(dry.skipped, [{ email: 'b@x.com', why: 'unsubscribed' }]);
  const live = await importSubscribers(records, { apiKey: 'k', formId: '9' }, { execute: true, fetchImpl: kit.fetchImpl, sleep: async () => {} });
  assert.equal(live.imported.length, 1);
  assert.deepEqual(kit.calls.map((c) => `${c.method} ${c.path}`), ['GET /v4/subscribers', 'POST /v4/subscribers', 'POST /v4/forms/9/subscribers'], "through the form: Kit's confirmation email");
  assert.equal(kit.calls[1].body.state, 'inactive');
});

test('the Selected line names topics in uppercase, like the tiles', () => {
  const src = readFileSync(new URL('../src/components/NewsletterTopics.astro', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('const LABELS'), src.indexOf('/** The video modal'));
  const js = fn.replace(/: Record<string, string>/g, '').replace(/(\w+): string\[\]/g, '$1').replace(/\): string \{/g, ') {');
  const shortLine = new Function(`${js}; return shortLine;`)();
  assert.equal(shortLine(['film', 'tv', 'games', 'events']), 'Selected: FILM, TV, GAMES, EVENTS.');
  assert.equal(shortLine([]), 'Selected: none, which means all four.');
  assert.equal(shortLine(['film', 'tv']), 'Selected: FILM, TV.');
});

test("the dialog's X: the video modal's X for colour, size, place and turn, and never a red square", () => {
  const css = (f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
  const rule = (src, selector) => {
    const at = src.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} not found`);
    return Object.fromEntries(src.slice(at, src.indexOf('}', at)).split('{')[1].split(';')
      .map((d) => d.trim()).filter(Boolean).map((d) => [d.split(':')[0].trim(), d.slice(d.indexOf(':') + 1).replace(/\s+/g, ' ').trim()]));
  };
  const theirs = rule(css('modules/modal.css'), '.modal-close');
  const ours = rule(css('modules/newsletter.css'), '.nl-dialog-x');
  for (const prop of ['position', 'top', 'right', 'color', 'font-size', 'line-height', 'padding', 'background', 'border']) assert.equal(ours[prop], theirs[prop], `.nl-dialog-x ${prop}`);
  const newsletter = css('modules/newsletter.css');
  // Hover changes the colour only, and only where hover is real.
  assert.match(newsletter, /@media \(hover: hover\) \{\n  \.nl-dialog-x:hover \{\n    color: var\(--color-accent-text\);\n  \}\n\}/);
  // The turn is the tap's, held while the dialog closes.
  assert.match(newsletter, /\.nl-dialog-x\.is-turning \{\n  color: var\(--color-accent-text\);\n  transform: rotate\(90deg\);/);
  // Keyboard focus: a thin white ring, never the red one the iPhone showed.
  assert.match(newsletter, /\.nl-dialog \.nl-dialog-x:focus-visible \{\n  outline: 1px solid var\(--color-white\);\n  outline-offset: 2px;\n  box-shadow: none;/, 'outranks the homepage crimson ring (.home-v4 :focus-visible)');
  assert.doesNotMatch(newsletter, /\.nl-dialog-x[^{]*\{[^}]*(outline|border|box-shadow): [^;]*accent/, 'no red outline, border or shadow on the X in any state');
  const ui = readFileSync(new URL('../src/components/NewsletterTopics.astro', import.meta.url), 'utf8');
  assert.match(ui, /data-nl-dialog aria-labelledby="nl-dialog-title" tabindex="-1"/);
  assert.match(ui, /dialog\.showModal\(\);\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*dialog\.focus\(\);/, 'first focus goes to the dialog, not the X');
  assert.match(ui, /x\.classList\.add\('is-turning'\)/);
  assert.match(ui, /const X_TURN_MS = 300;/, 'waits for the 0.3s turn');
});
