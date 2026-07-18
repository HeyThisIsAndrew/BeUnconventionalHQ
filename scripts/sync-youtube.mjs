/**
 * YouTube → Sanity ingestion sync — Taxonomy-as-Code edition (epic #34).
 *
 * Pulls the channel's uploads from the YouTube Data API v3 and upserts a
 * `video` document per video into Sanity. YouTube tags are treated as a
 * deterministic taxonomy source: the script builds a keyword dictionary FROM
 * SANITY on every run (topic/featuredBrand/event docs' youtubeSyncKeywords),
 * normalizes both sides (case/punctuation-insensitive), and derives each
 * video's topics + hubs from exact dictionary hits. Everything else in the
 * tag soup is ignored by design.
 *
 * THREE FIELD CLASSES per video document:
 *   • FACTUAL   — title/stats/etc. Overwritten every run, unconditionally.
 *   • DERIVED   — topics, hubs, requiresReview. Overwritten every run UNLESS
 *                 the document's `manualTaxonomyOverride` is true (the Sync
 *                 Lock): then the sync never touches taxonomy again.
 *   • EDITORIAL — contentStatus, featured, notes, franchises… Seeded on
 *                 creation, never overwritten. contentStatus special cases:
 *                 clean Tier-1 match ⇒ created as 'published' (auto-publish,
 *                 owner-approved); no match ⇒ 'needs-review' + Uncategorized +
 *                 requiresReview. A later sync may PROMOTE needs-review →
 *                 published when tags are fixed — but never demotes, and never
 *                 touches a status a human changed (published/archived).
 *
 * Fallback protocol: a video matching zero Tier-1 keywords is NEVER dropped —
 * it lands in `topic-uncategorized` with requiresReview: true for Studio
 * triage.
 *
 * Dry-run by default; pass --execute (with SANITY_WRITE_TOKEN) to write.
 * Pure planning functions are exported for offline tests; importing this
 * module performs zero I/O.
 */
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createClient } from '@sanity/client';
import { createYouTubeClient } from '../src/lib/platforms/youtube.ts';

config();

// ── Pure taxonomy core (unit-testable, no I/O) ───────────────────────────────

/** Deterministic Sanity _id for a YouTube video — the duplicate-prevention key. */
export function videoDocId(youtubeId) {
  return `youtube-${youtubeId}`;
}

export const UNCATEGORIZED_TOPIC_ID = 'topic-uncategorized';

/**
 * Tier-1 topic seeds. createIfNotExists-ed on every run, so the dictionary
 * always has the four categories + the fallback. Editors own the docs (and
 * their keywords) after first creation — these are only the day-one values.
 */
export const TIER1_TOPIC_SEEDS = Object.freeze([
  { _id: 'topic-film', title: 'Film', slug: 'film', isTier1Category: true, keywords: ['film', 'movie', 'movies'] },
  { _id: 'topic-tv', title: 'TV', slug: 'tv', isTier1Category: true, keywords: ['tv', 'television', 'tv show', 'series'] },
  { _id: 'topic-gaming', title: 'Gaming', slug: 'gaming', isTier1Category: true, keywords: ['gaming', 'game', 'games', 'video game', 'video games'] },
  { _id: 'topic-events', title: 'Events', slug: 'events', isTier1Category: true, keywords: ['event', 'events', 'convention'] },
  { _id: UNCATEGORIZED_TOPIC_ID, title: 'Uncategorized', slug: 'uncategorized', isTier1Category: false, keywords: [] },
]);

/**
 * Normalize a tag or keyword for matching: lowercase, every run of
 * non-alphanumerics becomes a single space, trimmed. Makes
 * "San Diego Comic-Con" ≡ "san diego comic con" ≡ "SAN  DIEGO comic_con".
 */
