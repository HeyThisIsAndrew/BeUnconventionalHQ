/**
 * Dispatch to Kit Draft (issue #272): once a week, turn the stories published
 * since the last draft into a ready-to-review THE HQ DISPATCH broadcast draft
 * in Kit. A human reviews it and presses Send in Kit. Nothing here sends.
 *
 * Plain module: every outside call comes in through `deps`, so
 * scripts/dispatch-kit.test.mjs runs it with fakes. Runbook:
 * scripts/hq-dispatch.md.
 *
 * ─── THE RULES ───────────────────────────────────────────────────────────
 *   - Source is /dispatch.json only. The email HTML is the boxes the site
 *     pre-rendered from post-template.liquid.html (src/lib/dispatch-boxes.ts);
 *     this file only joins them. It never builds email markup.
 *   - Stories published after the newest story of the last draft. Zero new
 *     stories means no draft (an empty newsletter is worse than none).
 *   - At most MAX_STORIES (6): the newest is FEATURED, up to 5 more LATEST.
 *     That is the tested layout and keeps the email under Gmail's clipping.
 *   - KIT IS THE SOURCE OF TRUTH FOR DUPLICATES. The draft's internal
 *     description carries a marker naming its newest story, and Kit's own
 *     broadcast list is checked for that marker before creating. Local state
 *     is a cache: losing it can never produce a second draft.
 *   - Dry run unless CREATE_DRAFTS is "true": the owner gets the would-be
 *     draft by email and Kit is not touched.
 */
const DEFAULTS = { MAX_STORIES: 6, FIRST_WINDOW_DAYS: 7, PREVIEW_CHARS: 90 };
const KIT_API = 'https://api.kit.com/v4';

/**
 * The whole of this Worker's "rendering": the site's pre-rendered pieces, in
 * order (src/lib/dispatch-boxes.ts). scripts/dispatch-feed.test.mjs proves
 * this join equals post-template.liquid.html rendering the same stories.
 */
export function joinBoxes(featuredHtml, latestHeadingHtml, latestHtml) {
  return featuredHtml + (latestHtml.length ? latestHeadingHtml + latestHtml.join('') : '');
}

export const draftMarker = (guid) => `[hq-dispatch newest=${guid}]`;

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Trims at a word to about `max` characters, with an ellipsis. */
export function previewText(summary, max = DEFAULTS.PREVIEW_CHARS) {
  const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.]+$/, '');
  return `${cut}…`;
}

/** A feed without its pre-rendered boxes cannot make a draft: stop, never improvise markup. */
export function validateKitFeed(feed) {
  if (!feed || !Array.isArray(feed.items) || typeof feed.latestHeadingHtml !== 'string' || !feed.latestHeadingHtml) {
    throw new Error('dispatch.json: missing items or latestHeadingHtml');
  }
  for (const item of feed.items) {
    if (!item?.guid || !item.title || !Number.isFinite(Date.parse(item.pubDate)) || !item.featuredHtml || !item.latestHtml) {
      throw new Error(`dispatch.json: item ${JSON.stringify(item?.guid ?? item?.title ?? null)} is missing its story boxes`);
    }
  }
  return feed;
}

/** The draft the feed calls for right now, or null when there is nothing new. */
export function planDraft(feed, state, env, now) {
  const maxStories = positive(env.MAX_STORIES, DEFAULTS.MAX_STORIES);
  const since = state?.lastPubDate
    ? Date.parse(state.lastPubDate)
    : now - positive(env.FIRST_WINDOW_DAYS, DEFAULTS.FIRST_WINDOW_DAYS) * 86400000;
  const fresh = feed.items
    .filter((item) => Date.parse(item.pubDate) > since)
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  if (!fresh.length) return null;
  const stories = fresh.slice(0, maxStories);
  const [featured, ...latest] = stories;
  const name = env.NEWSLETTER_NAME || 'Newsletter';
  return {
    stories,
    left: fresh.length - stories.length,
    newest: featured,
    subject: `${name}: ${featured.title}`,
    previewText: previewText(featured.summary),
    description: [...stories.map((s, i) => `${i ? '-' : 'FEATURED:'} ${s.title}`), draftMarker(featured.guid)].join('\n'),
    content: joinBoxes(featured.featuredHtml, feed.latestHeadingHtml, latest.map((s) => s.latestHtml)),
  };
}

// ─── Kit API ────────────────────────────────────────────────────────────

export class KitError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'KitError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * One Kit call, retried on 429 and 5xx with backoff (Retry-After honoured,
 * capped). The API key goes in its header only and never into a message.
 */
export async function kitRequest(env, method, path, body, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(`${KIT_API}${path}`, {
        method,
        signal: AbortSignal.timeout(30000),
        headers: { 'X-Kit-Api-Key': env.KIT_API_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt >= attempts || method !== 'GET') throw new KitError(`Kit ${method} ${path}: ${error?.message ?? error}`, { retryable: true });
      await sleep(2000 * attempt);
      continue;
    }
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    const retryable = response.status === 429 || response.status >= 500;
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).errors?.join('; ') || detail; } catch { /* not JSON */ }
    if (env.KIT_API_KEY) detail = detail.split(env.KIT_API_KEY).join('[redacted]');
    if (!retryable || attempt >= attempts) throw new KitError(`Kit ${method} ${path}: HTTP ${response.status} ${detail}`, { status: response.status, retryable });
    const after = Number(response.headers.get('Retry-After'));
    await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** (attempt - 1), 30000));
  }
}

