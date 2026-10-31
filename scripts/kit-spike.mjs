/**
 * Issue #278: prove the Kit API can create a THE HQ DISPATCH draft on the
 * free Newsletter plan, BEFORE the weekly Worker (dispatch-kit-worker/) is
 * switched on. Every step is by hand and nothing here can send an email:
 * a broadcast created with send_at null is a draft.
 *
 *   KIT_API_KEY=... node scripts/kit-spike.mjs templates
 *       Lists your Kit email templates. Note the id of the HQ Dispatch one
 *       (upload email/hq-dispatch/template.html first if it is not there).
 *   KIT_API_KEY=... node scripts/kit-spike.mjs create --template <id>
 *       Creates ONE draft from the mockup's five stories, rendered by the same
 *       engine and template as email/hq-dispatch/mockup.html. Then: open it in
 *       Kit, check the preview, send test emails to Gmail and Apple Mail.
 *   KIT_API_KEY=... node scripts/kit-spike.mjs delete <broadcast id>
 *       Deletes the test draft afterwards.
 *
 * Record the outcome (or the exact error and plan limit) on #278 and #272.
 * Runbook: scripts/hq-dispatch.md.
 */
import { renderPosts, FIXTURE_POSTS } from './hq-dispatch-render.mjs';
import { kitRequest, draftUrl } from '../dispatch-kit-worker/kit-draft.mjs';

const env = { KIT_API_KEY: process.env.KIT_API_KEY };
if (!env.KIT_API_KEY) throw new Error('KIT_API_KEY is required (Kit > Settings > Developer > API keys, v4).');
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

if (command === 'templates') {
  const result = await kitRequest(env, 'GET', '/email_templates');
  for (const t of result.email_templates ?? []) console.log(`${t.id}\t${t.name}${t.is_default ? '\t(default)' : ''}`);
} else if (command === 'create') {
  const templateId = Number(flag('--template'));
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error('Pass --template <id> (see: templates).');
  // The mockup's fixtures point at local files; Kit needs the live images.
  const content = (await renderPosts(FIXTURE_POSTS)).replaceAll('../../public/', 'https://beunconventionalhq.com/');
  const result = await kitRequest(env, 'POST', '/broadcasts', {
    subject: 'THE HQ DISPATCH: API spike (#278), delete me',
    preview_text: 'Test draft created by scripts/kit-spike.mjs. Never sent.',
    description: '[hq-dispatch spike] Issue #278 test draft. Safe to delete.',
    content,
    email_template_id: templateId,
    public: false,
    send_at: null,
  }, { attempts: 1 });
  const id = result.broadcast?.id ?? result.id;
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nDraft created: ${id}\nOpen it: ${draftUrl({}, id)} (if that link is wrong, find it under Broadcasts > Drafts and note the real URL pattern for KIT_DRAFT_URL)`);
  console.log(`Content is ${Math.round(Buffer.byteLength(content) / 1024)} KB of story boxes (Gmail clips the WHOLE email at 102 KB).`);
} else if (command === 'delete') {
  const id = rest[0];
  if (!/^\d+$/.test(id ?? '')) throw new Error('Pass the broadcast id to delete.');
  await kitRequest(env, 'DELETE', `/broadcasts/${id}`, null, { attempts: 1 });
  console.log(`Deleted draft ${id}.`);
} else {
  console.log('Usage: node scripts/kit-spike.mjs templates | create --template <id> | delete <id>');
  process.exitCode = 1;
}
