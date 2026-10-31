/**
 * THE HQ DISPATCH preview: the email the Kit draft Worker would build from
 * the CURRENT built feed, wrapped in the real email shell, as one HTML file
 * you can open anywhere (a phone included). Nothing is sent and Kit is not
 * touched. Run `npm run build` first: it reads dist/client/dispatch.json.
 *
 *   node scripts/dispatch-preview.mjs --out preview.html
 *     --subtitle "<article slug>=<text>"   preview a subtitle you have written
 *                                          in Substack but that has not synced
 *                                          yet (the data file is NOT changed)
 *     --note-placeholder                   show the editor's note slot with a
 *                                          labelled placeholder (preview only)
 *     --issue <n>                          the issue number to show (a real run
 *                                          counts it from Kit)
 *     --layout classic|topics              default topics (one FEATURED + four
 *                                          topic slots)
 *     --reader "film,tv"                   render the PERSONALISED draft as Kit
 *                                          would for a reader with these topics
 *                                          ("" = chose nothing)
 *
 * The assembly is the Worker's own planDraft(); the markup is the site's
 * pre-rendered boxes. scripts/send-dispatch-test.mjs mails the same thing to
 * the owner only. Runbook: scripts/hq-dispatch.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articleEntry, dispatchKitPost } from '../src/lib/dispatch-feed.ts';
import { createBoxRenderer } from '../src/lib/dispatch-boxes.ts';
import { planDraft } from '../dispatch-kit-worker/kit-draft.mjs';
import { Liquid } from 'liquidjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://beunconventionalhq.com';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Text shown in the note slot by --note-placeholder. Never a note written for the author. */
export const NOTE_PLACEHOLDER = "[EDITOR'S NOTE PLACEHOLDER, preview only. Andrew writes two or three lines here in his own voice. Left blank, this whole block disappears.]";

function applyEditorial(record) {
  const e = record.editorial ?? {};
  return { ...record, title: e.title ?? record.title, excerpt: e.excerpt ?? record.excerpt, image: e.image ?? record.image, category: e.category ?? record.category };
}

/**
 * Builds the preview. `images`: 'data' inlines every site image as a data URI
 * (opens offline, on a phone), 'cid' returns them as attachments for an email.
 */
export async function buildPreview({
  subtitles = {}, notePlaceholder = false, issueNumber = null, images = 'data', now = Date.now(),
  layout = 'topics', personalize = false, readerTopics = null,
} = {}) {
  const feedPath = path.join(ROOT, 'dist/client/dispatch.json');
  if (!fs.existsSync(feedPath)) throw new Error('dist/client/dispatch.json is missing: run `npm run build` first.');
  const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

  // A subtitle written in Substack but not synced yet: re-render that one
  // story's boxes as the build would, without touching src/data/articles.json.
  if (Object.keys(subtitles).length) {
    const articles = JSON.parse(read('src/data/articles.json'));
    const renderer = createBoxRenderer({ post: read('email/hq-dispatch/post-template.liquid.html'), also: read('email/hq-dispatch/also-this-week.liquid.html') });
    for (const [slug, text] of Object.entries(subtitles)) {
      const record = articles.find((a) => a.slug === slug);
      if (!record) throw new Error(`--subtitle: no article with slug "${slug}"`);
      const entry = articleEntry({ ...applyEditorial(record), excerpt: text, editorial: { ...record.editorial, excerpt: undefined } }, `${SITE}/`);
      const at = feed.items.findIndex((i) => i.guid === entry.link);
      if (at < 0) throw new Error(`--subtitle: "${slug}" is not in this week's feed`);
      const item = feed.items[at];
      feed.items[at] = { ...item, newsletter: entry.newsletter, ...(await renderer.boxes(dispatchKitPost(entry, item.imageUrl))) };
    }
  }

  const env = { NEWSLETTER_NAME: 'THE HQ DISPATCH', LAYOUT: layout, PERSONALIZE: personalize ? 'true' : 'false' };
  const plan = planDraft(feed, null, env, now, {
    issueNumber,
    editorNote: notePlaceholder ? NOTE_PLACEHOLDER : '',
  });
  if (!plan) throw new Error('No story in the last 7 days: nothing to preview.');

  // A personalised draft is Liquid that Kit renders per reader. Render it the
  // way Kit would for one reader (readerTopics, "" = chose nothing).
  const content = personalize
    ? await new Liquid().parseAndRender(plan.content, { subscriber: { hq_topics: readerTopics ?? '' } })
    : plan.content;
  let html = read('email/hq-dispatch/template.html')
    .replace('{{ message_content }}', () => content)
    .replace('{{ unsubscribe_url }}', '#unsubscribe-preview')
    .replace('{{ subscriber.email_address | url_encode }}', 'andrew%40beunconventionalhq.com')
    .replace('{{ subscriber_preferences_url }}', '#preferences-preview');

  // Site images: the new masthead is only on this branch, so serve every
  // /dispatch/ image from the working copy rather than from production.
  const attachments = [];
  html = html.replace(/https:\/\/beunconventionalhq\.com(\/dispatch\/[\w./-]+\.(?:png|jpe?g))/g, (url, rel) => {
    const file = path.join(ROOT, 'public', rel);
    if (!fs.existsSync(file)) return url;
    const type = rel.endsWith('.png') ? 'image/png' : 'image/jpeg';
    if (images === 'data') return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
    const id = path.basename(rel).replace(/[^\w.-]/g, '');
    if (!attachments.some((a) => a.content_id === id)) {
      attachments.push({ filename: path.basename(rel), content: fs.readFileSync(file).toString('base64'), content_id: id });
    }
    return `cid:${id}`;
  });
  return { html, plan, attachments };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const subtitles = {};
  args.forEach((a, i) => {
    if (a !== '--subtitle') return;
    const [slug, ...rest] = String(args[i + 1] ?? '').split('=');
    subtitles[slug] = rest.join('=');
  });
  const out = value('--out') ?? 'dispatch-preview.html';
  const { html, plan } = await buildPreview({
    subtitles, notePlaceholder: args.includes('--note-placeholder'), issueNumber: value('--issue') ? Number(value('--issue')) : null,
    layout: value('--layout') ?? 'topics',
    personalize: args.includes('--reader'),
    readerTopics: value('--reader') ?? null,
  });
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`);
  console.log(`${plan.issueMarker}\nSubject: ${plan.subject}\nPreview text: ${plan.previewText}`);
  console.log(`Layout: ${plan.layout}`);
  if (plan.byTopic) for (const [t, xs] of Object.entries(plan.byTopic)) console.log(`  ${t}: ${xs.map((x) => x.title + (x.isUpcomingEvent ? ' (upcoming event)' : '')).join(' / ') || '(nothing)'}`);
  console.log(`Main: ${plan.stories.map((s) => s.title).join(' / ')}`);
  if (plan.also.length) console.log(`${plan.layout === 'classic' ? 'Also this week' : 'Left out as duplicates'}: ${plan.also.map((a) => `${a.item.title} (${a.reason} as ${a.sameAs.title})`).join(' / ')}`);
  if (plan.left) console.log(`Left out (over the cap): ${plan.left}`);
  if (plan.missing.length) console.log(`WRITE BEFORE SENDING:\n${plan.missing.map((m) => `  - ${m.title}: ${m.field}`).join('\n')}`);
}
