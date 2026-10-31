/**
 * The distribution run (issues #282 and #284). Reads /dispatch.json, finds
 * stories it has not handled, writes each platform's copy (copy-engine.mjs),
 * posts to the platforms that are live, records every result, and emails one
 * report. Everything it touches comes in through `deps`, so
 * scripts/social-blast.test.mjs drives it with fakes.
 *
 * ─── ONE STORY, ONE POST PER PLATFORM ────────────────────────────────────
 * State lives in a Durable Object (worker.mjs), not KV: KV is eventually
 * consistent, so a cron run and a deploy trigger landing together could both
 * read "not posted" and both post. The object runs one blast at a time, and
 * a platform is marked IN-FLIGHT in storage before its publishing request
 * goes out. A run that finds an in-flight mark (the previous one died
 * mid-post) does not retry it: the post may exist. It reports "unknown"
 * instead. Only a failure that certainly did not post is retried, at most
 * MAX_ATTEMPTS times, and each attempt is reported.
 *
 * ─── WHAT COUNTS AS NEW ──────────────────────────────────────────────────
 * The very first run records every story already in the feed WITHOUT
 * announcing it, so switching the engine on never blasts the back catalogue.
 * After that, a story is new when it has no record. A new story older than
 * MAX_AGE_HOURS (a backfill, a re-dated post) is recorded as skipped and
 * reported, never posted.
 *
 * ─── DRY RUN IS THE DEFAULT, PER PLATFORM ────────────────────────────────
 * LIVE_PLATFORMS lists the platforms allowed to post for real
 * ("bluesky,threads"). Empty, the default, means every platform is a
 * preview: the report shows exactly what would have gone out. A preview is
 * final for that story, so switching a platform live later never posts old
 * stories. X and YouTube Community are never live: they are drafts.
 */
import { ALL_PLATFORMS, DRAFT_PLATFORMS, LIVE_PLATFORMS, contentTypeOf, pickVariant, validateTemplates } from './copy-engine.mjs';
import { PLATFORM_SECRETS, PostError, blueskySession, scrub } from './platforms.mjs';
import { buildReport, isProblem } from './report.mjs';

export const MAX_ATTEMPTS = 3;
const DEFAULTS = { MAX_AGE_HOURS: 72, MAX_ITEMS_PER_RUN: 3 };

const itemKey = (guid) => `item:${guid}`;
const rotationKey = (platform, type) => `rot:${platform}:${type}`;

