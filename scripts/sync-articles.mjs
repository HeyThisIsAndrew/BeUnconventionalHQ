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

const PUBLICATION_URL = process.env.SUBSTACK_PUBLICATION_URL ?? 'https://beunconventionalhq.substack.com';
const POSTS_API_URL = process.env.SUBSTACK_POSTS_API_URL ?? `${PUBLICATION_URL}/api/v1/posts`;
const SNAPSHOT_FILE = path.join(process.cwd(), 'src', 'data', 'articles.json');

/**
 * Posts requested per request, and the ceiling on how many requests one sync
 * will make.
 *
 * ─── WHY THIS PAGINATES AT ALL ────────────────────────────────────────────
 * A single `?limit=50` call is fine until the publication passes 50 posts, and
 * then it quietly stops being fine in a way that does NOT show up as an error:
 *
 *   • the archive itself is safe — mergeSnapshot() never deletes, so posts
 *     that fall out of the newest-50 window stay in src/data/articles.json and
 *     their URLs keep resolving;
 *   • but those older posts stop being UPDATED. Retitle, retag or fix a typo
 *     in post #60 and the sync can no longer see it, so the site keeps serving
 *     the stale copy forever;
 *   • and a cold rebuild (snapshot lost, or a fresh clone syncing before the
 *     committed snapshot exists) would recover only 50 posts.
 *
 * Walking `offset` until the pages run out removes all three. MAX_PAGES is a
 * runaway guard, not an expected limit.
 */
const PAGE_SIZE = Number(process.env.SUBSTACK_PAGE_SIZE ?? 50);
const MAX_PAGES = 40;

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
    const link = String(post?.canonical_url ?? '').trim() || (slug ? `${PUBLICATION_URL}/p/${slug}` : '');

    return {
      title: String(post?.title ?? '').trim(),
      link,
      guid: String(post?.id ?? link ?? '').trim(),
      pubDate: String(post?.post_date ?? '').trim(),
      description: String(post?.subtitle ?? post?.description ?? '').trim(),
      contentEncoded: String(post?.body_html ?? '').trim(),
      categories: mapTags(post),
      enclosureUrl: String(post?.cover_image ?? '').trim(),
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

/** Build one page's URL, preserving any query already on the base URL. */
export function buildPostsPageUrl(base, offset, limit = PAGE_SIZE) {
  const url = new URL(base);
  url.searchParams.set('limit', String(limit));
  if (offset > 0) url.searchParams.set('offset', String(offset));
  return url.toString();
}

/**
 * Fetch one page of the publication's posts JSON.
 *
 * Browser-like headers because this is the same route the publication's own
 * front end calls when it loads the page — not a different, unsupported
 * access path, just skipping the HTML render around it.
 */
async function fetchPostsPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('response was not a JSON array of posts');
  return json;
}

/** Stable per-post key for duplicate detection across pages. */
function postKey(post) {
  return String(post?.id ?? post?.slug ?? post?.canonical_url ?? '');
}

/**
 * Walk every page of posts, newest first, and return them all.
 *
 * Stops on the first page that is empty, short (fewer than PAGE_SIZE — there
 * is nothing after it), or contributes no post we have not already seen.
 *
 * That last condition is deliberate insurance: `offset` is undocumented like
 * the rest of this endpoint, and an endpoint that silently IGNORED it would
 * hand back page 1 over and over. Detecting the repeat degrades this to
 * exactly the old single-page behaviour instead of looping MAX_PAGES times.
 */
async function fetchAllPosts() {
  const collected = [];
  const seen = new Set();
  let pages = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = buildPostsPageUrl(POSTS_API_URL, page * PAGE_SIZE);
    const batch = await fetchPostsPage(url);
    pages += 1;
    if (batch.length === 0) break;

    const fresh = batch.filter((post) => {
      const key = postKey(post);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    collected.push(...fresh);

    if (fresh.length === 0) {
      if (page > 0) {
        console.warn(
          '[articles] ⚠ page ' +
            (page + 1) +
            ' repeated posts already seen — treating the archive as complete. ' +
            '(If the publication has more, the endpoint is ignoring `offset`.)',
        );
      }
      break;
    }
    if (batch.length < PAGE_SIZE) break;
  }

  return { posts: collected, pages };
}

async function run() {
  const execute = process.argv.includes('--execute');
  const existing = readSnapshot();

  console.log(`[articles] Snapshot holds ${existing.length} record(s).`);
  console.log(`[articles] Fetching ${POSTS_API_URL} (${PAGE_SIZE}/page)`);

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
