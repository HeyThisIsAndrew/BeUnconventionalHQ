/**
 * YouTube Data API v3 adapter — the reusable YouTube data layer for #21.
 *
 * ISOMORPHIC BY DESIGN. It uses only `fetch`, `URL`, and `URLSearchParams`,
 * which exist in BOTH runtimes this project targets:
 *   • Node (build-time ingestion/sync scripts → Sanity)
 *   • Cloudflare Workers edge (the /api/live-status endpoint for #20)
 * The API key is INJECTED by the caller (not read from process.env in here), so
 * the same module works in a Node script (process.env.YOUTUBE_API_KEY) and in
 * an edge handler (locals.runtime.env.YOUTUBE_API_KEY) with zero duplication.
 *
 * Caching is intentionally NOT built in — it belongs to each caller: build
 * scripts use the cache-preserve pattern; the edge endpoint uses Cache-Control
 * (see the quota note on getLiveStatus). This keeps the client thin and pure.
 */
import type { ChannelStats } from './types';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeClientOptions {
  apiKey: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /**
   * Injectable fetch — defaults to the global. Lets tests run offline with a
   * stub, and lets an edge handler pass its runtime fetch if needed.
   */
  fetchImpl?: typeof fetch;
}

export interface YouTubeAnalytics {
  retentionPercent: number;
  age18to34Percent: number;
  malePercent: number;
  femalePercent: number;
  topGeos: string[];
}

/** Rich, YouTube-specific video model (this is a CONTENT type, not shared). */
export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string; // ISO-8601
  durationSeconds: number;
  viewCount: number;
  tags: string[];
  /** Heuristic: <= 60s. True Shorts detection needs a URL probe; documented. */
  isShort: boolean;
  isLive: boolean;
  isEvent: boolean;
}

export interface LiveStatus {
  isLive: boolean;
  videoId: string | null;
  title?: string;
}

export class YouTubeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
  }
}

// ── Pure helpers (exported for unit testing; zero I/O) ───────────────────────

const VIDEO_ID_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:.*&)?v=))([A-Za-z0-9_-]{11})/;

/**
 * Canonical 11-char video ID from any YouTube URL/ID form (watch, youtu.be,
 * embed, shorts, live, bare id, with extra query params), else null. This is
 * the single validated replacement for the ~5 hand-rolled regexes scattered
 * across the components.
 */
export function parseVideoId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // already a bare id
  const m = s.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

/** ISO-8601 duration ("PT1H2M3S") → seconds. Returns 0 for anything unparseable. */
export function parseISO8601Duration(iso: string | null | undefined): number {
  if (typeof iso !== 'string') return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, h, min, sec] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(sec) || 0);
}

/** Best available thumbnail URL from a snippet.thumbnails object. */
export function pickThumbnail(thumbnails: any): string {
  if (!thumbnails) return '';
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ''
  );
}

// ── Client factory ───────────────────────────────────────────────────────────

