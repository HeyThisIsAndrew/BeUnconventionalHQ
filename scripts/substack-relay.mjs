/**
 * Fixed-publication relay for GitHub runners blocked by Substack's IP rules.
 * Only public posts, no credentials/cookies, no caller-controlled target URL.
 */
import { XMLParser } from 'fast-xml-parser';
import { parsePostHtml } from './substack-post-html.mjs';
import { verifyAutomationRequest } from '../src/lib/automation-auth.mjs';
import { watchSubstack, callGateway } from './substack-watcher.mjs';
import { sendFailureEmail } from '../src/lib/automation-notifications.mjs';

const PUBLICATION = 'https://beunconventionalhq.substack.com';
const PAGE_SIZE = 20;

export async function relayPosts(request, { fetchUpstream = fetch, cache, waitUntil = () => {} } = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  if (url.pathname !== '/posts') return new Response('Not found', { status: 404 });
  const offset = url.searchParams.get('offset') ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 5000 || Number(offset) % PAGE_SIZE ||
      [...url.searchParams.keys()].some(key => key !== 'offset') || url.searchParams.getAll('offset').length > 1) {
    return new Response('Expected only offset=0,20,40,...,5000', { status: 400 });
  }
  url.search = `?offset=${offset}`;
  const key = new Request(url.toString());
  const cached = await cache?.match(key);
  if (cached) return cached;
  try {
    const getText = async url => {
      const response = await fetchUpstream(url, {
        signal: AbortSignal.timeout(15000), redirect: 'manual',
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) throw new Error(`Substack returned HTTP ${response.status} from ${new URL(url).pathname}`);
      return response.text();
    };
    // Substack rate-limits API calls from some edge locations. Public RSS and
    // post HTML work there. RSS discovers URLs; the HTML JSON supplies the
    // complete tags and body that RSS alone does not carry.
    const doc = new XMLParser({ parseTagValue: false }).parse(await getText(`${PUBLICATION}/feed`));
    const items = doc.rss?.channel?.item;
    const feed = items ? (Array.isArray(items) ? items : [items]) : [];
    if (!feed.length) throw new Error('Substack RSS returned no items');
    const window = feed.slice(Number(offset), Number(offset) + PAGE_SIZE);
    const posts = new Array(window.length);
    let next = 0;
    // At most 21 subrequests, four article pages at a time.
    await Promise.all(Array.from({ length: Math.min(4, window.length) }, async () => {
      while (next < window.length) {
        const index = next++;
        const link = new URL(window[index].link);
        if (link.origin !== PUBLICATION || !link.pathname.startsWith('/p/')) {
          throw new Error('Unexpected article URL in Substack RSS');
        }
        const post = parsePostHtml(await getText(link.toString()));
        if (!post?.id || typeof post.title !== 'string' ||
            typeof post.body_html !== 'string' || !Array.isArray(post.postTags)) {
          throw new Error(`Substack returned an incomplete post: ${link.pathname}`);
        }
        posts[index] = post;
      }
    }));
    const result = Response.json(posts, { headers: {
      'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff',
    } });
    if (cache) waitUntil(cache.put(key, result.clone()));
    return result;
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  async fetch(request, env) {
    // Pin upstream work to one object with a western North America hint, independently of the runner's
    // ingress region. Strip incoming headers/CF metadata from the inner call.
    const id = env.ARTICLE_SOURCE.idFromName('hq-public-articles-v1');
    const source = env.ARTICLE_SOURCE.get(id, { locationHint: 'wnam' });
    const url = new URL(request.url);
    if (url.pathname === '/poll' && request.method === 'POST') {
      const body = await request.text();
      if (body.length > 1024 || !await verifyAutomationRequest(request, body, env.WEBSUB_SECRET)) {
        return new Response('Invalid authentication', { status: 403 });
      }
      let options;
      try { options = JSON.parse(body); } catch { return new Response('Invalid JSON', { status: 400 }); }
      return source.fetch(new Request('https://article-source.internal/poll', { method: 'POST', body: JSON.stringify({ dryRun: options.dryRun === true, forceFailure: options.forceFailure === true }) }));
    }
    if (url.pathname !== '/posts') return new Response('Not found', { status: 404 });
    return source.fetch(new Request(`https://article-source.internal${url.pathname}${url.search}`, { method: request.method }));
  },
  async scheduled(_event, env) {
    const source = env.ARTICLE_SOURCE.get(env.ARTICLE_SOURCE.idFromName('hq-public-articles-v1'), { locationHint: 'wnam' });
    const response = await source.fetch(new Request('https://article-source.internal/poll', { method: 'POST', body: '{}' }));
    const result = await response.json();
    console.log('[substack-watcher]', JSON.stringify(result));
    if (!result.ok) throw new Error(result.error);
  },
};

/** Global cache and request coalescing, including across different edge POPs. */
export class ArticleSource {
  constructor(state, env = {}) {
    this.state = state;
    this.pending = new Map();
    this.env = env;
    this.fetchUpstream = env.FETCH_UPSTREAM ?? fetch;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/poll' && request.method === 'POST') {
      if (!this.polling) {
        this.polling = (async () => this.poll(await request.json()))().finally(() => { this.polling = undefined; });
      }
      const result = await this.polling;
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    const key = request.url;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.load(request);
      this.pending.set(key, pending);
    }
    try {
      return (await pending).clone();
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  async poll(options) {
    return watchSubstack({
      storage: this.state.storage, ...options,
      requestFeed: async url => {
        const response = await this.fetchUpstream(url, {
          signal: AbortSignal.timeout(15000),
          headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
        });
        if (!response.ok) throw new Error(`Substack RSS poll failed: HTTP ${response.status}`);
        return response.text();
      },
      refreshSource: async () => {
        await Promise.allSettled([...this.pending.values()]);
        const keys = [...(await this.state.storage.list({ prefix: 'https://article-source.internal/posts?' })).keys()];
        if (keys.length) await this.state.storage.delete(keys);
        const refreshed = await this.fetch(new Request('https://article-source.internal/posts?offset=0'));
        if (!refreshed.ok) throw new Error('New article payload could not be prepared; dispatch deferred');
      },
      dispatch: articles => callGateway(this.env, { action: 'dispatch', articles }),
      notify: alert => {
        if (!['email', 'github'].includes(this.env.ALERT_CHANNEL)) throw new Error('Failure alerts are not configured');
        if (this.env.ALERT_CHANNEL === 'email') return sendFailureEmail(this.env, alert, this.fetchUpstream);
        return callGateway(this.env, { action: 'notify', channel: this.env.ALERT_CHANNEL, ...alert });
      },
    });
  }

  async load(request) {
    const writes = [];
    const cache = {
      match: async key => {
        const cached = await this.state.storage.get(key.url);
        if (!cached || Date.now() - cached.savedAt >= 300000) return undefined;
        return new Response(cached.body, { headers: cached.headers });
      },
      put: async (key, response) => {
        await this.state.storage.put(key.url, {
          savedAt: Date.now(), body: await response.text(), headers: Object.fromEntries(response.headers),
        });
      },
    };
    const result = await relayPosts(request, { cache, fetchUpstream: this.fetchUpstream, waitUntil: promise => writes.push(promise) });
    await Promise.all(writes);
    return result;
  }
}
