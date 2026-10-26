import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signAutomationRequest, verifyAutomationRequest } from '../src/lib/automation-auth.mjs';
import { handleAutomationRequest } from '../src/lib/automation-gateway.ts';
import { parseWatchFeed, watchSubstack, callGateway } from './substack-watcher.mjs';
import relay, { ArticleSource } from './substack-relay.mjs';

const SECRET = 'offline-test-secret';
const NOW = Date.parse('2026-10-26T19:00:00Z');
const article = (id = 'first') => ({ guid: id, title: `Article ${id}`, url: `https://beunconventionalhq.substack.com/p/${id}`, publishedAt: '2026-10-26T18:00:00.000Z' });
const feed = ids => `<rss><channel>${ids.map(id => `<item><title>Article ${id}</title><link>https://beunconventionalhq.substack.com/p/${id}</link><guid isPermaLink="false">${id}</guid><pubDate>Mon, 26 Oct 2026 18:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const storage = () => {
  const values = new Map();
  return { values, get: async key => values.get(key), put: async (key, value) => { values.set(key, value); } };
};
async function signed(payload, { secret = SECRET, now = NOW, signBody } = {}) {
  const body = JSON.stringify(payload);
  return new Request('https://hq.test/api/automation', { method: 'POST', headers: await signAutomationRequest(secret, signBody ?? body, now), body });
}

test('HMAC verifies exact bodies and rejects tampering, expiry, wrong secrets and unsigned requests', async () => {
  const body = JSON.stringify({ action: 'dispatch' });
  const request = await signed({ action: 'dispatch' });
  assert.equal(await verifyAutomationRequest(request, body, SECRET, NOW), true);
  assert.equal(await verifyAutomationRequest(request, `${body} `, SECRET, NOW), false);
  assert.equal(await verifyAutomationRequest(request, body, 'other-secret', NOW), false);
  assert.equal(await verifyAutomationRequest(request, body, SECRET, NOW + 301000), false);
  assert.equal(await verifyAutomationRequest(new Request('https://hq.test'), body, SECRET, NOW), false);
});