/** The live platforms named in LIVE_PLATFORMS. Unknown names are ignored. */
export function livePlatforms(env) {
  return new Set(String(env.LIVE_PLATFORMS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((p) => LIVE_PLATFORMS.includes(p)));
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Checks the feed's shape. A malformed feed stops the run; it never posts half a story. */
export function validateFeed(feed) {
  if (!feed || !Array.isArray(feed.items)) throw new Error('dispatch.json: no items array');
  for (const item of feed.items) {
    if (!item?.guid || !item.title || !/^https?:\/\//.test(item.link ?? '') || !Number.isFinite(Date.parse(item.pubDate))) {
      throw new Error(`dispatch.json: incomplete item ${JSON.stringify(item?.guid ?? item?.title ?? null)}`);
    }
  }
  return feed.items;
}

const retryable = (result) => result?.status === 'failed' && (result.attempts ?? 0) < MAX_ATTEMPTS;
const settled = (result) => result && !retryable(result) && result.status !== 'in-flight';

/** Does this record still have platforms to do? (A retry, or an in-flight mark to resolve.) */
function hasPending(record) {
  return !record.skipped && !record.seeded &&
    ALL_PLATFORMS.some((p) => !settled(record.platforms?.[p]));
}

/** A store that reads through to `store` and keeps every write in memory: inspection mode. */
function overlay(store) {
  const writes = new Map();
  return {
    get: async (key) => (writes.has(key) ? writes.get(key) : store.get(key)),
    put: async (key, value) => { writes.set(key, value); },
    delete: async (key) => { writes.set(key, undefined); },
  };
}

/**
 * deps: {
 *   store       { get, put, delete } (Durable Object storage)
 *   env         vars and secrets
 *   templates   parsed templates.json
 *   fetchFeed   () => parsed /dispatch.json
 *   publishers  { bluesky, threads, facebook } (platforms.mjs)
 *   fetchImpl   fetch for platform APIs
 *   getImage    (url) => { bytes, type } | null
 *   threadsToken () => current Threads token
 *   blueskySession  (env, fetch) => session; one per run (platforms.mjs)
 *   now         () => ms
 *   inspect     true: save nothing, post nothing, return the report
 * }
 */
export async function runBlast(deps) {
  const { env, templates, fetchFeed, publishers, fetchImpl, getImage, threadsToken, inspect = false } = deps;
  const now = deps.now ?? Date.now;
  const store = inspect ? overlay(deps.store) : deps.store;
  const doc = validateTemplates(templates);
  const items = validateFeed(await fetchFeed());

  if (!await store.get('seeded')) {
    for (const item of items) {
      if (!await store.get(itemKey(item.guid))) {
        await store.put(itemKey(item.guid), { guid: item.guid, title: item.title, seeded: true, at: now() });
      }
    }
    await store.put('seeded', { at: now(), count: items.length });
    return { action: 'seeded', count: items.length, entries: [] };
  }

  const live = inspect ? new Set() : livePlatforms(env);
  const maxAgeMs = positive(env.MAX_AGE_HOURS, DEFAULTS.MAX_AGE_HOURS) * 3600 * 1000;
  const maxItems = positive(env.MAX_ITEMS_PER_RUN, DEFAULTS.MAX_ITEMS_PER_RUN);

  // Oldest first, so the posts land in the order the stories were published.
  const queue = [];
  for (const item of [...items].sort((a, b) => Date.parse(a.pubDate) - Date.parse(b.pubDate))) {
    const record = await store.get(itemKey(item.guid));
    if (!record || hasPending(record)) queue.push({ item, record });
    if (queue.length >= maxItems) break;
  }

  let bluesky = null;
  const entries = [];
  for (const { item, record: existing } of queue) {
    const record = existing ?? { guid: item.guid, title: item.title, link: item.link, firstSeenAt: now(), platforms: {} };
    record.platforms ??= {};
    const type = contentTypeOf(item, doc);
    record.type = type;

    if (!existing && now() - Date.parse(item.pubDate) > maxAgeMs) {
      record.skipped = `published more than ${maxAgeMs / 3600000} hours before it reached the feed`;
      await store.put(itemKey(item.guid), record);
      entries.push({ item, type, skipped: record.skipped, results: {} });
      continue;
    }

    const usedNow = new Set(Object.values(record.platforms).map((r) => r?.templateId).filter(Boolean));
    const results = {};
    for (const platform of ALL_PLATFORMS) {
      const previous = record.platforms[platform];
      if (previous?.status === 'in-flight') {
        record.platforms[platform] = results[platform] = {
          ...previous, status: 'unknown',
          error: 'the run posting this stopped before the platform answered; check whether it went up',
        };
        continue;
      }
      if (settled(previous)) continue;

      const mode = DRAFT_PLATFORMS.includes(platform) ? 'draft' : live.has(platform) ? 'live' : 'preview';
      // A retry posts the text it already chose, so rotation does not move on.
      let pick = previous?.text ? { text: previous.text, template: { id: previous.templateId } } : null;
      if (!pick) {
        pick = pickVariant(doc, item, platform, {
          lastUsed: await store.get(rotationKey(platform, type)),
          usedNow,
          live: mode === 'live',
        });
        if (pick.blocked) {
          record.platforms[platform] = results[platform] = { status: 'blocked', reason: pick.blocked };
          continue;
        }
        await store.put(rotationKey(platform, type), pick.template.id);
      }
      usedNow.add(pick.template.id);
      const base = { templateId: pick.template.id, text: pick.text, at: now() };

      if (mode === 'draft') { record.platforms[platform] = results[platform] = { ...base, status: 'drafted' }; continue; }
      if (mode === 'preview') { record.platforms[platform] = results[platform] = { ...base, status: 'previewed' }; continue; }

      const missing = PLATFORM_SECRETS[platform].filter((key) => !env[key]);
      if (missing.length) {
        record.platforms[platform] = results[platform] = { ...base, status: 'not-configured', reason: `missing ${missing.join(', ')}` };
        continue;
      }

      const attempts = (previous?.attempts ?? 0) + 1;
      record.platforms[platform] = { ...base, status: 'in-flight', attempts };
      await store.put(itemKey(item.guid), record);
      try {
        const extra = {};
        if (platform === 'bluesky') extra.session = await (bluesky ??= (deps.blueskySession ?? blueskySession)(env, fetchImpl));
        if (platform === 'threads') extra.token = await threadsToken?.();
        const posted = await publishers[platform]({ item, text: pick.text, env, fetchImpl, getImage, ...extra });
        record.platforms[platform] = results[platform] = { ...base, status: 'posted', attempts, id: posted.id, url: posted.url };
      } catch (error) {
        const message = scrub(error?.message ?? error, env);
        const maybePosted = error instanceof PostError && error.maybePosted;
        record.platforms[platform] = results[platform] = {
          ...base, attempts, error: message,
          status: maybePosted ? 'unknown' : attempts >= MAX_ATTEMPTS ? 'failed-final' : 'failed',
        };
      }
      await store.put(itemKey(item.guid), record);
    }
    await store.put(itemKey(item.guid), record);
    entries.push({ item, type, results });
  }

  return { action: entries.length ? 'processed' : 'nothing-new', entries, problems: entries.reduce((n, e) => n + Object.values(e.results).filter(isProblem).length, 0) };
}

/**
 * Wraps runBlast with the report: builds it, sends it, and keeps an unsent
 * one in an outbox that the next run delivers first, so a Resend outage
 * never loses a draft. Returns the run summary.
 */
export async function runAndReport(deps) {
  const { store, env, send, inspect = false } = deps;
  if (!inspect) await flushOutbox(store, send);
  const result = await runBlast(deps);
  if (!result.entries.length) return result;
  const report = buildReport(result.entries, env, { inspect });
  if (inspect) return { ...result, report };
  const key = await digest(JSON.stringify(result.entries.map((e) => [e.item.guid, e.results])));
  try {
    await send({ ...report, key });
  } catch (error) {
    const outbox = (await store.get('outbox')) ?? [];
    outbox.push({ ...report, key });
    await store.put('outbox', outbox.slice(-10));
    result.reportError = String(error?.message ?? error);
  }
  return result;
}

async function flushOutbox(store, send) {
  const outbox = (await store.get('outbox')) ?? [];
  if (!outbox.length) return;
  const left = [];
  for (const report of outbox) {
    try { await send(report); } catch { left.push(report); }
  }
  await store.put('outbox', left);
}

export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
