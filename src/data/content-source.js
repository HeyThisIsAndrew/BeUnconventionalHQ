import { XMLParser } from 'fast-xml-parser';

export const CONTENT_TTL_SECONDS = 60 * 30;

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

const ORDER = ['Film', 'TV', 'Gaming', 'Events'];

export function categorize(text) {
  const pool = (text || '').toLowerCase();
  let best = 'General';
  let bestScore = 0;
  for (const cat of ORDER) {
    const score = SIGNALS[cat].reduce(
      (sum, [weight, re]) => sum + (re.test(pool) ? weight : 0),
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

async function fetchText(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

export async function fetchArticles() {
  const xml = await fetchText(SUBSTACK_FEED);
  if (!xml.trim().startsWith('<?xml') && !xml.includes('<rss')) {
    throw new Error('Invalid Substack payload');
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
        ? `${desc.substring(0, 160).trim()}...`
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

async function fetchVideosFromRss() {
  const xml = await fetchText(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`
  );
  if (!xml.includes('<entry')) throw new Error('YouTube RSS had no entries');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const feed = parser.parse(xml);
  const raw = feed?.feed?.entry ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];

  return entries.map((entry) => {
    const title = cleanText(entry.title);
    const id = entry['yt:videoId'];
    const actualLink = entry.link?.['@_href'] || `https://www.youtube.com/watch?v=${id}`;
    return {
      title,
      link: actualLink,
      thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      category: categorize(title),
      date: formatDate(entry.published),
    };
  });
}

async function fetchVideosFromPage() {
  const html = await fetchText(`https://www.youtube.com/${YOUTUBE_HANDLE}/videos`);
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

  if (videos.length === 0) throw new Error('No videos parsed from page');
  return videos;
}

export async function fetchVideos() {
  try {
    return await fetchVideosFromRss();
  } catch {
    return await fetchVideosFromPage();
  }
}

export async function fetchContentBundle() {
  const [articles, videos] = await Promise.all([fetchArticles(), fetchVideos()]);
  return {
    articles,
    videos,
    fetchedAt: new Date().toISOString(),
  };
}
