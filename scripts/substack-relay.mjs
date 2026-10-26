/**
 * Fixed-publication relay for GitHub runners blocked by Substack's IP rules.
 * Only public posts, no credentials/cookies, no caller-controlled target URL.
 */
const UPSTREAM = 'https://beunconventionalhq.substack.com/api/v1/posts';

export async function relayPosts(request, { fetchUpstream = fetch, cache, waitUntil = () => {} } = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  if (url.pathname !== '/posts') return new Response('Not found', { status: 404 });
  const offset = url.searchParams.get('offset') ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 5000 || Number(offset) % 50 ||
      [...url.searchParams.keys()].some(key => key !== 'offset') || url.searchParams.getAll('offset').length > 1) {
    return new Response('Expected only offset=0,50,100,...,5000', { status: 400 });
  }
  url.search = `?offset=${offset}`;
  const key = new Request(url.toString());
  const cached = await cache?.match(key);
  if (cached) return cached;
  try {
    const upstream = new URL(UPSTREAM);
    upstream.searchParams.set('limit', '50');
    upstream.searchParams.set('offset', offset);
    const response = await fetchUpstream(upstream.toString(), {
      signal: AbortSignal.timeout(20000), redirect: 'manual',
      headers: { Accept: 'application/json', 'User-Agent': 'BeUnconventionalHQ-ArticleSync/1.0 (+https://beunconventionalhq.com)' },
    });
    if (!response.ok) throw new Error(`Substack returned HTTP ${response.status}`);
    const posts = await response.json();
    if (!Array.isArray(posts) || posts.some(p => !p?.id || typeof p.title !== 'string' ||
        typeof p.body_html !== 'string' || !Array.isArray(p.postTags))) {
      throw new Error('Substack returned an invalid posts payload');
    }
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
  fetch(request, _env, context) {
    if (new URL(request.url).pathname === '/diagnose') {
      const urls = [
        'https://beunconventionalhq.substack.com/api/v1/posts?limit=2',
        'https://beunconventionalhq.substack.com/api/v1/posts?limit=50&offset=0',
        'https://beunconventionalhq.substack.com/feed',
        'https://beunconventionalhq.substack.com/p/clayface-review',
        'https://beunconventionalhq.substack.com/api/v1/archive?sort=new&offset=0&limit=2',
        'https://beunconventionalhq.substack.com/api/v1/posts/clayface-review',
        'https://substack.com/api/v1/posts/by-id/222226709',
      ];
      return Response.json(await Promise.all(urls.map(async url => {
        try {const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Accept: '*/*' }, signal: AbortSignal.timeout(15000), redirect: 'manual' }); const body = await r.text();return { url, status: r.status, length: body.length, type: r.headers.get('content-type'), retry: r.headers.get('retry-after'), start: body.slice(0,160), preloads: body.includes('preloads-json') }; }catch(error){return { url,error:error.message };}
      })));
    }
    return relayPosts(request, { cache: caches.default, waitUntil: promise => context.waitUntil(promise) });
  },
};
