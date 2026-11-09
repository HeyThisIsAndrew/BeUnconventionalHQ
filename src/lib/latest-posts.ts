/**
 * Latest Posts Feed: Lightweight, public feed query for external consumers
 * (such as heythisisandrew.com) to display the latest published content from
 * BE Unconventional HQ without brittle HTML scraping or manual updates.
 *
 * Provides:
 * - Versioned schema (`version: 1`)
 * - Exactly the 2 newest pieces: latest Article and latest Video,
 *   sorted chronologically descending by `publishedAt`.
 * - HTML entity decoding on titles.
 * - Card image source mapping with responsive srcset candidates.
 */

import { getCardImageSources } from './card-images.ts';

export const RESERVED_SLUGS = new Set(['topic', 'page']);

export interface ImageCandidate {
  src: string;
  width: number;
}

export interface LatestPostImage {
  src: string;
  candidates: ImageCandidate[];
}

export interface LatestPostItem {
  id: string;
  kind: 'article' | 'video';
  title: string;
  url: string;
  publishedAt: string;
  image: LatestPostImage;
}

export interface LatestPostsPayload {
  version: 1;
  items: LatestPostItem[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  middot: '·',
};

function decodeOnce(str: string): string {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Decode HTML/XML entities, handling double-encoded occurrences safely. */
export function decodeHtmlEntities(input: string): string {
  let s = input;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Strip tags/CDATA, decode entities, and collapse whitespace. */
export function cleanHeadline(input: string | null | undefined): string {
  if (!input) return '';
  return decodeHtmlEntities(
    String(input)
      .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ensure a URL is an absolute HTTPS string. */
export function toAbsoluteHttpsUrl(url: string, siteUrl: string = 'https://beunconventionalhq.com'): string {
  if (!url || typeof url !== 'string') {
    return new URL('/og-image.png', siteUrl).href;
  }
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, siteUrl).href;
}

/** Format card image with responsive srcset candidates. */
export function formatLatestPostImage(
  rawImage: unknown,
  siteUrl: string = 'https://beunconventionalhq.com',
): LatestPostImage {
  const fallback = new URL('/og-image.png', siteUrl).href;
  const rawUrl = typeof rawImage === 'string' ? rawImage.trim() : '';
  if (!rawUrl) {
    return { src: fallback, candidates: [] };
  }

  const sources = getCardImageSources(rawUrl);
  const rawSrc = sources.src || rawUrl;
  const src = toAbsoluteHttpsUrl(rawSrc, siteUrl);

  const candidates: ImageCandidate[] = [];
  const seenWidths = new Set<number>();

  if (sources.srcset) {
    const parts = sources.srcset.split(', ');
    for (const part of parts) {
      const trimmed = part.trim();
      const lastSpace = trimmed.lastIndexOf(' ');
      if (lastSpace > 0) {
        const candidateUrl = trimmed.slice(0, lastSpace).trim();
        const widthStr = trimmed.slice(lastSpace + 1).trim();
        if (widthStr.endsWith('w')) {
          const width = parseInt(widthStr.slice(0, -1), 10);
          if (
            candidateUrl &&
            !/\s/.test(candidateUrl) &&
            Number.isInteger(width) &&
            width > 0 &&
            width <= 4096 &&
            !seenWidths.has(width)
          ) {
            seenWidths.add(width);
            candidates.push({
              src: toAbsoluteHttpsUrl(candidateUrl, siteUrl),
              width,
            });
          }
        }
      }
    }
  }

  return { src, candidates };
}

export interface BuildLatestPostsOptions {
  siteUrl?: string;
  now?: number;
  /** For testing or custom data source injection. */
  articles?: any[];
  videos?: any[];
}

export async function buildLatestPosts(
  options: BuildLatestPostsOptions = {},
): Promise<LatestPostsPayload> {
  const siteUrl = options.siteUrl ?? 'https://beunconventionalhq.com';
  const now = options.now ?? Date.now();

  const articles = options.articles ?? (await import('./feed-items.ts')).getArticleItems();
  const videos = options.videos ?? (await (await import('./videos-source.ts')).getVideosUnified());

  // 1. Eligible articles
  const eligibleArticles: LatestPostItem[] = articles
    .filter((a: any) => {
      if (!a || !a.slug || RESERVED_SLUGS.has(a.slug)) return false;
      if (a.editorial?.hidden) return false;
      const rawDate = a.isoDate || a.date;
      const t = new Date(rawDate).getTime();
      return !Number.isNaN(t) && t <= now;
    })
    .map((a: any) => {
      const pubDate = new Date(a.isoDate || a.date);
      const url = toAbsoluteHttpsUrl(a.link || `/intel/${a.slug}`, siteUrl);
      return {
        id: a.slug,
        kind: 'article' as const,
        title: cleanHeadline(a.title),
        url,
        publishedAt: pubDate.toISOString(),
        image: formatLatestPostImage(a.image, siteUrl),
      };
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // 2. Eligible videos (public long-form published videos)
  const eligibleVideos: LatestPostItem[] = videos
    .filter((v: any) => {
      if (!v || (!v.youtubeId && !v.link)) return false;
      if (v.isShort || v.isLive) return false;
      if (v.contentStatus && v.contentStatus !== 'published') return false;
      const rawDate = v.publishedAt || v.date;
      const t = new Date(rawDate).getTime();
      return !Number.isNaN(t) && t <= now;
    })
    .map((v: any) => {
      const pubDate = new Date(v.publishedAt || v.date);
      const videoId = v.youtubeId;
      const url = videoId
        ? new URL(`/feed?play=${encodeURIComponent(videoId)}`, siteUrl).href
        : toAbsoluteHttpsUrl(v.link, siteUrl);
      return {
        id: videoId || v._id || 'video',
        kind: 'video' as const,
        title: cleanHeadline(v.title),
        url,
        publishedAt: pubDate.toISOString(),
        image: formatLatestPostImage(v.thumbnail || v.thumbnailUrl, siteUrl),
      };
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // 3. Selection: exactly 2 newest pieces: latest Article and latest Video
  const latestArticle = eligibleArticles[0];
  const latestVideo = eligibleVideos[0];

  let selected: LatestPostItem[] = [];

  if (latestArticle && latestVideo) {
    selected = [latestArticle, latestVideo];
  } else if (latestArticle) {
    selected = eligibleArticles.slice(0, 2);
  } else if (latestVideo) {
    selected = eligibleVideos.slice(0, 2);
  } else {
    selected = [];
  }

  // Sort chronologically descending by publishedAt
  selected.sort((a, b) => {
    const diff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  return {
    version: 1,
    items: selected,
  };
}