test('gateway dispatches only validated Substack metadata to the fixed HQ repository', async () => {
  const payload = { action: 'dispatch', articles: [article()] };
  let sent;
  const result = await handleAutomationRequest(await signed(payload), { WEBSUB_SECRET: SECRET, GITHUB_DISPATCH_TOKEN: 'test-token' }, {
    now: NOW, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/HeyThisIsAndrew/BeUnconventionalHQ/dispatches');
      sent = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(sent, { event_type: 'content-published', client_payload: { source: 'substack', articles: [article()] } });
  for (const invalid of [[], [{ ...article(), url: 'https://evil.test/p/x' }], [{ ...article(), guid: '' }]]) {
    const response = await handleAutomationRequest(await signed({ action: 'dispatch', articles: invalid }), { WEBSUB_SECRET: SECRET }, { now: NOW, fetchImpl: async () => { throw new Error('must not dispatch'); } });
    assert.equal(response.status, 400);
  }
});

test('unsigned, expired and malformed gateway calls cannot send email or dispatch GitHub', async () => {
  for (const request of [
    new Request('https://hq.test/api/automation', { method: 'POST', body: '{}' }),
    await signed({ action: 'dispatch' }, { now: NOW - 400000 }),
    await signed({ action: 'notify' }, { signBody: '{}' }),
  ]) {
    const result = await handleAutomationRequest(request, { WEBSUB_SECRET: SECRET }, { now: NOW, fetchImpl: async () => { throw new Error('must not send'); } });
    assert.equal(result.status, 403);
  }
});

test('gateway dry run creates nothing; real upstream failures are reported', async () => {
  const payload = { action: 'dispatch', dryRun: true, articles: [article()] };
  const result = await handleAutomationRequest(await signed(payload), { WEBSUB_SECRET: SECRET }, { now: NOW, fetchImpl: async () => { throw new Error('dry run sent a request'); } });
  assert.equal(result.status, 200);
  const failed = await handleAutomationRequest(await signed({ ...payload, dryRun: false }), { WEBSUB_SECRET: SECRET, GITHUB_DISPATCH_TOKEN: 'test' }, { now: NOW, fetchImpl: async () => new Response(null, { status: 401 }) });
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /HTTP 401/);
});

test('alerts use the editorial inbox, plain text and a stable idempotency key', async () => {
  let sent;
  const result = await handleAutomationRequest(await signed({ action: 'notify', message: '<script>plain text only</script>', incidentId: 'fixture-1', test: true }), { WEBSUB_SECRET: SECRET, RESEND_API_KEY: 'offline-key' }, {
    now: NOW, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(options.headers['Idempotency-Key'], 'hq-watcher-fixture-1');
      sent = JSON.parse(options.body);
      return Response.json({ id: 'fake-email' });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(sent.to, 'press@beunconventionalhq.com');
  assert.equal(sent.html, undefined);
  assert.match(sent.subject, /test failure alert/);
});

test('GitHub alert channel creates only the dedicated failure-report workflow', async () => {
  const payload = { action: 'notify', channel: 'github', message: 'Forced offline test', incidentId: 'fixture', test: true };
  const response = await handleAutomationRequest(await signed(payload), { WEBSUB_SECRET: SECRET, GITHUB_DISPATCH_TOKEN: 'fixture' }, {
    now: NOW, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/HeyThisIsAndrew/BeUnconventionalHQ/actions/workflows/automation-alert.yml/dispatches');
      assert.deepEqual(JSON.parse(options.body), { ref: 'main', inputs: { message: payload.message, test: 'true' } });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(response.status, 200);
});

test('feed parsing requires public article identities, titles and dates', () => {
  assert.deepEqual(parseWatchFeed(feed(['first'])), [article()]);
  for (const invalid of ['<title>Blocked</title>', '<rss><channel/></rss>', feed(['first']).replace('beunconventionalhq.substack.com/p/first', 'evil.test/p/first'), feed(['first']).replace('Mon, 26 Oct 2026 18:00:00 GMT', 'bad')]) {
    assert.throws(() => parseWatchFeed(invalid));
  }
});

test('first run seeds without dispatching; unchanged/reordered feeds never dispatch twice', async () => {
  const state = storage();
  let dispatches = 0;
  let requests = 0;
  const options = { storage: state, requestFeed: async () => { requests++; return feed(['first', 'second']); }, refreshSource: async () => {}, dispatch: async () => { dispatches++; }, notify: async () => {}, now: NOW };
  assert.equal((await watchSubstack(options)).action, 'seeded');
  assert.equal((await watchSubstack(options)).action, 'unchanged');
  assert.equal((await watchSubstack({ ...options, requestFeed: async () => feed(['second', 'first']) })).action, 'unchanged');
  assert.equal(dispatches, 0);
  assert.equal(requests, 2, 'one RSS request per normal tick');
});

test('new articles warm the source before one dispatch; failed dispatches remain retryable', async () => {
  const state = storage();
  const order = [];
  const options = { storage: state, requestFeed: async () => feed(['first']), refreshSource: async () => { order.push('refresh'); }, dispatch: async articles => { order.push('dispatch'); assert.deepEqual(articles.map(a => a.guid), ['new']); }, notify: async () => {}, now: NOW };
  await watchSubstack(options);
  const fresh = { ...options, requestFeed: async () => feed(['new', 'first']) };
  assert.equal((await watchSubstack(fresh)).action, 'dispatched');
  assert.deepEqual(order, ['refresh', 'dispatch']);
  assert.equal((await watchSubstack(fresh)).action, 'unchanged');
  const failing = { ...fresh, requestFeed: async () => feed(['newer', 'new', 'first']), dispatch: async () => { throw new Error('GitHub HTTP 401'); } };
  assert.equal((await watchSubstack(failing)).ok, false);
  assert.ok(!state.values.get('watcher:published:v1').seen.includes('newer'));
  let retry = 0;
  assert.equal((await watchSubstack({ ...failing, dispatch: async () => { retry++; } })).ok, true);
  assert.equal(retry, 1);
});

test('dry runs change no state, create no dispatch and send no alert, including forced failures', async () => {
  const state = storage();
  const options = { storage: state, requestFeed: async () => feed(['first']), refreshSource: async () => { throw new Error('must not refresh'); }, dispatch: async () => { throw new Error('must not dispatch'); }, notify: async () => { throw new Error('must not alert'); }, now: NOW, dryRun: true };
  assert.equal((await watchSubstack(options)).action, 'would-seed');
  assert.equal(state.values.size, 0);
  assert.equal((await watchSubstack({ ...options, forceFailure: true })).alerted, false);
  assert.equal(state.values.size, 0);
});

test('failed polling alerts once per incident hour and never advances the content baseline', async () => {
  const state = storage();
  let alerts = 0;
  const options = { storage: state, requestFeed: async () => { throw new Error('RSS HTTP 429'); }, refreshSource: async () => {}, dispatch: async () => {}, notify: async () => { alerts++; }, now: NOW };
  assert.equal((await watchSubstack(options)).alerted, true);
  assert.equal((await watchSubstack(options)).alerted, false);
  assert.equal((await watchSubstack({ ...options, now: NOW + 3600001 })).alerted, true);
  assert.equal(alerts, 2);
  assert.equal(state.values.has('watcher:published:v1'), false);
});

test('private object serializes overlapping ticks; public poll requires authentication', async () => {
  let feeds = 0;
  const state = storage();
  const source = new ArticleSource({ storage: state }, { FETCH_UPSTREAM: async () => { feeds++; await new Promise(resolve => setTimeout(resolve, 10)); return new Response(feed(['first'])); } });
  const responses = await Promise.all(Array.from({ length: 5 }, () => source.fetch(new Request('https://article-source.internal/poll', { method: 'POST', body: '{}' }))));
  for (const response of responses) assert.equal((await response.json()).action, 'seeded');
  assert.equal(feeds, 1);
  const env = { WEBSUB_SECRET: SECRET, ARTICLE_SOURCE: { idFromName: () => 'one', get: () => ({ fetch: async () => { throw new Error('unauthorized poll reached object'); } }) } };
  assert.equal((await relay.fetch(new Request('https://relay.test/poll', { method: 'POST', body: '{}' }), env)).status, 403);
});

test('gateway calls use a private service binding with valid authentication', async () => {
  const payload = { action: 'dispatch', articles: [article()] };
  const result = await callGateway({ WEBSUB_SECRET: SECRET, HQ_SITE: { fetch: async request => {
    const body = await request.text();
    assert.equal(await verifyAutomationRequest(request, body, SECRET), true);
    assert.deepEqual(JSON.parse(body), payload);
    return Response.json({ ok: true });
  } } }, payload);
  assert.deepEqual(result, { ok: true });
});
