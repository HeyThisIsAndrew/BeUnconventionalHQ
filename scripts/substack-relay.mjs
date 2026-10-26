/**
 * Fixed-publication relay for GitHub runners blocked by Substack's IP rules.
 * Only public posts, no credentials/cookies, no caller-controlled target URL.
 */
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
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    };
    const getJson = async url => {
      const response = await fetchUpstream(url, {
        signal: AbortSignal.timeout(15000), redirect: 'manual', headers,
      });
      if (!response.ok) throw new Error(`Substack returned HTTP ${response.status} from ${new URL(url).pathname}`);
      return response.json();
    };
    // The bulk /posts endpoint is rate-limited from Workers, but the public
    // archive and individual post endpoints work (verified from GitHub + edge).
    const upstream = new URL('/api/v1/archive', PUBLICATION);
    upstream.searchParams.set('sort', 'new');
    upstream.searchParams.set('offset', offset);
    upstream.searchParams.set('limit', String(PAGE_SIZE));
    const archive = await getJson(upstream.toString());
    if (!Array.isArray(archive) || archive.length > PAGE_SIZE ||
        archive.some(p => !p?.id || !/^[a-z0-9-]+$/.test(p.slug))) {
      throw new Error('Substack returned an invalid archive payload');
    }
    const posts = new Array(archive.length);
    let next = 0;
    // At most 21 subrequests per invocation, including the archive request.
    // This fits even the free Workers subrequest limit; no unbounded fan-out.
    await Promise.all(Array.from({ length: Math.min(4, archive.length) }, async () => {
      while (next < archive.length) {
        const index = next++;
        const summary = archive[index];
        const post = await getJson(`${PUBLICATION}/api/v1/posts/${summary.slug}`);
        if (post?.id !== summary.id || typeof post.title !== 'string' ||
            typeof post.body_html !== 'string' || !Array.isArray(post.postTags)) {
          throw new Error(`Substack returned an incomplete post: ${summary.slug}`);
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
  fetch(request, _env, context) {
    return relayPosts(request, { cache: caches.default, waitUntil: promise => context.waitUntil(promise) });
  },
};
