/** Public Substack post ingestion. No I/O on import; transports are injectable. */
import { XMLParser } from 'fast-xml-parser';
import { parsePostHtml } from './substack-post-html.mjs';
export { parsePostHtml };

export const PUBLICATION_URL = 'https://beunconventionalhq.substack.com';
export const RELAY_URL = 'https://hq-substack-source.heythisisandrewb.workers.dev/posts';
const PAGE_SIZE = 20;
const MAX_PAGES = 250;

/**
 * Substack changed this undocumented endpoint from an offset-paginated array
 * to a cursor-paginated object in November 2026. Keep the old array form
 * readable too: a relay cache or a future rollback must not strand a sync.
 */
export function parsePostsPage(value) {
  if (Array.isArray(value)) return { posts: value, nextCursor: null, pagination: 'offset' };
  if (!value || typeof value !== 'object' || !Array.isArray(value.posts) ||
      !('nextCursor' in value) || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) {
    throw new Error('Posts API returned an unsupported page shape');
  }
  return { posts: value.posts, nextCursor: value.nextCursor, pagination: 'cursor' };
}


function validatePost(post) {
  if (!post || typeof post !== 'object' || !post.title?.trim() ||
      !(post.id || post.canonical_url || post.slug) ||
      !Number.isFinite(Date.parse(post.post_date)) ||
      !Array.isArray(post.postTags) || typeof post.body_html !== 'string') {
    throw new Error('Incomplete post payload: expected title, identity, date, postTags and body_html');
  }
  return post;
}

export async function fetchText(url, {
  fetchImpl = fetch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  timeoutMs = 20000,
} = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'BeUnconventionalHQ-ArticleSync/1.0 (+https://beunconventionalhq.com)',
          Accept: 'application/json,application/rss+xml,application/xml,text/html;q=0.9',
        },
      });
      const body = await response.text();
      if (response.ok) return body;
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      let detail = '';
      try { detail = String(JSON.parse(body).error ?? '').replace(/\s+/g, ' ').slice(0, 200); } catch { /* never log challenge HTML */ }
      const error = new Error(`HTTP ${response.status} from ${new URL(url).pathname}${detail ? `: ${detail}` : ''}`);
      error.httpStatus = response.status;
      throw error;
    } catch (error) {
      // Retrying a permanent 403 challenge cannot help. Network outages can.
      if (error.httpStatus || attempt === 2) throw error;
      await sleep(2000 * (attempt + 1));
    }
  }
}

export async function fetchPostsApi({ publicationUrl = PUBLICATION_URL, request = fetchText } = {}) {
  const posts = [];
  const seen = new Set();
  const cursors = new Set();
  let pagination;
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('/api/v1/posts', publicationUrl);
    url.searchParams.set('limit', String(PAGE_SIZE));
    // Do not send offset=0. The cursor API rejects every offset value.
    if (pagination === 'cursor' && cursor) url.searchParams.set('cursor', cursor);
    if (pagination === 'offset') url.searchParams.set('offset', String(page * PAGE_SIZE));
    const result = parsePostsPage(JSON.parse(await request(url.toString())));
    if (pagination && pagination !== result.pagination) throw new Error('Posts API changed pagination during sync');
    pagination = result.pagination;
    const batch = result.posts;
    if (!batch.length && !page) throw new Error('Posts API returned zero posts');
    for (const post of batch) {
      validatePost(post);
      const key = String(post.id || post.canonical_url || post.slug);
      if (seen.has(key)) throw new Error('Posts API repeated a post; pagination may be ignoring offset');
      seen.add(key);
      posts.push(post);
    }
    if (pagination === 'cursor') {
      if (!result.nextCursor) return { posts, pages: page + 1, source: 'posts API' };
      if (cursors.has(result.nextCursor)) throw new Error('Posts API repeated a cursor; refusing an incomplete sync');
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    } else if (batch.length < PAGE_SIZE) return { posts, pages: page + 1, source: 'posts API' };
  }
  throw new Error(`Posts API exceeded ${MAX_PAGES} pages; refusing an incomplete sync`);
}

/** RSS discovers URLs only. Full post payloads preserve ALL tags and bodies. */
export async function fetchPostsHtml({
  publicationUrl = PUBLICATION_URL, feedUrl = `${publicationUrl}/feed`, request = fetchText,
} = {}) {
  const xml = await request(feedUrl);
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const items = doc.rss?.channel?.item;
  const list = items ? (Array.isArray(items) ? items : [items]) : [];
  if (!list.length) throw new Error('RSS returned no items');
  const posts = [];
  for (const item of list) {
    const link = new URL(item.link);
    if (link.origin !== new URL(publicationUrl).origin || !link.pathname.startsWith('/p/')) {
      throw new Error('RSS contained an unexpected article URL');
    }
    posts.push(validatePost(parsePostHtml(await request(link.toString()))));
  }
  return { posts, pages: 1, source: 'RSS + post HTML' };
}

export async function fetchPostsRelay(options = {}) {
  const publicationUrl = options.publicationUrl ?? PUBLICATION_URL;
  const relayUrl = options.relayUrl ?? process.env.SUBSTACK_RELAY_URL ??
    (publicationUrl.replace(/\/$/, '') === PUBLICATION_URL ? RELAY_URL : '');
  if (!relayUrl) throw new Error('No relay configured for this publication');
  const request = options.request ?? fetchText;
  const result = await fetchPostsApi({ ...options, request: url => {
    const relay = new URL(relayUrl);
    const source = new URL(url);
    for (const name of ['offset', 'cursor']) {
      if (source.searchParams.has(name)) relay.searchParams.set(name, source.searchParams.get(name));
    }
    // A cold relay deliberately paces up to twenty article requests.
    return request(relay.toString(), { timeoutMs: 90000 });
  } });
  return { ...result, source: 'Cloudflare relay' };
}

export async function fetchAllPosts(options = {}) {
  const warn = options.warn ?? console.warn;
  const failures = [];
  for (const source of [fetchPostsApi, fetchPostsRelay, fetchPostsHtml]) {
    try { return await source(options); }
    catch (error) {
      failures.push(error.message);
      warn(`[articles] ${source.name} failed: ${error.message}`);
    }
  }
  throw new Error(`All article sources failed: ${failures.join('; ')}`);
}
