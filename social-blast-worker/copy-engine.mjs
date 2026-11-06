/**
 * Copy engine (issue #281): turns one /dispatch.json item into the wording for
 * each platform, from the owner's own templates (templates.json). It never
 * writes copy of its own: it picks a template, swaps in variables that come
 * from the item's real metadata, and trims to the platform's limit.
 *
 * Plain module, no Worker APIs, so scripts/social-blast.test.mjs runs it
 * under node.
 *
 * ─── THE RULES IT ENFORCES ───────────────────────────────────────────────
 *   - A template that needs a variable the item does not have (no summary,
 *     no section) is not eligible. If no template is, the platform is
 *     BLOCKED and the run reports it. It never guesses a value.
 *   - Rotation: never the template used last time on the same platform for
 *     the same content type, and, where there are enough templates, never
 *     the same template on two platforms for one story.
 *   - LIVE posts use approved templates only. Unapproved ones are good for
 *     dry-run previews and draft emails, nothing else.
 */

export const LIVE_PLATFORMS = ['bluesky', 'threads', 'facebook'];
export const DRAFT_PLATFORMS = ['x', 'youtube'];
export const ALL_PLATFORMS = [...LIVE_PLATFORMS, ...DRAFT_PLATFORMS];

/** Platforms that render the link as a preview card, so the URL need not be in the text. */
const CARD_PLATFORMS = new Set(['bluesky', 'threads', 'facebook']);

/**
 * Length limits. Bluesky counts graphemes; X weighs every link as 23
 * characters (t.co); Threads counts characters. Facebook and YouTube allow far
 * more than any announcement should use, so those limits are house limits.
 */
export const PLATFORM_LIMITS = { bluesky: 300, threads: 500, facebook: 2000, x: 280, youtube: 1500 };
const X_LINK_WEIGHT = 23;
/** A summary trimmed shorter than this says nothing; the template is skipped instead. */
const MIN_SUMMARY = 40;

const VARIABLES = new Set(['title', 'summary', 'section', 'type', 'url']);
const VARIABLE_RE = /\{\{\s*([a-z]+)\s*\}\}/g;
const URL_RE = /https?:\/\/[^\s]+/g;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
export function graphemeLength(text) {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

export function platformLength(platform, text) {
  if (platform === 'bluesky') return graphemeLength(text);
  if (platform === 'x') {
    const links = text.match(URL_RE) ?? [];
    return Array.from(text.replace(URL_RE, '')).length + links.length * X_LINK_WEIGHT;
  }
  return Array.from(text).length;
}

export function templateVariables(text) {
  return [...new Set([...String(text).matchAll(VARIABLE_RE)].map((m) => m[1]))];
}

/**
 * Validates a parsed templates.json and returns it. Throws with every problem
 * listed, so a bad edit is reported whole rather than one error per run.
 */
export function validateTemplates(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || !doc.templates || typeof doc.templates !== 'object') {
    throw new Error('templates.json: missing "templates" object');
  }
  const ids = new Set();
  for (const [type, list] of Object.entries(doc.templates)) {
    if (!Array.isArray(list) || !list.length) problems.push(`${type}: needs at least one template`);
    for (const t of list ?? []) {
      if (!t?.id || typeof t.text !== 'string' || !t.text.trim()) problems.push(`${type}: a template is missing its id or text`);
      if (t?.id && ids.has(t.id)) problems.push(`${t.id}: duplicate id`);
      if (t?.id) ids.add(t.id);
      for (const v of templateVariables(t?.text ?? '')) {
        if (!VARIABLES.has(v)) problems.push(`${t.id}: unknown variable {{${v}}}`);
      }
      for (const p of t?.platforms ?? []) {
        if (!ALL_PLATFORMS.includes(p)) problems.push(`${t.id}: unknown platform "${p}"`);
      }
    }
  }
  const known = new Set(Object.keys(doc.templates));
  for (const target of [...Object.values(doc.typeMap ?? {}), ...Object.values(doc.sectionMap ?? {}), doc.fallbackType]) {
    if (target && !known.has(target)) problems.push(`maps to "${target}", which has no templates`);
  }
  if (!doc.fallbackType) problems.push('missing "fallbackType"');
  if (problems.length) throw new Error(`templates.json: ${problems.join('; ')}`);
  return doc;
}

