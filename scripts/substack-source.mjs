/** Public Substack post ingestion. No I/O on import; transports are injectable. */
import { XMLParser } from 'fast-xml-parser';

export const PUBLICATION_URL = 'https://beunconventionalhq.substack.com';
const PAGE_SIZE = 50;
const MAX_PAGES = 100;

/** Read data, never execute the JavaScript surrounding it. */
export function parsePostHtml(html) {
  for (const [, attrs, contents] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bid\s*=\s*(["'])preloads-json\1/i.test(attrs)) {
      const data = JSON.parse(contents);
      if (!data?.post) throw new Error('preloads-json has no post');
      return data.post;
    }
  }

  // Older Substack pages embed a JSON string literal in JSON.parse("...").
  // Track escapes rather than guessing where that literal ends. In particular,
  // a closing quote after an EVEN number of backslashes is not escaped.
  const match = /window\._preloads\s*=\s*JSON\.parse\(\s*(")/.exec(html);
  if (match) {
    const start = match.index + match[0].length - 1;
    let escaped = false;
    for (let i = start + 1; i < html.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (html[i] === '\\') { escaped = true; continue; }
      if (html[i] !== '"') continue;
      const data = JSON.parse(JSON.parse(html.slice(start, i + 1)));
      if (!data?.post) throw new Error('legacy preloads has no post');
      return data.post;
    }
  }
  throw new Error('No supported Substack post payload (expected script#preloads-json or legacy preloads)');
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

export async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'BeUnconventionalHQ-ArticleSync/1.0 (+https://beunconventionalhq.com)',
      Accept: 'application/json,application/rss+xml,application/xml,text/html;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
  return response.text();
}

export async function fetchPostsApi({ publicationUrl = PUBLICATION_URL, request = fetchText } = {}) {
  const posts = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('/api/v1/posts', publicationUrl);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(page * PAGE_SIZE));
    const batch = JSON.parse(await request(url.toString()));
    if (!Array.isArray(batch)) throw new Error('Posts API did not return an array');
    if (!batch.length && !page) throw new Error('Posts API returned zero posts');
    for (const post of batch) {
      validatePost(post);
      const key = String(post.id || post.canonical_url || post.slug);
      if (seen.has(key)) throw new Error('Posts API repeated a post; pagination may be ignoring offset');
      seen.add(key);
      posts.push(post);
    }
    if (batch.length < PAGE_SIZE) return { posts, pages: page + 1, source: 'posts API' };
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

export async function fetchAllPosts(options = {}) {
  const warn = options.warn ?? console.warn;
  const failures = [];
  for (const source of [fetchPostsApi, fetchPostsHtml]) {
    try { return await source(options); }
    catch (error) {
      failures.push(error.message);
      warn(`[articles] ${source.name} failed: ${error.message}`);
    }
  }
  throw new Error(`All article sources failed: ${failures.join('; ')}`);
}
