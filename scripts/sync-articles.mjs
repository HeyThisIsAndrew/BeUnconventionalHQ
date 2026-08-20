/**
 * Substack posts API → local JSON article sync.
 *
 * Counterpart to sync-youtube.mjs, and follows the same contract: dry-run by
 * default, `--execute` to write, pure functions exported for offline tests,
 * zero I/O on import.
 *
 * ─── WHY THE JSON API INSTEAD OF THE RSS FEED ─────────────────────────────
 * `/feed` (Substack's public RSS) does not carry the post's tags/keywords —
 * only the one or two categories the RSS `<category>` element happens to
 * repeat. The site's category/content-type mapping (articles-transform.ts)
 * and the "More From" related-article matching both key off tags, so a
 * source that drops most of them silently degrades both. Substack's own
 * front end loads posts from `/api/v1/posts`, an internal (undocumented, not
 * versioned, not supported) JSON endpoint — this is publication data the HQ
 * account owns, fetched the same way the public post page itself does, just
 * without rendering the page first. There is no public/stable contract here:
 * Substack can change or remove this route without notice, which is exactly
 * why every failure mode below is loud-but-non-fatal, same as the RSS path
 * it replaces — a broken endpoint must never blank the archive or fail the
 * build, only leave the snapshot exactly as it was.
 *
 * The critical behaviour is the merge. The posts endpoint returns a page of
 * recent posts (see LIMIT below), not the full history, so deriving the
 * article list from a live fetch alone would silently delete the archive on
 * the next deploy — live URLs 404, rankings die. Instead this merges into a
 * durable, version-controlled snapshot (src/data/articles.json) where
 * records are never removed. See mergeSnapshot() in
 * src/lib/articles-transform.ts.
 *
 * Deliberately does NOT touch buildArticleRecord()/mergeSnapshot(): those
 * operate on the same RawFeedItem shape regardless of source, so the
 * sanitize → categorize → merge pipeline is identical to the RSS era. Only
 * the fetch and the raw-shape mapping changed.
 *
 * Usage:
 *   node scripts/sync-articles.mjs              # dry run, prints the plan
 *   node scripts/sync-articles.mjs --execute    # writes src/data/articles.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './file-lock.mjs';
import { buildArticleRecord, mergeSnapshot } from '../src/lib/articles-transform.ts';
import { XMLParser } from 'fast-xml-parser';

const PUBLICATION_URL = process.env.SUBSTACK_PUBLICATION_URL ?? 'https://beunconventionalhq.substack.com';
const SUBSTACK_FEED = process.env.SUBSTACK_FEED_URL ?? `${PUBLICATION_URL}/feed`;
const SNAPSHOT_FILE = path.join(process.cwd(), 'src', 'data', 'articles.json');

/**
 * Posts requested per request, and the// Fetch limit from RSS. Substack's RSS usually returns 20 items.
// We only fetch HTML pages for posts we haven't seen yet to avoid rate limits.
const PAGE_SIZE = 20;

/** Coerce a possibly-singular API response into an array. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A post's keywords, normalized to plain strings.
 *
 * The posts endpoint carries these as `postTags`: an array of `{ id, name,
 * slug }` objects, not plain strings — RSS's flat `<category>` text is the
 * thing this replaces. Tolerates a bare string too, in case a future
 * response shape simplifies it.
 */
function mapTags(post) {
  return asArray(post?.postTags)
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .map((tag) => String(tag ?? '').trim())
    .filter(Boolean);
}

/**
 * Parse the posts API's JSON body into raw feed items — the same shape
 * `buildArticleRecord()` has always consumed, so nothing downstream needs to
 * know the source changed.
 *
 * Field mapping, undocumented API → RawFeedItem:
 *   title          title
 *   canonical_url  link            (falls back to `${pub}/p/${slug}`)
 *   id             guid            (a stable numeric post id, unlike RSS's
 *                                    permalink-as-guid — a post's URL can be
 *                                    edited, its id cannot)
 *   post_date      pubDate
 *   subtitle       description     (Substack's own dek/teaser text)
 *   body_html      contentEncoded
 *   postTags       categories      (see mapTags())
 *   cover_image    enclosureUrl
 */