/**
 * Which template set an item uses. A video is always a video (its link opens
 * YouTube, so "read" wording would be wrong). An article goes by its section
 * first (event coverage), then its content type, then the fallback set.
 */
export function contentTypeOf(item, doc) {
  const [type = '', section = ''] = item.categories ?? [];
  if (item.kind === 'video') return doc.typeMap?.Video ?? doc.fallbackType;
  return doc.sectionMap?.[section] ?? doc.typeMap?.[type] ?? doc.fallbackType;
}

/** The variables an item really has. Absent ones stay absent. */
export function itemVariables(item) {
  const [type, section] = item.categories ?? [];
  const vars = {
    title: String(item.title ?? '').trim(),
    summary: String(item.summary ?? '').trim(),
    section: String(section ?? '').trim(),
    type: String(type ?? '').trim(),
    url: String(item.link ?? '').trim(),
  };
  return Object.fromEntries(Object.entries(vars).filter(([, v]) => v));
}

function interpolate(text, vars) {
  return text.replace(VARIABLE_RE, (_, name) => vars[name]).replace(/[ \t]+\n/g, '\n').trim();
}

/** Shortens text at a word boundary to `max` characters, ending in an ellipsis. */
function shorten(text, max) {
  if (Array.from(text).length <= max) return text;
  if (max < 2) return '';
  const cut = Array.from(text).slice(0, max - 1).join('');
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max / 2 ? atWord : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * Renders one template for one platform, or returns null if it cannot be
 * rendered honestly: a variable it needs is missing, or it stays over the
 * limit even with the summary trimmed away to nothing.
 */
export function renderTemplate(template, vars, platform) {
  const needed = templateVariables(template.text);
  if (needed.some((v) => !vars[v])) return null;
  const limit = PLATFORM_LIMITS[platform];
  const withLink = (text) =>
    CARD_PLATFORMS.has(platform) || needed.includes('url') ? text : `${text}\n\n${vars.url}`;
  let text = withLink(interpolate(template.text, vars));
  if (platformLength(platform, text) <= limit) return text;
  if (!needed.includes('summary')) return null;
  // Trim only the summary: it is the one variable written to be shortened.
  // Each pass cuts the summary by however much the text is still over.
  let budget = Array.from(vars.summary).length;
  for (;;) {
    budget -= Math.max(1, platformLength(platform, text) - limit);
    if (budget < MIN_SUMMARY) return null;
    text = withLink(interpolate(template.text, { ...vars, summary: shorten(vars.summary, budget) }));
    if (platformLength(platform, text) <= limit) return text;
  }
}

/**
 * Picks and renders the template for one platform.
 *   lastUsed   the template id used last time on this platform for this type
 *   usedNow    ids already taken by other platforms for this same story
 *   live       true when this text will really be posted (approved only)
 * Returns { template, text } or { blocked: reason }.
 */
export function pickVariant(doc, item, platform, { lastUsed = null, usedNow = new Set(), live = false } = {}) {
  const type = contentTypeOf(item, doc);
  const vars = itemVariables(item);
  if (!vars.title || !vars.url) return { blocked: 'the story has no title or link', type };
  const all = (doc.templates[type] ?? []).filter((t) => !t.retired);
  const own = all.filter((t) => t.platforms?.includes(platform));
  let pool = own.length ? own : all.filter((t) => !t.platforms);
  if (live) pool = pool.filter((t) => t.approved === true);
  if (!pool.length) {
    return { blocked: live ? `no approved "${type}" template for ${platform}` : `no "${type}" template for ${platform}`, type };
  }
  // Start just after the last one used, so the set is walked in order.
  const start = (pool.findIndex((t) => t.id === lastUsed) + 1) % pool.length;
  const ordered = [...pool.slice(start), ...pool.slice(0, start)];
  const passes = [
    (t) => t.id !== lastUsed && !usedNow.has(t.id),
    (t) => t.id !== lastUsed,
    // One template is all there is: repeating it is the only honest option.
    () => pool.length === 1,
  ];
  for (const allowed of passes) {
    for (const template of ordered) {
      if (!allowed(template)) continue;
      const text = renderTemplate(template, vars, platform);
      if (text) return { template, text, type };
    }
  }
  const missing = ['summary', 'section'].filter((v) => !vars[v]);
  return {
    blocked: `no "${type}" template fits ${platform}${missing.length ? ` (story has no ${missing.join(' or ')})` : ''}`,
    type,
  };
}
