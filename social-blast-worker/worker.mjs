/**
 * hq-social-blast: the social distribution Worker (issues #281, #282, #284).
 * Operator runbook: scripts/social-blast.md.
 *
 *   cron (every 15 min)   runs a blast, and refreshes the Threads token daily
 *   POST /blast           the same run, triggered by deploy.yml right after a
 *                         production deploy. Signed with the shared automation
 *                         HMAC (src/lib/automation-auth.mjs). Body
 *                         {"inspect":true} returns the would-be report as JSON
 *                         and changes nothing.
 *
 * Every run goes through ONE Durable Object, which runs them one at a time:
 * that is what makes "one story, one post per platform" hold when the cron
 * and a deploy trigger fire together (see blast.mjs).
 *
 * Nothing brand-specific lives in code (issue #286): the site, the alert
 * address, the brand name and every credential come from wrangler vars and
 * secrets, and the wording from templates.json.
 */
import { verifyAutomationRequest } from '../src/lib/automation-auth.mjs';
import templates from './templates.json';
import { runAndReport, digest } from './blast.mjs';
import { PUBLISHERS, refreshThreadsToken, scrub } from './platforms.mjs';
import { sendEmail } from './report.mjs';

const OBJECT_NAME = 'social-blast-v1';
const THREADS_REFRESH_EVERY_MS = 24 * 3600 * 1000;
/** A broken feed is reported at most this often, not every fifteen minutes. */
const FATAL_ALERT_EVERY_MS = 6 * 3600 * 1000;

function siteFetch(env, url) {
  // The domain sits behind bot protection that refuses datacenter IPs; the
  // service binding reaches the same Worker without crossing it.
  const sameSite = env.SITE_URL && new URL(url).origin === new URL(env.SITE_URL).origin;
  return sameSite && env.HQ_SITE ? env.HQ_SITE.fetch(new Request(url)) : fetch(url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/blast' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.text();
    if (body.length > 1024 || !await verifyAutomationRequest(request, body, env.WEBSUB_SECRET)) {
      return new Response('Invalid authentication', { status: 403 });
    }
    let options;
    try { options = JSON.parse(body || '{}'); } catch { return new Response('Invalid JSON', { status: 400 }); }
    return stub(env).fetch(new Request('https://social-blast.internal/run', {
      method: 'POST', body: JSON.stringify({ inspect: options.inspect === true, source: 'trigger' }),
    }));
  },

  async scheduled(_event, env) {
    const response = await stub(env).fetch(new Request('https://social-blast.internal/run', {
      method: 'POST', body: JSON.stringify({ source: 'cron', refreshThreads: true }),
    }));
    const result = await response.json();
    console.log('[social-blast]', JSON.stringify({ action: result.action, problems: result.problems ?? 0, error: result.error }));
    if (!result.ok) throw new Error(result.error);
  },
};

function stub(env) {
  return env.BLAST_STATE.get(env.BLAST_STATE.idFromName(OBJECT_NAME));
}

export class BlastState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  async fetch(request) {
    if (new URL(request.url).pathname !== '/run') return new Response('Not found', { status: 404 });
    const options = await request.json().catch(() => ({}));
    // One run at a time, whatever triggered it.
    const run = this.queue.then(() => this.run(options));
    this.queue = run.catch(() => {});
    return Response.json(await run);
  }

  async run({ inspect = false, refreshThreads = false } = {}) {
    const env = this.env;
    const store = this.state.storage;
    const send = (report) => sendEmail(env, report);
    try {
      if (refreshThreads && !inspect) await this.refreshThreads(send);
      const result = await runAndReport({
        store, env, templates, send, inspect,
        publishers: PUBLISHERS,
        fetchImpl: (url, init) => fetch(url, init),
        fetchFeed: async () => {
          const response = await siteFetch(env, new URL('/dispatch.json', env.SITE_URL).toString());
          if (!response.ok) throw new Error(`dispatch.json answered HTTP ${response.status}`);
          return response.json();
        },
        getImage: async (url) => {
          const response = await siteFetch(env, url);
          if (!response.ok) return null;
          return { bytes: await response.arrayBuffer(), type: response.headers.get('Content-Type') || 'image/jpeg' };
        },
        threadsToken: () => this.threadsToken(),
      });
      return { ok: true, ...result };
    } catch (error) {
      const message = scrub(error?.message ?? error, env);
      if (!inspect) await this.alertFatal(message, send);
      return { ok: false, error: message };
    }
  }

  /** The token to post with: the refreshed one, unless the secret was replaced since. */
  async threadsToken() {
    const saved = await this.state.storage.get('threads:token');
    const source = this.env.THREADS_ACCESS_TOKEN ? await digest(this.env.THREADS_ACCESS_TOKEN) : null;
    return saved?.source === source && saved.token ? saved.token : this.env.THREADS_ACCESS_TOKEN;
  }

  /**
   * Long-lived Threads tokens die after 60 days unused-for-refresh. Refreshing
   * daily keeps them alive indefinitely; a failure is emailed, because the
   * alternative is finding out when a post fails two months from now.
   */
  async refreshThreads(send) {
    if (!this.env.THREADS_ACCESS_TOKEN || !this.env.THREADS_USER_ID) return;
    const saved = await this.state.storage.get('threads:token');
    const source = await digest(this.env.THREADS_ACCESS_TOKEN);
    if (saved?.source !== source) {
      // A newly set secret is a newly issued token, and Threads refuses to
      // refresh a token less than a day old. Start its clock instead.
      await this.state.storage.put('threads:token', { token: this.env.THREADS_ACCESS_TOKEN, source, refreshedAt: Date.now() });
      return;
    }
    if (Date.now() - (saved.refreshedAt ?? 0) < THREADS_REFRESH_EVERY_MS) return;
    const current = saved.token || this.env.THREADS_ACCESS_TOKEN;
    try {
      const { token, expiresIn } = await refreshThreadsToken(current, this.env, (url, init) => fetch(url, init));
      await this.state.storage.put('threads:token', { token, source, refreshedAt: Date.now(), expiresIn });
    } catch (error) {
      // Remember the attempt so a broken token is reported daily, not every run.
      await this.state.storage.put('threads:token', { token: current, source, refreshedAt: Date.now(), error: true });
      await send({
        subject: `${this.env.BRAND_NAME || 'Site'} social: Threads token refresh failed`,
        text: `${scrub(error?.message ?? error, this.env)}\n\nThreads posts will fail once the token expires. Generate a new long-lived token and set THREADS_ACCESS_TOKEN (scripts/social-blast.md).`,
        key: `threads-refresh-${new Date().toISOString().slice(0, 10)}`,
      }).catch(() => {});
    }
  }

  async alertFatal(message, send) {
    const last = await this.state.storage.get('alert:fatal');
    if (last && Date.now() - last < FATAL_ALERT_EVERY_MS) return;
    await this.state.storage.put('alert:fatal', Date.now());
    await send({
      subject: `${this.env.BRAND_NAME || 'Site'} social: distribution run failed`,
      text: `${message}\n\nNothing was posted by this run. It retries every 15 minutes; this alert repeats at most every 6 hours while the problem lasts.`,
      key: `fatal-${await digest(message)}-${Math.floor(Date.now() / FATAL_ALERT_EVERY_MS)}`,
    }).catch(() => {});
  }
}