export function normalizeTag(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Build the normalized keyword → target lookup from Sanity docs.
 * `topics`: [{_id, isTier1Category, youtubeSyncKeywords}] (seeds pre-merged by
 * the caller); `hubs`: featuredBrand/event docs [{_id, youtubeSyncKeywords}].
 * First definition of a keyword wins; later collisions are reported, not
 * silently shadowed.
 */
export function buildTaxonomyDictionary({ topics = [], hubs = [] }) {
  const tier1 = new Map(); // normalized keyword -> topic _id
  const hubMap = new Map(); // normalized keyword -> hub _id
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
    if (!t?.isTier1Category) continue; // only Tier-1 keywords gate categorization
    for (const k of t.youtubeSyncKeywords ?? []) add(tier1, k, t._id, 'topic');
  }
  for (const h of hubs) {
    for (const k of h?.youtubeSyncKeywords ?? []) add(hubMap, k, h._id, 'hub');
  }
  return { tier1, hubs: hubMap, collisions };
}

/**
 * Evaluate a video's raw YouTube tags against the dictionary.
 * Only exact (normalized) hits count — SEO soup is ignored. Zero Tier-1 hits
 * triggers the fallback protocol.
 */
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
  if (requiresReview) topicIds.push(UNCATEGORIZED_TOPIC_ID);
  return { topicIds, hubIds, requiresReview };
}

/** Sanity reference array (with the _key every array item needs). */
export function toRefs(ids) {
  return ids.map((id) => ({ _type: 'reference', _ref: id, _key: id }));
}

/**
 * Map a YouTubeVideo (from the client) to the FACTUAL fields — every key here
 * is overwritten each run, nothing else is.
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
 * The mutation plan for one video.
 *
 * `existing` is the doc's current state ({contentStatus, manualTaxonomyOverride})
 * or null for brand-new videos. The patch honors the Sync Lock and the
 * promotion rule; createIfNotExists seeds editorial defaults exactly once.
 */
