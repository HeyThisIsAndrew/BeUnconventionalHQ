import { verifyAutomationRequest } from './automation-auth.mjs';

type Bindings = Record<string, string | undefined>;

/** Only the fixed HQ repository and editorial inbox are reachable. */
export async function handleAutomationRequest(
  request: Request, env: Bindings, { fetchImpl = fetch, now = Date.now() } = {},
): Promise<Response> {
  const reply = (data: object, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const body = await request.text();
  if (body.length > 32768) return reply({ error: 'Request too large' }, 413);
  if (!await verifyAutomationRequest(request, body, env.WEBSUB_SECRET, now)) return reply({ error: 'Invalid authentication' }, 403);
  let payload;
  try { payload = JSON.parse(body); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  if (payload.action === 'dispatch') {
    const articles = payload.articles;
    if (!Array.isArray(articles) || !articles.length || articles.length > 20 || articles.some(article => {
      try {
        const url = new URL(article.url);
        return url.origin !== 'https://beunconventionalhq.substack.com' || !url.pathname.startsWith('/p/') ||
          typeof article.guid !== 'string' || !article.guid || article.guid.length > 1000 ||
          typeof article.title !== 'string' || article.title.length > 500;
      } catch { return true; }
    })) return reply({ error: 'Invalid article metadata' }, 400);
    const event = { event_type: 'content-published', client_payload: { source: 'substack', articles } };
    if (payload.dryRun === true) return reply({ ok: true, dryRun: true, event });
    if (!env.GITHUB_DISPATCH_TOKEN) return reply({ error: 'Dispatch is not configured' }, 503);
    const result = await fetchImpl('https://api.github.com/repos/HeyThisIsAndrew/BeUnconventionalHQ/dispatches', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'BeUnconventionalHQ-Automation', 'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (!result.ok) return reply({ error: `GitHub dispatch failed: HTTP ${result.status}` }, 502);
    return reply({ ok: true });
  }
  if (payload.action === 'notify') {
    if (typeof payload.message !== 'string' || payload.message.length > 2000 ||
        typeof payload.incidentId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(payload.incidentId)) {
      return reply({ error: 'Invalid alert' }, 400);
    }
    if (payload.channel === 'github') {
      if (!env.GITHUB_DISPATCH_TOKEN) return reply({ error: 'GitHub alerts are not configured' }, 503);
      if (payload.dryRun === true) return reply({ ok: true, dryRun: true, channel: 'github' });
      const result = await fetchImpl('https://api.github.com/repos/HeyThisIsAndrew/BeUnconventionalHQ/actions/workflows/automation-alert.yml/dispatches', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'BeUnconventionalHQ-Automation', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { message: payload.message, test: String(payload.test === true) } }),
      });
      if (!result.ok) return reply({ error: `GitHub alert failed: HTTP ${result.status}` }, 502);
      return reply({ ok: true, channel: 'github' });
    }
    if (!env.RESEND_API_KEY) return reply({ error: 'Alerts are not configured' }, 503);
    if (payload.dryRun === true) return reply({ ok: true, dryRun: true, recipient: 'andrew@beunconventionalhq.com' });
    const result = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `hq-watcher-${payload.incidentId}`,
      },
      body: JSON.stringify({
        from: 'noreply@beunconventionalhq.com', to: 'andrew@beunconventionalhq.com',
        subject: payload.test === true ? 'HQ automation: test failure alert' : 'HQ automation: article watcher failed',
        text: `${payload.message}\n\nThe saved article archive is preserved. The watcher retries on its next five-minute run.\nhttps://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/workflows/sync-articles.yml`,
      }),
    });
    if (!result.ok) return reply({ error: `Alert delivery failed: HTTP ${result.status}` }, 502);
    return reply({ ok: true });
  }
  return reply({ error: 'Unsupported action' }, 400);
}
