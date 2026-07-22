/**
 * YouTube → Local JSON ingestion sync — Taxonomy-as-Code edition.
 *
 * Local-JSON counterpart to the old Sanity sync: pulls the channel's uploads
 * from the YouTube Data API v3 and upserts a video/short/live doc per video
 * into src/data/videos.json, using the same three-field-class contract
 * (FACTUAL/DERIVED/EDITORIAL - see planVideoSync).
 *
 * Hub taxonomy (topics is still Tier-1-seed-only; hubs come from the
 * featuredBrand/event docs already living in videos.json) is rebuilt from
 * each doc's `youtubeSyncKeywords`, keyed by `slug.current` - the local
 * equivalent of the old "build the dictionary FROM SANITY every run".
 *
 * Dry-run by default; pass --execute to write src/data/videos.json. Pure
 * planning functions are exported for offline tests; importing this module
 * performs zero I/O.
 */
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import fs from 'node:fs';

import { createYouTubeClient } from '../src/lib/platforms/youtube.ts';

config();

export function videoDocId(youtubeId) {
  return `youtube-${youtubeId}`;
}

export const UNCATEGORIZED_TOPIC_ID = 'topic-uncategorized';

export const TIER1_TOPIC_SEEDS = Object.freeze([
  { _id: 'topic-film', title: 'Film', slug: 'film', isTier1Category: true, keywords: ['film', 'movie', 'movies'] },
  { _id: 'topic-tv', title: 'TV', slug: 'tv', isTier1Category: true, keywords: ['tv', 'television', 'tv show', 'series'] },
  { _id: 'topic-gaming', title: 'Gaming', slug: 'gaming', isTier1Category: true, keywords: ['gaming', 'game', 'games', 'video game', 'video games'] },
  { _id: 'topic-events', title: 'Events', slug: 'events', isTier1Category: true, keywords: ['event', 'events', 'convention'] },
  { _id: UNCATEGORIZED_TOPIC_ID, title: 'Uncategorized', slug: 'uncategorized', isTier1Category: false, keywords: [] },
]);