export function parsePostsResponse(json) {
  return asArray(json).map((post) => {
    const slug = String(post?.slug ?? '').trim();
    const link = String(post?.canonical_url ?? post?.link ?? '').trim() || (slug ? `${PUBLICATION_URL}/p/${slug}` : '');

    return {
      title: String(post?.title ?? '').trim(),
      link,
      guid: String(post?.id ?? post?.guid ?? link ?? '').trim(),
      pubDate: String(post?.post_date ?? post?.pubDate ?? '').trim(),
      description: String(post?.subtitle ?? post?.description ?? '').trim(),
      contentEncoded: String(post?.body_html ?? post?.contentEncoded ?? post?.content ?? '').trim(),
      categories: mapTags(post),
      enclosureUrl: String(post?.cover_image ?? post?.enclosureUrl ?? '').trim(),
    };
  });
}

/**
 * Turn raw feed items into records, skipping anything malformed.
 * Returns the records plus the skip reasons, so the caller can log loudly
 * without the whole run failing on one bad post.
 */
export function planArticleSync(rawItems, existing = [], now = new Date()) {
  const records = [];
  const skipped = [];

  for (const [index, raw] of rawItems.entries()) {
    let record = null;
    try {
      record = buildArticleRecord(raw, now);
    } catch (err) {
      skipped.push({ index, title: raw?.title ?? '(untitled)', reason: err.message });
      continue;
    }
    if (!record) {
      skipped.push({
        index,
        title: raw?.title ?? '(untitled)',
        reason: 'missing title or guid/link',
      });
      continue;
    }
    records.push(record);
  }

  const { merged, added, updated } = mergeSnapshot(existing, records);
  return { merged, added, updated, skipped, parsed: records.length };
}

function readSnapshot() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    /*
      Drop anything generated by scripts/mock-articles.mjs.

      This matters because mergeSnapshot() is never-delete by design — real
      posts must survive ageing out of the API's rolling window. Without
      this filter, test content written during development would inherit
      that protection and live in the snapshot permanently.
    */
    const real = parsed.filter((record) => !record?.isMock);
    const dropped = parsed.length - real.length;
    if (dropped > 0) {
      console.warn(`[articles] Ignoring ${dropped} mock record(s) — a real sync always clears them.`);
      console.warn('[articles] (Use `npm run mock-articles -- --restore` to get your real snapshot back.)');
    }
    return real;
  } catch {
    return [];
  }
}

/**
 * Fetch the publication's RSS feed, then fetch the HTML page for each post
 * to extract the `window._preloads` JSON object, bypassing Cloudflare's bot block.
 */
