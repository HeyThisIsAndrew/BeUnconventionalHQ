/**
 * hq-dispatch-kit: Dispatch to Kit Draft (issue #272). Runbook:
 * scripts/hq-dispatch.md.
 *
 *   cron  Thursdays 16:00 UTC. Cron Triggers run on UTC with no daylight
 *         saving, so that is 09:00 Pacific in summer (PDT) and 08:00 in
 *         winter (PST). The draft waits in Kit either way; nothing sends.
 *   POST /draft   the manual run, signed with the shared automation HMAC
 *         (src/lib/automation-auth.mjs). Body: {"dryRun":true} previews
 *         even when drafts are on; {"forceFailure":true} tests the alert.
 *
 * Runs go through one Durable Object, one at a time, which holds the cache
 * of the last draft. Kit's own broadcast list is the real duplicate guard
 * (kit-draft.mjs). Brand and addresses are wrangler vars (issue #286).
 */
import { verifyAutomationRequest } from '../src/lib/automation-auth.mjs';
import { sendOwnerEmail } from '../src/lib/automation-email.mjs';
import { runKitDraft, buildNotice } from './kit-draft.mjs';

const OBJECT_NAME = 'dispatch-kit-v1';

function siteFetch(env, url) {
  // Through the service binding: the domain's bot protection refuses
  // datacenter IPs, the binding does not cross it.
  const sameSite = env.SITE_URL && new URL(url).origin === new URL(env.SITE_URL).origin;
  return sameSite && env.HQ_SITE ? env.HQ_SITE.fetch(new Request(url)) : fetch(url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/draft' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.text();
    if (body.length > 1024 || !await verifyAutomationRequest(request, body, env.WEBSUB_SECRET)) {
      return new Response('Invalid authentication', { status: 403 });
    }
    let options;
    try { options = JSON.parse(body || '{}'); } catch { return new Response('Invalid JSON', { status: 400 }); }
    return stub(env).fetch(new Request('https://dispatch-kit.internal/run', {
      method: 'POST',
      body: JSON.stringify({ dryRun: options.dryRun === true, forceFailure: options.forceFailure === true }),
    }));
  },

  async scheduled(_event, env) {
    const response = await stub(env).fetch(new Request('https://dispatch-kit.internal/run', { method: 'POST', body: '{}' }));
    const result = await response.json();
    console.log('[dispatch-kit]', JSON.stringify({ action: result.action, error: result.error }));
    if (!result.ok) throw new Error(result.error);
  },
};

function stub(env) {
  return env.KIT_STATE.get(env.KIT_STATE.idFromName(OBJECT_NAME));
}

export class KitDraftState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  async fetch(request) {
    if (new URL(request.url).pathname !== '/run') return new Response('Not found', { status: 404 });
    const options = await request.json().catch(() => ({}));
    const run = this.queue.then(() => this.run(options));
    this.queue = run.catch(() => {});
    return Response.json(await run);
  }

  async run({ dryRun = false, forceFailure = false } = {}) {
    const env = this.env;
    const send = (notice, key) => sendOwnerEmail(env, { ...notice, key: `dispatch-kit-${key}` });
    try {
      if (forceFailure) throw new Error('Forced failure: testing the newsletter alert. No draft was attempted.');
      const result = await runKitDraft({
        store: this.state.storage,
        env,
        dryRun,
        fetchImpl: (url, init) => fetch(url, init),
        fetchFeed: async () => {
          const response = await siteFetch(env, new URL('/dispatch.json', env.SITE_URL).toString());
          if (!response.ok) throw new Error(`dispatch.json answered HTTP ${response.status}`);
          return response.json();
        },
      });
      const notice = buildNotice(result, env);
      let notified = false;
      if (notice) {
        // A created draft is announced once, ever. Previews are not deduplicated,
        // so a second manual dry run still emails.
        const id = result.action === 'created' ? `created-${result.broadcastId}` : `${result.action}-${Date.now()}`;
        await send(notice, id);
        notified = true;
      }
      return { ok: true, action: result.action, broadcastId: result.broadcastId ?? null, url: result.url ?? null, subject: result.plan?.subject ?? null, stories: result.plan?.stories.length ?? 0, notified };
    } catch (error) {
      const message = String(error?.message ?? error).split(env.KIT_API_KEY || '\u0000').join('[redacted]');
      let alerted = false;
      try {
        await send({
          subject: `${env.NEWSLETTER_NAME || 'Newsletter'}: the weekly Kit draft FAILED`,
          text: `${message}\n\nNo draft was created by this run. Fix the cause, then run it by hand: node scripts/trigger-kit-draft.mjs --execute (scripts/hq-dispatch.md).`,
        }, `failure-${Date.now()}`);
        alerted = true;
      } catch { /* the run's own log still carries the error */ }
      return { ok: false, error: message, alerted };
    }
  }
}