export function normalizeTag(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Local equivalent of the old `*[_type in ["featuredBrand", "event"]]`
 * dictionary source: featuredBrand/event docs, keyed by slug, contribute
 * their youtubeSyncKeywords as hub match keywords.
 */
export function extractHubSeeds(existingDocs) {
  return existingDocs
    .filter((d) => (d?._type === 'featuredBrand' || d?._type === 'event') && d?.slug?.current)
    .map((d) => ({ slug: d.slug.current, keywords: d.youtubeSyncKeywords ?? [] }));
}

export function buildTaxonomyDictionary({ topics = [], hubs = [] }) {
  const tier1 = new Map();
  const hubMap = new Map();
  const collisions = [];

  const add = (map, keyword, id, kind) => {
    const key = normalizeTag(keyword);
    if (!key) return;
    const existing = map.get(key);
    if (existing && existing !== id) {
      collisions.push({ keyword: key, kind, kept: existing, ignored: id });
      return;
    }
    map.set(key, id);
  };

  for (const t of topics) {
    if (!t?.isTier1Category) continue;
    for (const k of t.keywords ?? []) add(tier1, k, t.slug, 'topic');
  }
  for (const h of hubs) {
    for (const k of h?.keywords ?? []) add(hubMap, k, h.slug, 'hub');
  }
  return { tier1, hubs: hubMap, collisions };
}

export function matchVideoTags(youtubeTags, dict) {
  const topicIds = [];
  const hubIds = [];
  for (const raw of youtubeTags ?? []) {
    const key = normalizeTag(raw);
    const topicId = dict.tier1.get(key);
    if (topicId && !topicIds.includes(topicId)) topicIds.push(topicId);
    const hubId = dict.hubs.get(key);
    if (hubId && !hubIds.includes(hubId)) hubIds.push(hubId);
  }
  const requiresReview = topicIds.length === 0;
  if (requiresReview) topicIds.push('uncategorized');
  return { topicIds, hubIds, requiresReview };
}

export function mapVideoToSyncedFields(video, now = new Date()) {
  return {
    youtubeId: video.id,
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnail,
    durationSeconds: video.durationSeconds,
    isShort: video.isShort,
    isLive: video.isLive,
    isEvent: video.isEvent,
    viewCount: video.viewCount,
    publishedAt: video.publishedAt,
    youtubeTags: video.tags,
    platform: 'youtube',
    lastSyncedAt: now.toISOString(),
  };
}

export function planVideoSync(video, match, existingDoc, now = new Date()) {
  const _id = videoDocId(video.id);

  // 1. Calculate the standard synced factual fields
  const syncedFields = mapVideoToSyncedFields(video, now);

  // 2. Check for manual type override
  let docType = existingDoc?.manualTypeOverride || null;
  if (!docType) {
    if (video.isShort) docType = 'short';
    else if (video.isLive) docType = 'live';
    else docType = 'video';
  }

  // 3. Determine Taxonomy (respecting manualTaxonomyOverride)
  const manualTaxonomyOverride = existingDoc?.manualTaxonomyOverride ?? false;
  const topics = manualTaxonomyOverride ? (existingDoc?.topics ?? []) : match.topicIds;
  const hubs = manualTaxonomyOverride ? (existingDoc?.hubs ?? []) : match.hubIds;
  const requiresReview = manualTaxonomyOverride ? (existingDoc?.requiresReview ?? false) : match.requiresReview;

  // 4. Determine contentStatus (never overwrite a human's choice; promote if tags fixed)
  let contentStatus = existingDoc?.contentStatus;
  if (!contentStatus || contentStatus === 'needs-review') {
      contentStatus = requiresReview ? 'needs-review' : 'published';
  }

  return {
    _id,
    _type: docType,
    ...syncedFields,

    // Editorial fields
    contentStatus,
    manualTypeOverride: existingDoc?.manualTypeOverride ?? '',
    featured: existingDoc?.featured ?? false,
    franchises: existingDoc?.franchises ?? [],
    characters: existingDoc?.characters ?? [],
    coverageType: existingDoc?.coverageType ?? '',
    series: existingDoc?.series ?? '',
    editorialNotes: existingDoc?.editorialNotes ?? '',

    // Taxonomy fields
    topics,
    hubs,
    requiresReview,
    manualTaxonomyOverride,
  };
}

async function collectUploadIds(yt, channelId) {
  const ids = [];
  let pageToken;
  do {
    const { videos, nextPageToken } = await yt.getUploads(channelId, pageToken);
    ids.push(...videos.map((v) => v.id));
    pageToken = nextPageToken;
  } while (pageToken);
  return ids;
}

async function run() {
  const {
    YOUTUBE_API_KEY,
    YOUTUBE_CHANNEL_ID,
  } = process.env;

  if (!YOUTUBE_API_KEY) return fail('YOUTUBE_API_KEY is required.');
  if (!YOUTUBE_CHANNEL_ID) return fail('YOUTUBE_CHANNEL_ID is required.');

  const execute = process.argv.includes('--execute');

  const outPath = fileURLToPath(new URL('../src/data/videos.json', import.meta.url));

  let existingDocsMap = new Map();
  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      for (const d of existing) {
        existingDocsMap.set(d._id, d);
      }
    } catch (e) {
      console.warn("Failed to parse existing videos.json. Proceeding with empty state.");
    }
  }

  const hubSeeds = extractHubSeeds(Array.from(existingDocsMap.values()));
  const dict = buildTaxonomyDictionary({ topics: TIER1_TOPIC_SEEDS, hubs: hubSeeds });

  const yt = createYouTubeClient({ apiKey: YOUTUBE_API_KEY });
  console.log(`\nFetching uploads for channel ${YOUTUBE_CHANNEL_ID}…`);
  const ids = await collectUploadIds(yt, YOUTUBE_CHANNEL_ID);
  console.log(`Found ${ids.length} uploads. Fetching details…`);
  const videos = await yt.getVideoDetails(ids);

  const now = new Date();
  const syncedDocs = videos.map((v) => {
    const match = matchVideoTags(v.tags, dict);
    const existingDoc = existingDocsMap.get(videoDocId(v.id));
    return planVideoSync(v, match, existingDoc, now);
  });

  const syncedIds = new Set(syncedDocs.map(d => d._id));
  const preservedDocs = Array.from(existingDocsMap.values()).filter(d => !syncedIds.has(d._id));
  const docs = [...syncedDocs, ...preservedDocs];

  const needsReviewCount = syncedDocs.filter((d) => d.requiresReview).length;

  if (!execute) {
    console.log(`\n[dry-run] Would sync ${docs.length} docs (${syncedDocs.length} from YouTube, ${preservedDocs.length} preserved) to ${outPath}.`);
    console.log(`[dry-run] ${needsReviewCount} video(s) would need review (no Tier-1/hub tag match).`);
    console.log('[dry-run] Pass --execute to write.');
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(docs, null, 2));
  console.log(`\n✔ Synced ${docs.length} videos locally to ${outPath}.`);
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error('Sync failed:', err?.message || err);
    process.exit(1);
  });
}
