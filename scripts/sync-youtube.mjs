/**
 * YouTube → Sanity ingestion sync.
 *
 * Pulls the channel's uploads from the YouTube Data API v3 and upserts a `video`
 * document per video into Sanity. The golden rule: the sync writes FACTUAL
 * fields every run and NEVER overwrites EDITORIAL fields (see scripts/youtube-sync.md).
 *
 * The upsert uses a deterministic document _id (`youtube-<videoId>`) so re-runs
 * are idempotent — no duplicates. Per video, one transaction does:
 *   1. createIfNotExists — seeds _id/_type/youtubeId/platform + editorial
 *      DEFAULTS (contentStatus, featured). This runs only the first time a
 *      video is seen; on later runs the doc already exists and it's a no-op.
 *   2. patch(set: syncedFields) — updates ONLY the factual fields, every run.
 *      Because the patch set contains no editorial keys, an editor's curation
 *      is never clobbered.
 *
 * Dry-run by default; pass --execute (with SANITY_WRITE_TOKEN) to write.
 *
 * The planning functions are pure and exported for offline unit tests. The
 * network/Sanity runner only executes when the file is invoked directly (the
 * Node equivalent of Python's `if __name__ == "__main__":`), so importing this
 * module for tests performs zero I/O.
 */
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createClient } from '@sanity/client';
import { createYouTubeClient } from '../src/lib/platforms/youtube.ts';

// Load environment variables from a .env file into process.env
config();

// ── Pure planning (unit-testable, no I/O) ────────────────────────────────────

/** Deterministic Sanity _id for a YouTube video — the duplicate-prevention key. */
export function videoDocId(youtubeId) {
  return `youtube-${youtubeId}`;
}

/**
 * Map a YouTubeVideo (from the client) to the Sanity video doc's SYNCED fields.
 * This is the single source of truth for what "factual" means — every key here
 * is overwritten each run; nothing else is touched.
 */
export function mapVideoToSyncedFields(video, now = new Date()) {
  return {
    youtubeId: video.id,
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnail,
    durationSeconds: video.durationSeconds,
    isShort: video.isShort,
    viewCount: video.viewCount,
    publishedAt: video.publishedAt,
    youtubeTags: video.tags,
    platform: 'youtube',
    lastSyncedAt: now.toISOString(),
  };
}

/**
 * Editorial defaults — seeded ONLY when a video document is first created, then
 * owned by editors forever. Deliberately minimal: new videos land as
 * "needs-review" so nothing auto-publishes to the site without curation.
 */
export const EDITORIAL_DEFAULTS = Object.freeze({
  contentStatus: 'needs-review',
  featured: false,
});

/**
 * The mutation plan for one video. `patch.set` contains ONLY synced fields, so
 * running this against an existing, curated document cannot overwrite editorial
 * data. Returned as data (not applied) so it can be asserted in tests.
 */
export function planVideoSync(video, now = new Date()) {
  const _id = videoDocId(video.id);
  return {
    _id,
    createIfNotExists: {
      _id,
      _type: 'video',
      youtubeId: video.id,
      platform: 'youtube',
      ...EDITORIAL_DEFAULTS,
    },
    patch: { set: mapVideoToSyncedFields(video, now) },
  };
}

// ── Network + Sanity runner (only when invoked directly) ─────────────────────

const COMMIT_CHUNK = 100; // videos per Sanity transaction

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
  const execute = process.argv.includes('--execute');
  const {
    YOUTUBE_API_KEY,
    YOUTUBE_CHANNEL_ID,
    SANITY_PROJECT_ID = '38nhxsib',
    SANITY_DATASET = 'production',
    SANITY_API_VERSION = '2024-03-01',
    SANITY_WRITE_TOKEN,
  } = process.env;

  if (!YOUTUBE_API_KEY) return fail('YOUTUBE_API_KEY is required.');
  if (!YOUTUBE_CHANNEL_ID) return fail('YOUTUBE_CHANNEL_ID is required.');
  if (execute && !SANITY_WRITE_TOKEN) return fail('--execute requires SANITY_WRITE_TOKEN.');

  const yt = createYouTubeClient({ apiKey: YOUTUBE_API_KEY });
  const sanity = createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: SANITY_API_VERSION,
    token: SANITY_WRITE_TOKEN,
    useCdn: false,
  });

  console.log(`Fetching uploads for channel ${YOUTUBE_CHANNEL_ID}…`);
  const ids = await collectUploadIds(yt, YOUTUBE_CHANNEL_ID);
  console.log(`Found ${ids.length} uploads. Fetching details…`);

  const videos = await yt.getVideoDetails(ids);
  console.log(`Fetched details for ${videos.length} videos.\n`);

  const now = new Date();
  const plans = videos.map((v) => ({ video: v, plan: planVideoSync(v, now) }));
  for (const { video } of plans) {
    console.log(`• ${video.id}  ${(video.title || '').slice(0, 70)}`);
  }

  if (!execute) {
    console.log(`\nDRY RUN — ${plans.length} video(s) would be upserted (editorial fields preserved). Re-run with --execute to write.`);
    return;
  }

  let written = 0;
  for (let i = 0; i < plans.length; i += COMMIT_CHUNK) {
    const chunk = plans.slice(i, i + COMMIT_CHUNK);
    const tx = sanity.transaction();
    for (const { plan } of chunk) {
      tx.createIfNotExists(plan.createIfNotExists);
      tx.patch(plan._id, { set: plan.patch.set });
    }
    await tx.commit();
    written += chunk.length;
    console.log(`  …committed ${written}/${plans.length}`);
  }
  console.log(`\n✔ Synced ${written} videos into Sanity (editorial fields untouched).`);
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
