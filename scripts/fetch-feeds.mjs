/**
 * Build-time content ingestion for Be Unconventional HQ.
 *
 * Fetches the latest Substack articles and YouTube videos once per build and
 * writes them to `src/data/cache/*.json`. Pages read these caches at render
 * time, so the live site always shows real, up-to-date content without making
 * a network request for every page during the build.
 *
 * Every fetch is wrapped so a transient failure (WAF block, 404, rate limit)
 * never crashes the build: we fall back to the previous cache, and only write
 * an empty list if no cache exists yet.
 */
import fs from 'fs/promises';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

const CACHE_DIR = path.join(process.cwd(), 'src', 'data', 'cache');
const ARTICLES_FILE = path.join(CACHE_DIR, 'articles.json');
const VIDEOS_FILE = path.join(CACHE_DIR, 'videos.json');

const SUBSTACK_FEED = 'https://beunconventionalhq.substack.com/feed';
const YOUTUBE_HANDLE = '@BeUnconventionalHQ';
const YOUTUBE_CHANNEL_ID = 'UCXqU6781pQgYXDExLvMw2Og';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
};

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=800&q=80';

// ── Shared helpers ──────────────────────────────────────────────────────────

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Weighted keyword classification, shared by articles and videos.
 *
 * Each category has signals scored by strength (3 = strong, 1 = weak). We sum
 * the matched weights per category and pick the highest; ties resolve by the
 * order in ORDER. This is far better than a flat keyword check because it reads
 * phrasing ("out of theater reaction" → Film, "season 4" / streaming services →
 * TV, conventions → Events) and recognizes recurring franchises by name.
 *
 * It's still heuristic, not AI — to extend it, add terms to the relevant list.
 */
const SIGNALS = {
  Film: [
    [
      3,
      /\b(movie review|out of (the )?theat(er|re)|in theat(er|re)s|4dx|box office|first impression|trailer reaction)\b/,
    ],
    [
      3,
      /\b(odyssey|accountant|warfare|sinners|the amateur|minecraft movie|alien:? ?romulus|romulus|fall guy|boy kills world|monkey man|godzilla|kong|batman|dune|nosferatu|mortal kombat 2)\b/,
    ],
    [2, /\b(movie|film|cinema|cinematic|theatrical|theat(er|re))\b/],
    [1, /\b(review|reaction|trailer)\b/],
  ],
  TV: [
    [3, /\b(season \d+|episode|spoiler-free|series premiere)\b/],
    [
      3,
      /\b(netflix|syfy|hulu|hbo|disney\+|prime video|peacock|paramount\+|apple tv)\b/,
    ],
    [
      3,
      /\b(final space|umbrella academy|resident alien|the boys|invincible|succession|the last of us|severance|house of the dragon|wednesday|daredevil|loki)\b/,
    ],
    [2, /\b(series|tv show|finale|binge|streaming)\b/],
  ],
  Gaming: [
    [
      3,
      /\b(gameplay|playthrough|game review|boss fight|speedrun|elden ring|zelda|mario|mortal kombat 1|playstation|xbox|nintendo|steam deck)\b/,
    ],
    [2, /\b(gaming|gamer|video game)\b/],
    [1, /\bgame\b/],
  ],
  Events: [
    [
      3,
      /\b(wondercon|comic-? ?con|sdcc|expo|festival|red carpet|premiere|convention|bts filming|foodtopia)\b/,
    ],
    [2, /\b(vlog|on location|live coverage|behind the scenes)\b/],
    [1, /\bcon\b/],
  ],
};

// Tie-break priority (this channel skews film/TV).
const ORDER = ['Film', 'TV', 'Gaming', 'Events'];

function categorize(text) {
  const pool = (text || '').toLowerCase();
  let best = 'General';
  let bestScore = 0;
  for (const cat of ORDER) {
    const score = SIGNALS[cat].reduce(
      (sum, [w, re]) => sum + (re.test(pool) ? w : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

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

// ── Articles (Substack RSS) ──────────────────────────────────────────────────

async function fetchArticles() {
  console.log(`[feeds] Fetching Substack: ${SUBSTACK_FEED}`);
  const res = await fetch(SUBSTACK_FEED, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const xml = await res.text();
  if (!xml.trim().startsWith('<?xml') && !xml.includes('<rss')) {
    throw new Error('Invalid payload (WAF block or HTML challenge).');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const result = parser.parse(xml);
  const raw = result?.rss?.channel?.item ?? [];
  const items = Array.isArray(raw) ? raw : [raw];

  return items.slice(0, 20).map((item) => {
    const title = cleanText(item.title);
    const desc = cleanText(item.description || '');
    const excerpt =
      desc.length > 20
        ? desc.substring(0, 160).trim() + '...'
        : 'Read the full article on Substack.';
    return {
      title,
      link: item.link,
      date: formatDate(item.pubDate),
      excerpt,
      image: item.enclosure?.['@_url'] || FALLBACK_IMAGE,
      category: categorize(`${title} ${desc}`),
    };
  });
}

// ── Videos (YouTube RSS, with page-scrape fallback) ──────────────────────────

async function fetchVideosFromRss() {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes('<entry')) throw new Error('RSS had no entries');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const feed = parser.parse(xml);
  const raw = feed?.feed?.entry ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];

  return entries.map((e) => {
    const title = cleanText(e.title);
    const id = e['yt:videoId'];
    return {
      title,
      link: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      category: categorize(title),
      date: formatDate(e.published),
    };
  });
}

/**
 * Fallback: scrape the channel's Videos tab. YouTube embeds the listing as
 * JSON in `ytInitialData`; modern layouts use `lockupViewModel` nodes.
 */
async function fetchVideosFromPage() {
  const url = `https://www.youtube.com/${YOUTUBE_HANDLE}/videos`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`page HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s);
  if (!match) throw new Error('ytInitialData not found');
  const data = JSON.parse(match[1]);

  const videos = [];
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const lockup = node.lockupViewModel;
    if (lockup?.contentId && !seen.has(lockup.contentId)) {
      const id = lockup.contentId;
      const title =
        lockup.metadata?.lockupMetadataViewModel?.title?.content ?? '';
      if (title) {
        seen.add(id);
        videos.push({
          title: cleanText(title),
          link: `https://www.youtube.com/watch?v=${id}`,
          thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
          category: categorize(title),
          date: '',
        });
      }
    }
    for (const key in node) walk(node[key]);
  })(data);

  if (videos.length === 0) throw new Error('no videos parsed from page');
  return videos;
}

async function fetchVideos() {
  try {
    console.log('[feeds] Fetching YouTube RSS...');
    return await fetchVideosFromRss();
  } catch (rssErr) {
    console.warn(
      `[feeds] YouTube RSS failed (${rssErr.message}); scraping page.`
    );
    return await fetchVideosFromPage();
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function ingest(label, fetcher, file) {
  try {
    const items = await fetcher();
    await writeCache(file, items, label);
  } catch (err) {
    console.error(`[feeds] ${label} ingestion failed: ${err.message}`);
    await writeCache(file, [], label); // preserves existing cache
  }
}

async function run() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await Promise.all([
    ingest('articles', fetchArticles, ARTICLES_FILE),
    ingest('videos', fetchVideos, VIDEOS_FILE),
  ]);
}

run();