/** The existing broadcast whose description carries `marker`, if any. Walks at most a few pages. */
export async function findDraftByMarker(env, marker, opts) {
  let after = null;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ per_page: '500', ...(after ? { after } : {}) });
    const result = await kitRequest(env, 'GET', `/broadcasts?${query}`, null, opts);
    const found = (result.broadcasts ?? []).find((b) => String(b.description ?? '').includes(marker));
    if (found) return found;
    if (!result.pagination?.has_next_page || !result.pagination.end_cursor) return null;
    after = result.pagination.end_cursor;
  }
  return null;
}

export function draftUrl(env, id) {
  const pattern = env.KIT_DRAFT_URL || 'https://app.kit.com/campaigns/{id}/draft';
  return pattern.replace('{id}', encodeURIComponent(String(id)));
}

// ─── the run ────────────────────────────────────────────────────────────

/**
 * deps: { store, env, fetchFeed, fetchImpl, sleep, now, dryRun }
 * Returns { action, ... } with action one of: nothing-new, exists, preview, created.
 */
export async function runKitDraft(deps) {
  const { store, env, fetchFeed } = deps;
  const now = deps.now ?? Date.now;
  const opts = { fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const live = env.CREATE_DRAFTS === 'true' && deps.dryRun !== true;
  const feed = validateKitFeed(await fetchFeed());
  const state = await store.get('state');
  const plan = planDraft(feed, state, env, now());
  if (!plan) return { action: 'nothing-new', since: state?.lastPubDate ?? null };

  if (!live) return { action: 'preview', plan };
  if (!env.KIT_API_KEY) throw new Error('CREATE_DRAFTS is on but KIT_API_KEY is not set');
  const templateId = Number(env.KIT_EMAIL_TEMPLATE_ID);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error('CREATE_DRAFTS is on but KIT_EMAIL_TEMPLATE_ID is not set (find it with: node scripts/kit-spike.mjs templates)');
  }

  const marker = draftMarker(plan.newest.guid);
  const remember = (id) => store.put('state', { lastPubDate: plan.newest.pubDate, lastGuid: plan.newest.guid, broadcastId: id, at: new Date(now()).toISOString() });
  const existing = await findDraftByMarker(env, marker, opts);
  if (existing) {
    await remember(existing.id);
    return { action: 'exists', plan, broadcastId: existing.id, url: draftUrl(env, existing.id) };
  }

  const body = {
    subject: plan.subject,
    preview_text: plan.previewText,
    description: plan.description,
    content: plan.content,
    email_template_id: templateId,
    public: false,
    send_at: null,
  };
  let created;
  try {
    created = await kitRequest(env, 'POST', '/broadcasts', body, { ...opts, attempts: 1 });
  } catch (error) {
    // A create that failed without a clear "no" may have landed. Ask Kit
    // before trying again, so a retry can never make a second draft.
    if (!(error instanceof KitError) || !error.retryable) throw error;
    const landed = await findDraftByMarker(env, marker, opts);
    if (landed) created = { broadcast: landed };
    else created = await kitRequest(env, 'POST', '/broadcasts', body, { ...opts, attempts: 2 });
  }
  const id = created.broadcast?.id ?? created.id;
  if (!id) throw new Error('Kit created the draft but returned no id');
  await remember(id);
  return { action: 'created', plan, broadcastId: id, url: draftUrl(env, id) };
}

// ─── what the owner is told ──────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The notification for a run's result, or null when it needs none (an idempotent re-run). */
export function buildNotice(result, env) {
  const name = env.NEWSLETTER_NAME || 'Newsletter';
  if (result.action === 'exists') return null;
  if (result.action === 'nothing-new') {
    return { subject: `${name}: no new stories this week, no draft`, text: 'No story was published since the last draft, so no draft was created.' };
  }
  const { plan } = result;
  const list = plan.stories.map((s, i) => `${i ? '  -' : '  FEATURED:'} ${s.title}`).join('\n');
  const left = plan.left ? `\n${plan.left} older ${plan.left === 1 ? 'story' : 'stories'} did not fit in the ${plan.stories.length}.` : '';
  const meta = `Subject: ${plan.subject}\nPreview text: ${plan.previewText}\n\nStories:\n${list}${left}`;
  if (result.action === 'preview') {
    const note = 'Dry run: nothing was created in Kit. Drafts are switched on with CREATE_DRAFTS (scripts/hq-dispatch.md).';
    return {
      subject: `${name} draft preview (dry run): ${plan.newest.title}`,
      text: `${note}\n\n${meta}`,
      // The boxes as they will sit in the email, on the email's own background.
      html: `<p style="font-family:system-ui,sans-serif">${esc(note)}</p><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${esc(meta)}</pre><div style="background:#0a0a0a;padding:24px"><div style="max-width:550px;margin:0 auto">${plan.content}</div></div>`,
    };
  }
  return {
    subject: `${name} draft ready: ${plan.newest.title}`,
    text: `A draft is waiting in Kit. Review it and press Send there.\n${result.url}\n\n${meta}`,
    html: `<p style="font-family:system-ui,sans-serif">A draft is waiting in Kit. Review it and press Send there.</p><p><a href="${esc(result.url)}">Open the draft in Kit</a></p><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${esc(meta)}</pre>`,
  };
}
