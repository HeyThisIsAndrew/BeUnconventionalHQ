/**
 * Read-only access to the content caches written at build time by
 * `scripts/fetch-feeds.mjs`. Importing from here keeps pages/components
 * decoupled from how the data is fetched.
 */
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'src', 'data', 'cache');

async function readCache(file) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const getArticles = () => readCache('articles.json');
export const getVideos = () => readCache('videos.json');
