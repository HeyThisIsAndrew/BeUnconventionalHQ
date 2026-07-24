/**
 * Content refresh utility for Be Unconventional HQ.
 *
 * Fetches the latest Substack articles and YouTube videos and writes them to
 * `src/data/cache/*.json`. Pages read these caches at render time, and the
 * self-hosted deployment rebuilds from them on a schedule.
 *
 * Every fetch is wrapped so a transient failure (WAF block, 404, rate limit)
 * never crashes the build: we fall back to the previous cache, and only write
 * an empty list if no cache exists yet.
 */
import fs from 'fs/promises';
import path from 'path';
import { fetchArticles, fetchVideos } from '../src/data/content-source.js';

const CACHE_DIR = path.join(process.cwd(), 'src', 'data', 'cache');
const ARTICLES_FILE = path.join(CACHE_DIR, 'articles.json');
const VIDEOS_FILE = path.join(CACHE_DIR, 'videos.json');

async function writeCache(file, items, label) {
  if (Array.isArray(items) && items.length > 0) {
    await fs.writeFile(file, JSON.stringify(items, null, 2));
    console.log(`[feeds] Cached ${items.length} ${label}.`);
    return;
  }
  // Fetch produced nothing — keep an existing cache rather than wiping it.
  try {
    await fs.access(file);
    console.warn(`[feeds] No new ${label}; keeping existing cache.`);
  } catch {
    await fs.writeFile(file, JSON.stringify([], null, 2));
    console.warn(`[feeds] No ${label} and no cache; wrote empty list.`);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function ingest(label, fetcher, file) {
  try {
    const items = await fetcher();
    await writeCache(file, items, label);
    return true;
  } catch (err) {
    console.error(`[feeds] ${label} ingestion failed: ${err.message}`);
    await writeCache(file, [], label); // preserves existing cache
    return false;
  }
}

async function run() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const results = await Promise.all([
    ingest('articles', fetchArticles, ARTICLES_FILE),
    ingest('videos', fetchVideos, VIDEOS_FILE),
  ]);
  if (results.includes(false)) process.exit(1);
}

run();
