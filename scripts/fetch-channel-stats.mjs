/**
 * Refreshes src/data/cache/channel-stats.json from the YouTube Data +
 * Analytics APIs. Deliberately its own `npm run refresh-analytics` command,
 * NOT chained into `refresh-content` (which `dev`/`build:live`/`start:full`
 * all run) - the Analytics half needs an OAuth token exchange plus 7
 * parallel report queries per run, and running that on every local dev
 * server start or every build would burn quota fast for no benefit, since
 * the result is a committed file the build just reads statically. Run this
 * on demand (locally, or via the "Update YouTube Analytics" GitHub Action's
 * workflow_dispatch) and commit the result - that's the only trigger.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../src/data/cache');
const STATS_FILE = path.join(CACHE_DIR, 'channel-stats.json');

const {
  YOUTUBE_API_KEY,
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REFRESH_TOKEN,
} = process.env;

const channelId = YOUTUBE_CHANNEL_ID || 'UC6P1J3z1jW7kU_y_XWjK2Q';

async function fetchStats() {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY is missing');
  }

  console.log('[channel-stats] Fetching public channel statistics...');
  const statsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`
  );
  if (!statsRes.ok) throw new Error('Failed to fetch public stats');
  const statsData = await statsRes.json();
  const s = statsData.items?.[0]?.statistics ?? {};
  
  let result = {
    followers: Number(s.subscriberCount ?? 0),
    totalViews: Number(s.viewCount ?? 0),
    itemCount: Number(s.videoCount ?? 0),
    fetchedAt: new Date().toISOString(),
  };

  // If OAuth creds are present, fetch analytics
  if (YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && YOUTUBE_REFRESH_TOKEN) {
    console.log('[channel-stats] Fetching private analytics...');
    const authRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const authData = await authRes.json();
    const access_token = authData.access_token;

    if (access_token) {
      const todayDate = new Date();
      const todayStr = todayDate.toISOString().split('T')[0];
      const thirtyDaysAgo = new Date(todayDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const startDateLifetime = '2020-01-01';

      const fetchAnalytics = async (params, overrideStart, overrideEnd) => {
        const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
        url.searchParams.append('ids', 'channel==MINE');
        url.searchParams.append('startDate', overrideStart || startDateLifetime);
        url.searchParams.append('endDate', overrideEnd || todayStr);
        for (const [k, v] of Object.entries(params)) {
          url.searchParams.append(k, v);
        }
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${access_token}` } });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Analytics API error: ${res.status} - ${body}`);
        }
        return res.json();
      };

      const [retentionData, demoData, geoData, views30DayData, deviceData, trafficData, subData, impressionsData] = await Promise.all([
        fetchAnalytics({ metrics: 'averageViewPercentage' }),
        fetchAnalytics({ dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }),
        fetchAnalytics({ dimensions: 'country', metrics: 'views', sort: '-views', maxResults: '3' }),
        fetchAnalytics({ metrics: 'views' }, thirtyDaysAgo, todayStr),
        fetchAnalytics({ dimensions: 'deviceType', metrics: 'views' }, thirtyDaysAgo, todayStr),
        fetchAnalytics({ dimensions: 'insightTrafficSourceType', metrics: 'views' }, thirtyDaysAgo, todayStr),
        fetchAnalytics({ dimensions: 'subscribedStatus', metrics: 'views' }, thirtyDaysAgo, todayStr),
        // Lifetime, matching retention/age/gender's default range - "Total
        // Impressions" is a from-the-beginning figure, distinct from the
        // 30-day views card already on the page.
        fetchAnalytics({ metrics: 'impressions' }),
      ]);

      let retentionPercent = retentionData?.rows?.[0]?.[0] || 0;
      
      let age18to34Percent = 0;
      let malePercent = 0;
      let femalePercent = 0;
      if (demoData?.rows) {
        for (const row of demoData.rows) {
          const pct = row[2] || 0;
          if (row[0] === 'age18-24' || row[0] === 'age25-34') age18to34Percent += pct;
          if (row[1] === 'male') malePercent += pct;
          if (row[1] === 'female') femalePercent += pct;
        }
      }

      const topGeos = geoData?.rows?.map(row => row[0]) || [];
      const views30Days = views30DayData?.rows?.[0]?.[0] || 0;

      let totalDeviceViews = 0;
      let tvViews = 0;
      if (deviceData?.rows) {
        for (const row of deviceData.rows) {
          totalDeviceViews += row[1] || 0;
          if (row[0] === 'TV') tvViews += row[1] || 0;
        }
      }
      const tvViewershipPercent = totalDeviceViews > 0 ? (tvViews / totalDeviceViews) * 100 : 0;

      let totalTrafficViews = 0;
      let searchViews = 0;
      if (trafficData?.rows) {
        for (const row of trafficData.rows) {
          totalTrafficViews += row[1] || 0;
          if (row[0] === 'YT_SEARCH') searchViews += row[1] || 0;
        }
      }
      const searchTrafficPercent = totalTrafficViews > 0 ? (searchViews / totalTrafficViews) * 100 : 0;

      let totalSubViews = 0;
      let unsubViews = 0;
      if (subData?.rows) {
        for (const row of subData.rows) {
          totalSubViews += row[1] || 0;
          if (row[0] === 'UNSUBSCRIBED') unsubViews += row[1] || 0;
        }
      }
      const unsubscribedPercent = totalSubViews > 0 ? (unsubViews / totalSubViews) * 100 : 0;

      const impressions = impressionsData?.rows?.[0]?.[0] || 0;

      result.analytics = {
        retentionPercent,
        age18to34Percent,
        malePercent,
        femalePercent,
        topGeos,
        views30Days,
        tvViewershipPercent,
        searchTrafficPercent,
        unsubscribedPercent,
        impressions,
      };
    } else {
      console.warn('[channel-stats] Auth failed, skipping analytics');
    }
  } else {
    console.warn('[channel-stats] No OAuth credentials, skipping analytics');
  }

  return result;
}

async function run() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    const stats = await fetchStats();
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
    console.log(`[channel-stats] Successfully cached channel stats to ${STATS_FILE}`);
  } catch (error) {
    console.error(`[channel-stats] Ingestion failed: ${error.message}`);
    // Check if file exists, if not write empty object to avoid build crashes
    try {
      await fs.access(STATS_FILE);
      console.log('[channel-stats] Kept existing cache');
    } catch {
      await fs.writeFile(STATS_FILE, JSON.stringify({}, null, 2));
      console.log('[channel-stats] Wrote empty cache object');
    }
  }
}

run();
