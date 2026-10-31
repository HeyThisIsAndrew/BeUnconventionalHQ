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

test('Kit gets topics in its custom field, canonical; a new signup joins the form only when configured', async () => {
  const kit = fakeKit();
  await saveKitTopics({ apiKey: 'k', field: 'hq_topics', formId: '123' }, 'Reader@Example.com', ['tv', 'film'], { addToForm: true, fetchImpl: kit.fetchImpl });
  assert.deepEqual(kit.calls.map((c) => [c.method, c.path]), [['POST', '/v4/subscribers'], ['POST', '/v4/forms/123/subscribers']]);
  assert.deepEqual(kit.calls[0].body, { email_address: 'reader@example.com', fields: { hq_topics: 'film,tv' } });
  assert.equal(kit.calls[0].key, 'k');
  const noForm = fakeKit();
  await saveKitTopics({ apiKey: 'k' }, 'a@b.c', ['games'], { addToForm: true, fetchImpl: noForm.fetchImpl });
  assert.equal(noForm.calls.length, 1, 'no KIT_FORM_ID, no form step');
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
  assert.match(form, /type="checkbox" name="topics" value=\{topic\} checked/);
  assert.match(form, /topics,\n\s*\}\);/, 'the toggles reach actions.subscribe');
  const actions = readFileSync(new URL('../src/actions/index.ts', import.meta.url), 'utf8');
  assert.match(actions, /topics: z\.array\(z\.enum\(TOPICS\)\)/);
  assert.match(actions, /KIT_SYNC_SIGNUPS'\) === 'true'/, 'Kit sync stays off until switched on');
  assert.match(actions, /verifyPrefsToken\(/);
  const page = readFileSync(new URL('../src/pages/newsletter.astro', import.meta.url), 'utf8');
  assert.match(page, /<Layout [^>]*noindex/);
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
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
  assert.deepEqual(kit.calls.map((c) => c.path), ['/v4/subscribers', '/v4/forms/9/subscribers'], "through the form: Kit's confirmation email");
});