export function createYouTubeClient(opts: YouTubeClientOptions) {
  const { apiKey, fetchImpl } = opts;
  if (!apiKey) throw new Error('createYouTubeClient: apiKey is required');
  const doFetch = fetchImpl || fetch;

  async function apiGet(resource: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${API_BASE}/${resource}`);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    const res = await doFetch(url.toString());
    if (!res.ok) {
      let reason = res.statusText;
      try {
        const body = await res.json();
        reason = body?.error?.message || reason;
      } catch {
        /* non-JSON error body */
      }
      throw new YouTubeApiError(`YouTube API ${resource} failed: ${reason}`, res.status);
    }
    return res.json();
  }

  return {
    parseVideoId,

    async getVideoDetails(ids: string[]): Promise<YouTubeVideo[]> {
      const clean = [...new Set(ids.map(parseVideoId).filter((x): x is string => !!x))];
      const out: YouTubeVideo[] = [];
      for (let i = 0; i < clean.length; i += 50) {
        const batch = clean.slice(i, i + 50);
        const data = await apiGet('videos', {
          part: 'snippet,contentDetails,statistics',
          id: batch.join(','),
        });

        const verifiedItems = await Promise.all(
          (data.items || []).map(async (item: any) => {
            let isShort = false;
            try {
              const checkShortUrl = `https://www.youtube.com/shorts/${item.id}`;
              const response = await doFetch(checkShortUrl, { method: 'HEAD', redirect: 'manual' });
              // YouTube returns 200 for Shorts, 303 for standard videos redirecting to /watch
              isShort = response.status === 200;
            } catch (err) {
              console.error(`Short network check failed for ${item.id}`, err);
            }
            return { item, isShort };
          })
        );

        for (const { item, isShort } of verifiedItems) {
          const durationSeconds = parseISO8601Duration(item.contentDetails?.duration);
          const tags = Array.isArray(item.snippet?.tags) ? item.snippet.tags : [];
          
          const isLive = tags.some((t: string) => {
            const normalized = t.toLowerCase();
            return normalized === 'live' || normalized === 'live stream' || normalized === 'lives';
          });
          
          const isEvent = tags.some((t: string) => {
            const normalized = t.toLowerCase();
            return normalized === 'event' || normalized === 'events' || normalized === 'con' || normalized === 'panel';
          });

          out.push({
            id: item.id,
            title: item.snippet?.title ?? '',
            description: item.snippet?.description ?? '',
            thumbnail: pickThumbnail(item.snippet?.thumbnails),
            publishedAt: item.snippet?.publishedAt ?? '',
            durationSeconds,
            viewCount: Number(item.statistics?.viewCount ?? 0),
            tags,
            isShort,
            isLive,
            isEvent,
          });
        }
      }
      return out;
    },

    /**
     * channels.list — 1 quota unit per call. Returns the NORMALIZED,
     * cross-platform ChannelStats shape (subscribers → followers), so future
     * Instagram/TikTok adapters return the same shape for the Media Kit.
     */
    async getChannelStats(channelId: string): Promise<ChannelStats> {
      const data = await apiGet('channels', { part: 'statistics', id: channelId });
      const s = data.items?.[0]?.statistics ?? {};
      return {
        platform: 'youtube',
        followers: Number(s.subscriberCount ?? 0),
        totalViews: Number(s.viewCount ?? 0),
        itemCount: Number(s.videoCount ?? 0),
        fetchedAt: new Date().toISOString(),
      };
    },

    /**
     * List a channel's uploads (for ingestion). ~1 unit for the channel lookup
     * + 1 unit per page of playlistItems. Paginate with the returned token.
     */
    async getUploads(
      channelId: string,
      pageToken?: string
    ): Promise<{ videos: { id: string; title: string; publishedAt: string }[]; nextPageToken?: string }> {
      const ch = await apiGet('channels', { part: 'contentDetails', id: channelId });
      const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return { videos: [] };
      const params: Record<string, string> = {
        part: 'snippet,contentDetails',
        maxResults: '50',
        playlistId: uploads,
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await apiGet('playlistItems', params);
      const videos = (data.items || [])
        .map((it: any) => ({
          id: it.contentDetails?.videoId,
          title: it.snippet?.title ?? '',
          publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? '',
        }))
        .filter((v: any) => v.id);
      return { videos, nextPageToken: data.nextPageToken };
    },

    /**
     * Live-status check for #20's takeover billboard.
     *
     * ⚠️ QUOTA: search.list costs 100 units/call (vs 1 for the others). Free
     * tier is 10,000 units/day, so this is ~100 checks/day of headroom. The
     * CALLER must cache aggressively — a naive 5-min poll = 288 calls/day =
     * 28,800 units, ~3× over quota. The /api/live-status endpoint caches at the
     * edge accordingly (and can gate this behind a 0-quota RSS/scrape signal).
     */
    async getLiveStatus(channelId: string): Promise<LiveStatus> {
      const data = await apiGet('search', {
        part: 'snippet',
        channelId,
        eventType: 'live',
        type: 'video',
        maxResults: '1',
      });
      const item = data.items?.[0];
      if (item?.id?.videoId) {
        return { isLive: true, videoId: item.id.videoId, title: item.snippet?.title };
      }
      return { isLive: false, videoId: null };
    },

    /**
     * Fetch private channel analytics like retention, demographics, and top geos.
     * Requires OAuth parameters to be passed in YouTubeClientOptions.
     */
    async getAnalytics(): Promise<YouTubeAnalytics | null> {
      if (!opts.clientId || !opts.clientSecret || !opts.refreshToken) return null;
      try {
        const authRes = await doFetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
            refresh_token: opts.refreshToken,
            grant_type: 'refresh_token'
          })
        });
        const authData = await authRes.json();
        const access_token = authData.access_token;
        if (!access_token) return null;

        const today = new Date().toISOString().split('T')[0];
        const startDate = '2020-01-01'; // Safe baseline for lifetime stats

        const fetchAnalytics = async (params: Record<string, string>) => {
          const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
          url.searchParams.append('ids', 'channel==MINE');
          url.searchParams.append('startDate', startDate);
          url.searchParams.append('endDate', today);
          for (const [k, v] of Object.entries(params)) {
             url.searchParams.append(k, v);
          }
          const res = await doFetch(url.toString(), { headers: { Authorization: `Bearer ${access_token}` } });
          return res.json();
        };

        const [retentionData, demoData, geoData] = await Promise.all([
          fetchAnalytics({ metrics: 'averageViewPercentage' }),
          fetchAnalytics({ dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }),
          fetchAnalytics({ dimensions: 'country', metrics: 'views', sort: '-views', maxResults: '3' })
        ]);

        let retentionPercent = 0;
        if (retentionData?.rows?.[0]?.[0]) {
           retentionPercent = retentionData.rows[0][0];
        }

        let age18to34Percent = 0;
        let malePercent = 0;
        let femalePercent = 0;
        if (demoData?.rows) {
           for (const row of demoData.rows) {
               const age = row[0];
               const gender = row[1];
               const pct = row[2] || 0;
               if (age === 'age18-24' || age === 'age25-34') {
                   age18to34Percent += pct;
               }
               if (gender === 'male') malePercent += pct;
               if (gender === 'female') femalePercent += pct;
           }
        }

        const topGeos = [];
        if (geoData?.rows) {
           for (const row of geoData.rows) {
               topGeos.push(row[0]);
           }
        }

        return {
           retentionPercent,
           age18to34Percent,
           malePercent,
           femalePercent,
           topGeos
        };
      } catch (err) {
        console.error("Failed to fetch YouTube analytics", err);
        return null;
      }
    },
  };
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>;