export function planVideoSync(video, match, existing, now = new Date()) {
  const _id = videoDocId(video.id);
  const locked = existing?.manualTaxonomyOverride === true;

  const derived = {
    topics: toRefs(match.topicIds),
    hubs: toRefs(match.hubIds),
    requiresReview: match.requiresReview,
  };

  const set = { ...mapVideoToSyncedFields(video, now) };
  if (!locked) Object.assign(set, derived);
  // Promotion: tags got fixed and no human has moved the status → publish.
  if (!locked && existing?.contentStatus === 'needs-review' && !match.requiresReview) {
    set.contentStatus = 'published';
  }

  return {
    _id,
    createIfNotExists: {
      _id,
      _type: 'video',
      youtubeId: video.id,
      platform: 'youtube',
      // Auto-publish (owner-approved): clean Tier-1 match goes straight to the
      // site; the fallback protocol routes everything else to review.
      contentStatus: match.requiresReview ? 'needs-review' : 'published',
      featured: false,
      manualTaxonomyOverride: false,
      ...derived,
    },
    patch: { set },
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

/** Seed docs for createIfNotExists — schema shape (slug object, keyword field). */
function topicSeedDoc(seed) {
  return {
    _id: seed._id,
    _type: 'topic',
    title: seed.title,
    slug: { _type: 'slug', current: seed.slug },
    isTier1Category: seed.isTier1Category,
    youtubeSyncKeywords: seed.keywords,
  };
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

  // 1. Ensure the Tier-1 topic docs exist (no-op after the first run).
  if (execute) {
    const seedTx = sanity.transaction();
    for (const seed of TIER1_TOPIC_SEEDS) seedTx.createIfNotExists(topicSeedDoc(seed));
    await seedTx.commit();
  }

  // 2. Build the taxonomy dictionary from Sanity (seeds fill any gap in
  //    dry-run mode, where the seed tx hasn't been committed yet).
  const [topicDocs, hubDocs, existingDocs] = await Promise.all([
    sanity.fetch(`*[_type == "topic"]{_id, isTier1Category, youtubeSyncKeywords}`),
    sanity.fetch(`*[_type in ["featuredBrand", "event"]]{_id, _type, title, youtubeSyncKeywords}`),
    sanity.fetch(`*[_type == "video"]{_id, contentStatus, manualTaxonomyOverride}`),
  ]);
  const knownTopicIds = new Set(topicDocs.map((t) => t._id));
  const mergedTopics = [
    ...topicDocs,
    ...TIER1_TOPIC_SEEDS.filter((s) => !knownTopicIds.has(s._id)).map((s) => ({
      _id: s._id,
      isTier1Category: s.isTier1Category,
      youtubeSyncKeywords: s.keywords,
    })),
  ];
  const dict = buildTaxonomyDictionary({ topics: mergedTopics, hubs: hubDocs });
  for (const c of dict.collisions) {
    console.warn(`⚠ keyword collision: "${c.keyword}" already maps to ${c.kept}; ignoring ${c.ignored}`);
  }
  const hubsWithKeywords = hubDocs.filter((h) => (h.youtubeSyncKeywords ?? []).length > 0).length;
  console.log(
    `Dictionary: ${dict.tier1.size} Tier-1 keyword(s), ${dict.hubs.size} hub keyword(s) from ${hubsWithKeywords} hub doc(s).`,
  );
  if (dict.hubs.size === 0) {
    console.warn('⚠ No hub keywords configured yet — add youtubeSyncKeywords to your Featured Brand / Event docs in Studio.');
  }

  const existingById = new Map(existingDocs.map((d) => [d._id, d]));

  // 3. Fetch the channel.
  console.log(`\nFetching uploads for channel ${YOUTUBE_CHANNEL_ID}…`);
  const ids = await collectUploadIds(yt, YOUTUBE_CHANNEL_ID);
  console.log(`Found ${ids.length} uploads. Fetching details…`);
  const videos = await yt.getVideoDetails(ids);

  // 4. Plan.
  const now = new Date();
  const counts = { published: 0, review: 0, locked: 0, promoted: 0 };
  const plans = videos.map((v) => {
    const match = matchVideoTags(v.tags, dict);
    const existing = existingById.get(videoDocId(v.id)) ?? null;
    const plan = planVideoSync(v, match, existing, now);
    const locked = existing?.manualTaxonomyOverride === true;
    if (locked) counts.locked++;
    else if (match.requiresReview) counts.review++;
    else counts.published++;
    if (plan.patch.set.contentStatus === 'published') counts.promoted++;

    const label = locked
      ? 'LOCKED (taxonomy untouched)'
      : match.requiresReview
        ? 'UNCATEGORIZED → requiresReview'
        : `topics[${match.topicIds.length}] hubs[${match.hubIds.length}]`;
    console.log(`• ${v.id}  ${(v.title || '').slice(0, 56).padEnd(56)} ${label}`);
    return plan;
  });

  console.log(
    `\nSummary: ${counts.published} clean match(es), ${counts.review} for review, ${counts.locked} sync-locked, ${counts.promoted} promotion(s) to published.`,
  );

  if (!execute) {
    console.log(`\nDRY RUN — ${plans.length} video(s) would be upserted. Re-run with --execute to write.`);
    return;
  }

  // 5. Write.
  let written = 0;
  for (let i = 0; i < plans.length; i += COMMIT_CHUNK) {
    const chunk = plans.slice(i, i + COMMIT_CHUNK);
    const tx = sanity.transaction();
    for (const plan of chunk) {
      tx.createIfNotExists(plan.createIfNotExists);
      tx.patch(plan._id, { set: plan.patch.set });
    }
    await tx.commit();
    written += chunk.length;
    console.log(`  …committed ${written}/${plans.length}`);
  }
  console.log(`\n✔ Synced ${written} videos (taxonomy derived from tags; sync-locked docs untouched).`);
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
