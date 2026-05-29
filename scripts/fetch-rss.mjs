import fs from 'fs/promises';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

const CACHE_DIR = path.join(process.cwd(), 'src', 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'articles.json');
const RSS_URL = 'https://beunconventionalhq.substack.com/feed';

// Replicate category mapping logic locally to ensure standalone execution
const CATEGORIES = {
  MOVIES: 'Film',
  TV: 'TV',
  GAMING: 'Gaming',
  EVENTS: 'Events'
};

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<[^>]+>/g, '') // Strip all HTML tags
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

async function run() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  try {
    console.log(`[RSS] Fetching Substack feed: ${RSS_URL}`);
    const response = await fetch(RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Substack WAF block detected: Received text/html instead of XML.`);
    }

    const xml = await response.text();

    if (!xml.trim().startsWith('<?xml') && !xml.includes('<rss')) {
      console.error('[RSS] FATAL: Received invalid payload (WAF block or HTML challenge). Snippet:');
      console.error(xml.substring(0, 800));
      throw new Error('Payload is not valid XML.');
    }

    // Use a real XML parser instead of Regex
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const result = parser.parse(xml);

    const items = result?.rss?.channel?.item || [];
    const feedItems = Array.isArray(items) ? items : [items];

    const normalizedArticles = feedItems.slice(0, 20).map(item => {
      const title = cleanText(item.title);
      const desc = cleanText(item.description || '');
      
      let category = 'General';
      const searchPool = (title + desc).toLowerCase();
      if (searchPool.includes('movie') || searchPool.includes('film') || searchPool.includes('batman') || searchPool.includes('dune')) category = CATEGORIES.MOVIES;
      else if (searchPool.includes('tv') || searchPool.includes('show') || searchPool.includes('series') || searchPool.includes('boys')) category = CATEGORIES.TV;
      else if (searchPool.includes('game') || searchPool.includes('gaming') || searchPool.includes('elden') || searchPool.includes('mortal kombat')) category = CATEGORIES.GAMING;

      const excerpt = desc.length > 20 ? desc.substring(0, 160).trim() + '...' : 'Read the full article on Substack.';
      const image = item.enclosure?.['@_url'] || 'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=800&q=80';
      const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

      return {
        title,
        link: item.link,
        date,
        excerpt,
        image,
        category
      };
    });

    await fs.writeFile(CACHE_FILE, JSON.stringify(normalizedArticles, null, 2));
    console.log(`[RSS] Successfully parsed and cached ${normalizedArticles.length} articles to ${CACHE_FILE}`);

  } catch (error) {
    console.error(`[RSS] Ingestion Failed: ${error.message}`);
    
    // SAFE FALLBACK: Do not crash the build
    try {
      await fs.access(CACHE_FILE);
      console.log(`[RSS] Fallback: Using existing cache file.`);
    } catch {
      console.log(`[RSS] Fallback: No cache file exists. Writing empty array to prevent build crash.`);
      await fs.writeFile(CACHE_FILE, JSON.stringify([]));
    }
  }
}

run();