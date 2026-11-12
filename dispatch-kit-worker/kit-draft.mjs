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
const DEFAULTS = { MAX_STORIES: 6, MAX_ALSO: 4, FIRST_WINDOW_DAYS: 7, PREVIEW_MAX: 140, NOTE_MAX: 600 };
const KIT_API = 'https://api.kit.com/v4';
/** Must match src/lib/dispatch-boxes.ts. */
export const ISSUE_MARKER_TOKEN = '%%HQ_ISSUE_MARKER%%';
export const EDITOR_NOTE_TOKEN = '%%HQ_EDITOR_NOTE%%';
const MARKER_PREFIX = '[hq-dispatch newest=';

/**
 * The whole of this Worker's "rendering": the site's pre-rendered pieces, in
 * order (src/lib/dispatch-boxes.ts). scripts/dispatch-feed.test.mjs proves
 * this join equals post-template.liquid.html rendering the same stories.
 */
export function joinBoxes(featuredHtml, latestHeadingHtml, latestHtml) {
  return featuredHtml + (latestHtml.length ? latestHeadingHtml + latestHtml.join('') : '');
}

export const draftMarker = (guid) => `${MARKER_PREFIX}${guid}]`;

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The inbox preview line: the featured story's own subtitle, whole, when it
 * fits; else its first whole sentence that fits; else nothing (and the
 * owner is told). Never cut mid-sentence.
 */
export function previewText(subtitle, max = DEFAULTS.PREVIEW_MAX) {
  const text = String(subtitle ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const first = text.split(/(?<=[.!?])\s+/)[0];
  return first.length <= max ? first : '';
}

/**
 * The week line: "Week of November 2, 2026", the Monday of the run's week in
 * the newsletter's time zone. Built from calendar parts, never by parsing a
 * date string (hard rule 1).
 */
export function weekOf(now, timeZone = 'America/Los_Angeles') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const back = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 7) % 7;
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back));
  return `Week of ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(monday)}`;
}