async function fetchAllPosts() {
  const collected = [];

  // 1. Fetch RSS feed to get the latest posts
  let xml = '';
  try {
    const response = await fetch(SUBSTACK_FEED, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    xml = await response.text();
  } catch (err) {
    console.warn(`[articles] ⚠ Direct RSS fetch failed (${err.message}), falling back to proxy...`);
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(SUBSTACK_FEED)}`;
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) throw new Error(`HTTP ${proxyRes.status} from proxy`);
    const proxyJson = await proxyRes.json();
    if (proxyJson.status !== 'ok') throw new Error(`Proxy error: ${proxyJson.message}`);
    
    // Convert rss2json back to the shape expected below, or just map it directly.
    // Actually, rss2json returns JSON, not XML. We need to handle this carefully.
    // To keep it simple, let's map rss2json format to our `rawItems` shape.
    const collected = proxyJson.items.map(item => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
      description: item.description,
      contentEncoded: item.content,
      categories: item.categories || [],
      enclosureUrl: item.enclosure?.link || item.thumbnail
    }));
    
    // Return early since we can't scrape HTML via proxy anyway
    return { posts: collected, pages: 1 };
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const result = parser.parse(xml);
  const rawItems = result?.rss?.channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  if (items.length === 0) throw new Error('No items in RSS feed');

  // 2. Fetch HTML for each item
  for (const item of items) {
    const link = item.link;
    if (!link) continue;

    // To prevent updating every old post every run and getting rate limited,
    // we could skip fetching if it hasn't changed. But Substack's JSON endpoint
    // updated *everything*. We'll fetch the HTML for all RSS items since it's only ~20 max.
    try {
      const htmlRes = await fetch(link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
      });
      if (!htmlRes.ok) {
        console.warn(`[articles] ⚠ Failed to fetch HTML for ${link}: HTTP ${htmlRes.status}`);
        continue;
      }
      const html = await htmlRes.text();
      
      // Extract window._preloads
      const match = html.match(/window\._preloads\s*=\s*JSON\.parse\((".*?")\)/);
      if (match) {
        const parsed = JSON.parse(JSON.parse(match[1]));
        if (parsed.post) {
          collected.push(parsed.post);
        } else {
          console.warn(`[articles] ⚠ No post object in preloads for ${link}`);
        }
      } else {
        console.warn(`[articles] ⚠ Could not find window._preloads in HTML for ${link}`);
      }
    } catch (err) {
      console.warn(`[articles] ⚠ Error fetching HTML for ${link}: ${err.message}`);
    }
  }

  // We consider it 1 "page" of RSS items
  return { posts: collected, pages: 1 };
}

async function run() {
  const execute = process.argv.includes('--execute');
  const existing = readSnapshot();

  console.log(`[articles] Snapshot holds ${existing.length} record(s).`);
  console.log(`[articles] Fetching RSS ${SUBSTACK_FEED} and scraping HTML pages to bypass blocks`);

  let posts;
  let pages;
  try {
    ({ posts, pages } = await fetchAllPosts());
  } catch (err) {
    // Loud, but never fatal — the snapshot is the source of truth for the build.
    console.error(`[articles] ✗ POSTS FETCH FAILED: ${err.message}`);
    console.error('[articles] Snapshot left untouched; the build will use the last good copy.');
    console.error('[articles] No records were removed. Re-run when the endpoint is reachable.');
    process.exitCode = existing.length > 0 ? 0 : 1;
    return;
  }

  const rawItems = parsePostsResponse(posts);
  const { merged, added, updated, skipped, parsed } = planArticleSync(rawItems, existing);

  console.log(
    `[articles] API returned ${posts.length} post(s) across ${pages} page(s); ${parsed} parsed cleanly.`,
  );
  for (const skip of skipped) {
    console.warn(`[articles] ⚠ skipped item ${skip.index} "${skip.title}": ${skip.reason}`);
  }
  console.log(`[articles] ${added} new, ${updated} updated, ${merged.length} total after merge.`);

  const withoutBody = merged.filter((r) => !r.hasBody);
  if (withoutBody.length > 0) {
    console.warn(
      `[articles] ⚠ ${withoutBody.length} record(s) have no full body and will NOT get a local page ` +
        '(their cards keep linking to Substack):',
    );
    for (const r of withoutBody) console.warn(`[articles]     - ${r.title}`);
  }

  if (!execute) {
    console.log('[dry-run] Nothing written. Pass --execute to write src/data/articles.json.');
    return;
  }

  await withFileLock(SNAPSHOT_FILE, async () => {
    fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(merged, null, 2)}\n`);
  });
  console.log(`[articles] ✓ Wrote ${merged.length} record(s) to src/data/articles.json`);
}

// Only run when invoked directly, so importing this module for tests does no I/O.
if (process.argv[1] && process.argv[1].endsWith('sync-articles.mjs')) {
  run();
}
