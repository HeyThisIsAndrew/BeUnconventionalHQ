/**
 * Review and approve the social post templates
 * (social-blast-worker/templates.json, issue #281) without editing JSON.
 *
 *   node scripts/social-templates.mjs                  every template, filled in
 *                                                      with a real story, per platform
 *   node scripts/social-templates.mjs --type review    one content type only
 *   node scripts/social-templates.mjs --approve review-01,review-05
 *   node scripts/social-templates.mjs --approve-type review     all of one type
 *   node scripts/social-templates.mjs --unapprove review-05
 *
 * Only APPROVED templates may post live (copy-engine.mjs). Approving here
 * rewrites templates.json in its existing layout; merge it and
 * deploy-social-blast.yml puts it live. Real stories come from the built feed
 * (`npm run build` first); without one, a labelled sample is used.
 * Runbook: scripts/social-blast.md.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateTemplates, contentTypeOf, renderTemplate, itemVariables, ALL_PLATFORMS } from '../social-blast-worker/copy-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES_PATH = path.join(ROOT, 'social-blast-worker/templates.json');

/**
 * templates.json in its hand-kept layout: everything at the top as plain
 * JSON, one template per line. serialize(parse(file)) === file, so this
 * script never reformats what an editor wrote.
 */
export function serializeTemplates(doc) {
  const head = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'templates'));
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  const types = Object.entries(doc.templates).map(([type, list]) =>
    `    ${JSON.stringify(type)}: [\n${list.map((t) => `      ${JSON.stringify(t).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/":/g, '": ').replace(/,"/g, ', "')}`).join(',\n')}\n    ]`);
  return `${top},\n  "templates": {\n${types.join(',\n')}\n  }\n}\n`;
}

/** Sets `approved` on the named templates (ids, or every template of `type`). Returns the ids changed. */
export function setApproved(doc, { ids = [], type = null, approved = true }) {
  const changed = [];
  for (const [t, list] of Object.entries(doc.templates)) {
    for (const template of list) {
      if ((type && t === type) || ids.includes(template.id)) {
        if (template.approved !== approved) changed.push(template.id);
        template.approved = approved;
      }
    }
  }
  const unknown = ids.filter((id) => !Object.values(doc.templates).flat().some((t) => t.id === id));
  if (unknown.length) throw new Error(`No template with id ${unknown.join(', ')}`);
  if (type && !doc.templates[type]) throw new Error(`No content type "${type}"`);
  return changed;
}

/** One real story per content type from the built feed, else a labelled sample. */
function sampleStories(doc) {
  const feedPath = path.join(ROOT, 'dist/client/dispatch.json');
  const items = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, 'utf8')).items : [];
  const byType = {};
  for (const item of items) byType[contentTypeOf(item, doc)] ??= item;
  const sample = {
    kind: 'article', title: '(sample) A Story Title', link: 'https://beunconventionalhq.com/intel/sample',
    summary: '(sample) The standfirst for the story.', categories: ['Review', 'Film'],
  };
  return (type) => byType[type] ?? { ...sample, kind: type === 'video' ? 'video' : 'article' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const doc = validateTemplates(JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8')));
  const approve = value('--approve');
  const approveType = value('--approve-type');
  const unapprove = value('--unapprove');
  if (approve || approveType || unapprove) {
    const changed = unapprove
      ? setApproved(doc, { ids: unapprove.split(','), approved: false })
      : setApproved(doc, { ids: approve ? approve.split(',') : [], type: approveType ?? null });
    fs.writeFileSync(TEMPLATES_PATH, serializeTemplates(doc));
    console.log(`${unapprove ? 'Unapproved' : 'Approved'}: ${changed.join(', ') || 'nothing changed'}. Wrote social-blast-worker/templates.json.`);
  } else {
    const storyFor = sampleStories(doc);
    const only = value('--type');
    for (const [type, list] of Object.entries(doc.templates)) {
      if (only && type !== only) continue;
      const story = storyFor(type);
      const vars = itemVariables(story);
      const approvedCount = list.filter((t) => t.approved === true).length;
      console.log(`\n=== ${type.toUpperCase()}: ${approvedCount}/${list.length} approved. Example story: ${story.title}`);
      for (const t of list) {
        const platforms = t.platforms ?? ALL_PLATFORMS;
        console.log(`\n[${t.approved === true ? 'APPROVED' : '  draft '}] ${t.id}${t.retired ? ' (retired)' : ''}${t.platforms ? ` (only ${t.platforms.join(', ')})` : ''}`);
        console.log(`  template: ${t.text.replace(/\n/g, ' / ')}`);
        const rendered = platforms.map((p) => [p, renderTemplate(t, vars, p)]);
        const fits = rendered.filter(([, text]) => text);
        if (fits.length) console.log(`  e.g. ${fits[0][0]}: ${fits[0][1].replace(/\n/g, ' / ')}`);
        const misses = rendered.filter(([, text]) => !text).map(([p]) => p);
        if (misses.length) console.log(`  does not fit this story on: ${misses.join(', ')} (missing variable or too long)`);
      }
    }
    console.log('\nApprove with --approve <ids> or --approve-type <type>. Only approved templates post live.');
  }
}