export function issueMarker(now, issueNumber, env = {}) {
  const week = weekOf(now, env.NEWSLETTER_TIMEZONE || 'America/Los_Angeles');
  return issueNumber ? `Issue ${issueNumber} | ${week}` : week;
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

// ─── dedupe, phase 1 (newsletter only) ─────────────────────────────────────

/**
 * Words that name a FORMAT, not a subject: "Godzilla Minus Zero | Review" and
 * "Godzilla Minus Zero LA Premiere Reaction | ..." are both about Godzilla
 * Minus Zero once these are set aside. Years are kept on purpose: The Game
 * Awards 2026 and 2027 are different stories.
 */
const FORMAT_WORDS = /\b(?:reviews?|reactions?|premiere|la|los angeles|trailers?|teasers?|first look|breakdown|explained|recap|finale|season \d+|episode \d+|ep\.? ?\d+|s\d+e\d+|spoiler[- ]free|spoilers?|ending|analysis|interview|red carpet|live|official|full)\b/g;

/**
 * The subject of a headline: its part before the first " | " or ": ", minus
 * format words. Two stories with the same non-empty subject in one issue are
 * the same title.
 */
export function titleSubject(title) {
  const head = String(title ?? '').toLowerCase().replace(/[‘’]/g, "'").split(/\s+\|\s*|:\s+/)[0];
  return head.replace(FORMAT_WORDS, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The story itself: a YouTube video id, else the link without query or trailing slash. */
export function sourceKey(item) {
  const link = String(item.link ?? item.guid ?? '');
  const yt = link.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return yt ? `yt:${yt[1]}` : link.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
}

/**
 * Phase 1: the newest story of each title or source keeps its card; any
 * later one in the same issue moves to ALSO THIS WEEK (at most MAX_ALSO,
 * then it is counted as left out). Newest wins because the feed is newest
 * first and the newest is what the reader has not seen. Nothing is removed
 * from the site: this runs on the newsletter's copy of the list only.
 */
export function dedupeStories(fresh, maxStories, maxAlso) {
  const main = [];
  const also = [];
  const owner = new Map();
  let left = 0;
  for (const item of fresh) {
    const keys = [`source:${sourceKey(item)}`];
    const subject = titleSubject(item.title);
    if (subject) keys.push(`title:${subject}`);
    const clash = keys.find((k) => owner.has(k));
    if (clash) {
      if (also.length < maxAlso) also.push({ item, sameAs: owner.get(clash), reason: clash.startsWith('title:') ? 'same title' : 'same story' });
      else left++;
      continue;
    }
    if (main.length >= maxStories) { left++; continue; }
    main.push(item);
    for (const k of keys) owner.set(k, item);
  }
  return { main, also, left };
}

// ─── topics layout (one FEATURED + four topic slots) ──────────────────────

/** Must match src/lib/dispatch-topics.ts (TOPICS, TOPIC_SLOTS, fillSlots). */
export const TOPICS = ['film', 'tv', 'games', 'events'];
export const TOPIC_SLOTS = 4;
const SLOT_DEPTH = 4;

/**
 * THE slot rule (owner's question, 2026-11-01: "what if I pick three?").
 *   1. Fair share first: each chosen topic gets floor(slots / topics) picks,
 *      taken in turns. One topic: 4. Two: 2 and 2. Four: 1 each.
 *   2. Whatever is left (the fourth slot with three topics, or the share of
 *      a topic with too few stories this week) goes to the NEWEST unused
 *      story among the chosen topics. So Film, TV and Games gives one of
 *      each plus whichever of them published most recently, and that
 *      changes week to week. It used to go to Film every time, because the
 *      turns ran in a fixed order.
 * `byTopic` holds each topic's candidates, newest first. An item without a
 * pubDate (the upcoming-event card) never wins a leftover slot.
 */
export function fillSlots(byTopic, topics, slots = TOPIC_SLOTS) {
  const chosen = TOPICS.filter((t) => topics.includes(t) && (byTopic[t]?.length ?? 0) > 0);
  if (chosen.length === 0) return [];
  const used = Object.fromEntries(chosen.map((t) => [t, 0]));
  const picked = [];
  const next = (topic) => byTopic[topic][used[topic]];
  const share = Math.floor(slots / chosen.length);
  for (let round = 0; round < share; round++) {
    for (const topic of chosen) {
      if (next(topic) === undefined || picked.length >= slots) continue;
      picked.push(next(topic));
      used[topic]++;
    }
  }
  while (picked.length < slots) {
    let best = null;
    for (const topic of chosen) {
      if (next(topic) === undefined) continue;
      const time = Date.parse(next(topic).pubDate ?? '');
      const bestTime = best === null ? NaN : Date.parse(next(best).pubDate ?? '');
      // Newer wins; a dated story beats an undated card; ties keep topic order.
      if (best === null || (Number.isFinite(time) && (Number.isNaN(bestTime) || time > bestTime))) best = topic;
    }
    if (best === null) break;
    picked.push(next(best));
    used[best]++;
  }
  return picked;
}

/** Each topic's candidates, newest first; Events falls back to the next upcoming event. */
export function topicCandidates(stories, upcomingEvent) {
  const byTopic = {};
  for (const topic of TOPICS) byTopic[topic] = stories.filter((s) => s.topic === topic).slice(0, SLOT_DEPTH);
  if (!byTopic.events.length && upcomingEvent?.latestHtml) byTopic.events = [{ ...upcomingEvent, isUpcomingEvent: true }];
  return byTopic;
}

/**
 * The slot rule for every reader, as Kit Liquid. The Worker runs
 * fillSlots() itself for each of the 15 topic combinations and writes the
 * answers out; Kit only has to recognise which combination a reader chose
 * (the subscriber field KIT_TOPICS_FIELD, "film,tv"; empty means all four)
 * and print that one. So Kit never re-implements the rule, and what a
 * reader receives is exactly what fillSlots() picked. Each box is written
 * once into a capture and referenced by the combinations that use it; each
 * sits in {% raw %} so a headline can never be read as Liquid. A
 * combination with nothing this week gets FEATURED alone, no empty heading.
 */
export function personalizedSlots(byTopic, latestHeadingHtml, field = 'hq_topics') {
  if (!/^[a-z][a-z0-9_]*$/.test(field)) throw new Error(`KIT_TOPICS_FIELD "${field}" is not a Kit field key`);
  const out = [
    `{% assign hq_t = subscriber.${field} | default: "" | downcase %}`,
    '{% assign hq_c = "" %}',
    ...TOPICS.map((t) => `{% if hq_t contains "${t}" %}{% assign hq_c = hq_c | append: "${t}," %}{% endif %}`),
    `{% if hq_c == "" %}{% assign hq_c = "${TOPICS.map((t) => `${t},`).join('')}" %}{% endif %}`,
  ];
  const ids = new Map();
  const ref = (item) => {
    if (!ids.has(item)) {
      const id = `hq_b${ids.size}`;
      ids.set(item, id);
      out.push(`{% capture ${id} %}{% raw %}${item.latestHtml}{% endraw %}{% endcapture %}`);
    }
    return `{{ ${ids.get(item)} }}`;
  };
  const cases = [];
  for (let mask = 1; mask < 1 << TOPICS.length; mask++) {
    const chosen = TOPICS.filter((_, i) => mask & (1 << i));
    const picks = fillSlots(byTopic, chosen);
    if (!picks.length) continue;
    cases.push(`{% when "${chosen.map((t) => `${t},`).join('')}" %}{% raw %}${latestHeadingHtml}{% endraw %}${picks.map(ref).join('')}`);
  }
  out.push(`{% case hq_c %}${cases.join('')}{% endcase %}`);
  return out.join('\n');
}

// ─── the plan ──────────────────────────────────────────────────────────────

/**
 * What the owner still has to write before sending, story by story. Missing
 * copy is LEFT OUT of the email (never invented, never filled from the
 * article body) and listed here, in the notice and in Kit's description.
 */
function missingCopy(featured, latest) {
  const out = [];
  if (featured.newsletter?.missing?.includes('subtitle')) out.push({ title: featured.title, field: 'subtitle (FEATURED)' });
  for (const item of latest) {
    if (item.newsletter?.missing?.includes('blurb')) out.push({ title: item.title, field: 'one-line summary' });
  }
  return out;
}

/** Does a story match the owner's FEATURED pick (its link, its slug, or its YouTube id)? */
export function matchesPick(item, pick) {
  const p = String(pick ?? '').trim().replace(/\/$/, '');
  if (!p) return false;
  const link = String(item.link ?? item.guid ?? '').replace(/\/$/, '');
  if (link === p || String(item.guid ?? '') === p) return true;
  if (/^[\w-]+$/.test(p) && link.endsWith(`/${p}`)) return true;
  const id = sourceKey(item);
  return id.startsWith('yt:') && (id === `yt:${p}` || id === sourceKey({ link: p }));
}

/**
 * The draft the feed calls for right now, or null when there is nothing new.
 *   issueNumber  from Kit's own list of past issues, or null (week alone)
 *   editorNote   the owner's note for this issue, or '' (no block at all)
 */
export function planDraft(feed, state, env, now, { issueNumber = null, editorNote = '', featuredPick = '' } = {}) {
  const maxStories = positive(env.MAX_STORIES, DEFAULTS.MAX_STORIES);
  const maxAlso = Number.isFinite(Number(env.MAX_ALSO)) && env.MAX_ALSO !== '' ? Math.max(0, Number(env.MAX_ALSO)) : DEFAULTS.MAX_ALSO;
  const since = state?.lastPubDate
    ? Date.parse(state.lastPubDate)
    : now - positive(env.FIRST_WINDOW_DAYS, DEFAULTS.FIRST_WINDOW_DAYS) * 86400000;
  const fresh = feed.items
    .filter((item) => Date.parse(item.pubDate) > since)
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  if (!fresh.length) return null;
  // The newest story names the issue (its marker in Kit, and where the next
  // issue starts) whatever is FEATURED.
  const newest = fresh[0];
  // FEATURED is the newest story unless the owner picked one for this issue
  // (owner's decision, 2026-10-31). The pick goes first so it also wins its
  // subject in the dedupe. A pick not in this week's stories is reported and
  // the newest leads instead.
  const picked = featuredPick ? fresh.find((item) => matchesPick(item, featuredPick)) : null;
  const pickNotFound = featuredPick && !picked ? featuredPick : null;
  if (picked) fresh.splice(fresh.indexOf(picked), 1), fresh.unshift(picked);
  const topicsLayout = env.LAYOUT === 'topics';
  const personalized = topicsLayout && env.PERSONALIZE === 'true';
  let stories, also, left, featured, latest, byTopic = null;
  if (topicsLayout) {
    // One card per subject still applies; duplicates are simply not candidates.
    const unique = dedupeStories(fresh, Infinity, Infinity);
    [featured] = unique.main;
    byTopic = topicCandidates(unique.main.slice(1), feed.upcomingEvent);
    latest = personalized ? TOPICS.flatMap((t) => byTopic[t]) : fillSlots(byTopic, TOPICS);
    stories = [featured, ...latest];
    also = unique.also;
    left = 0;
  } else {
    ({ main: stories, also, left } = dedupeStories(fresh, maxStories, maxAlso));
    [featured, ...latest] = stories;
  }
  const name = env.NEWSLETTER_NAME || 'Newsletter';
  const missing = missingCopy(featured, latest);
  const subtitle = featured.newsletter?.subtitle ?? '';
  const preview = previewText(subtitle);
  if (!preview) missing.push({ title: featured.title, field: 'inbox preview text (no subtitle short enough)' });
  const marker = issueMarker(now, issueNumber, env);
  const note = String(editorNote ?? '').trim();

  const pieces = [];
  if (feed.issueMarkerHtml) pieces.push(feed.issueMarkerHtml.replace(ISSUE_MARKER_TOKEN, escapeHtml(marker)));
  if (note && feed.editorNoteHtml) {
    pieces.push(feed.editorNoteHtml.replace(EDITOR_NOTE_TOKEN, escapeHtml(note).replace(/\r?\n/g, '<br>')));
  }
  if (personalized) {
    pieces.push(featured.featuredHtml, personalizedSlots(byTopic, feed.latestHeadingHtml, env.KIT_TOPICS_FIELD || 'hq_topics'));
  } else {
    pieces.push(joinBoxes(featured.featuredHtml, feed.latestHeadingHtml, latest.map((s) => s.latestHtml)));
  }
  // ALSO THIS WEEK belongs to the classic layout; by topic, a duplicate is just not a candidate.
  const alsoRows = topicsLayout ? [] : also.map((a) => a.item.alsoHtml).filter(Boolean);
  if (alsoRows.length && feed.alsoHeadingHtml) pieces.push(feed.alsoHeadingHtml + alsoRows.join(''));

  const description = [
    marker,
    ...(topicsLayout
      ? [`FEATURED: ${featured.title}`, ...TOPICS.map((t) => `${t.toUpperCase()}: ${byTopic[t].map((x) => x.isUpcomingEvent ? `${x.title} (upcoming event)` : x.title).join(' / ') || 'nothing this week'}`),
        personalized ? `Slots: per reader, from the "${env.KIT_TOPICS_FIELD || 'hq_topics'}" field` : 'Slots: one per topic, everyone gets the same']
      : stories.map((s, i) => `${i ? '-' : 'FEATURED:'} ${s.title}`)),
    ...(also.length ? [topicsLayout ? 'Left out as duplicates:' : 'Also this week:', ...also.map((a) => `- ${a.item.title} (${a.reason} as "${a.sameAs.title}")`)] : []),
    ...(missing.length ? ['WRITE BEFORE SENDING:', ...missing.map((m) => `- ${m.title}: ${m.field}`)] : []),
    draftMarker(newest.guid),
  ].join('\n');

  return {
    layout: topicsLayout ? (personalized ? 'topics-personalized' : 'topics') : 'classic',
    byTopic,
    stories,
    also,
    left,
    missing,
    issueMarker: marker,
    editorNote: note,
    newest,
    featuredPicked: Boolean(picked),
    pickNotFound,
    subject: `${name}: ${featured.title}`,
    previewText: preview,
    description,
    content: pieces.join(''),
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

/** Every broadcast in the account, newest pages first. Walks at most a few pages. */
export async function listBroadcasts(env, opts) {
  const all = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ per_page: '500', ...(after ? { after } : {}) });
    const result = await kitRequest(env, 'GET', `/broadcasts?${query}`, null, opts);
    all.push(...(result.broadcasts ?? []));
    if (!result.pagination?.has_next_page || !result.pagination.end_cursor) break;
    after = result.pagination.end_cursor;
  }
  return all;
}

/** The existing broadcast whose description carries `marker`, if any. */
export async function findDraftByMarker(env, marker, opts) {
  return (await listBroadcasts(env, opts)).find((b) => String(b.description ?? '').includes(marker)) ?? null;
}

/**
 * The next issue number, counted from Kit itself: every broadcast this
 * Worker made carries the marker, so a deleted draft frees its number and
 * nothing local can drift. ISSUE_NUMBER_OFFSET covers issues sent before the
 * Worker existed (0 by default).
 */
export function nextIssueNumber(broadcasts, env) {
  const offset = Math.max(0, Number(env.ISSUE_NUMBER_OFFSET) || 0);
  return offset + broadcasts.filter((b) => String(b.description ?? '').includes(MARKER_PREFIX)).length + 1;
}

/** The owner's note for the next issue, saved ahead with scripts/trigger-kit-draft.mjs --note. */
export function validateNote(text) {
  const note = String(text ?? '').trim();
  if (note.length > DEFAULTS.NOTE_MAX) throw new Error(`The editor note is ${note.length} characters; keep it to ${DEFAULTS.NOTE_MAX} (two or three lines).`);
  if (/\u2014/.test(note)) throw new Error('The editor note contains an em dash; house style is a period or a comma.');
  return note;
}

export function draftUrl(env, id) {
  const pattern = env.KIT_DRAFT_URL || 'https://app.kit.com/campaigns/{id}/draft';
  return pattern.replace('{id}', encodeURIComponent(String(id)));
}

// ─── the run ────────────────────────────────────────────────────────────

/**
 * deps: { store, env, fetchFeed, fetchImpl, sleep, now, dryRun }
 * store keys: 'state' (the last draft, a cache) and 'editorNote' ({ text }).
 * Returns { action, ... } with action one of: nothing-new, exists, preview, created.
 */
export async function runKitDraft(deps) {
  const { store, env, fetchFeed } = deps;
  const now = deps.now ?? Date.now;
  const opts = { fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const live = env.CREATE_DRAFTS === 'true' && deps.dryRun !== true;
  const feed = validateKitFeed(await fetchFeed());
  const state = await store.get('state');
  const editorNote = (await store.get('editorNote'))?.text ?? '';
  const featuredPick = (await store.get('featuredPick'))?.pick ?? '';

  if (live) {
    if (!env.KIT_API_KEY) throw new Error('CREATE_DRAFTS is on but KIT_API_KEY is not set');
    const templateId = Number(env.KIT_EMAIL_TEMPLATE_ID);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      throw new Error('CREATE_DRAFTS is on but KIT_EMAIL_TEMPLATE_ID is not set (find it with: node scripts/kit-spike.mjs templates)');
    }
  }
  // Nothing new: stop before asking Kit anything.
  if (!planDraft(feed, state, env, now())) return { action: 'nothing-new', since: state?.lastPubDate ?? null };
  // Kit is READ (never written) in a dry run too when a key is set, so the
  // preview shows the real issue number. Without a key it shows the week alone.
  const broadcasts = env.KIT_API_KEY ? await listBroadcasts(env, opts) : null;
  const plan = planDraft(feed, state, env, now(), {
    issueNumber: broadcasts ? nextIssueNumber(broadcasts, env) : null,
    editorNote,
    featuredPick,
  });
  if (!live) return { action: 'preview', plan };

  const marker = draftMarker(plan.newest.guid);
  const remember = (id) => store.put('state', { lastPubDate: plan.newest.pubDate, lastGuid: plan.newest.guid, broadcastId: id, at: new Date(now()).toISOString() });
  const existing = broadcasts.find((b) => String(b.description ?? '').includes(marker));
  if (existing) {
    await remember(existing.id);
    return { action: 'exists', plan, broadcastId: existing.id, url: draftUrl(env, existing.id) };
  }

  const body = {
    subject: plan.subject,
    // An empty preview_text is left out, never sent as "": a featured story
    // with no subtitle (a YouTube video) is expected, and the owner is told.
    ...(plan.previewText ? { preview_text: plan.previewText } : {}),
    description: plan.description,
    content: plan.content,
    email_template_id: Number(env.KIT_EMAIL_TEMPLATE_ID),
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
  // The note belonged to this issue. The next one starts without.
  if (plan.editorNote) await store.put('editorNote', null);
  if (featuredPick) await store.put('featuredPick', null);
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
  const also = plan.also.length
    ? `\n\nAlso this week (moved out of the main list, still linked):\n${plan.also.map((a) => `  - ${a.item.title} (${a.reason} as "${a.sameAs.title}")`).join('\n')}`
    : '';
  const missing = plan.missing.length
    ? `\n\nWRITE BEFORE SENDING (left out of the email until written):\n${plan.missing.map((m) => `  - ${m.title}: ${m.field}`).join('\n')}\nAdd a one-line summary in the Local CMS (Newsletter Summary), or type it into the draft in Kit.`
    : '';
  const noteLine = plan.editorNote
    ? 'Editor note: included.'
    : 'Editor note: none this issue (the block is left out). To add one before Thursday: node scripts/trigger-kit-draft.mjs --note "..."';
  const pickLine = plan.pickNotFound
    ? `\nFEATURED pick "${plan.pickNotFound}" is not among this week's stories, so the newest leads.`
    : plan.featuredPicked ? '\nFEATURED: your pick.' : '';
  const meta = `${plan.issueMarker}${pickLine}\nSubject: ${plan.subject}\nPreview text: ${plan.previewText || '(none, see below)'}\n${noteLine}\n\nStories:\n${list}${left}${also}${missing}`;
  if (result.action === 'preview') {
    const note = 'Dry run: nothing was created in Kit. Drafts are switched on with CREATE_DRAFTS (scripts/hq-dispatch.md).';
    return {
      subject: `${name} draft preview (dry run): ${plan.stories[0].title}`,
      text: `${note}\n\n${meta}`,
      // The boxes as they will sit in the email, on the email's own background.
      html: `<p style="font-family:system-ui,sans-serif">${esc(note)}</p><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${esc(meta)}</pre><div style="background:#0a0a0a;padding:24px"><div style="max-width:550px;margin:0 auto">${plan.content}</div></div>`,
    };
  }
  return {
    subject: `${name} draft ready: ${plan.stories[0].title}`,
    text: `A draft is waiting in Kit. Review it and press Send there.\n${result.url}\n\n${meta}`,
    html: `<p style="font-family:system-ui,sans-serif">A draft is waiting in Kit. Review it and press Send there.</p><p><a href="${esc(result.url)}">Open the draft in Kit</a></p><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${esc(meta)}</pre>`,
  };
}
