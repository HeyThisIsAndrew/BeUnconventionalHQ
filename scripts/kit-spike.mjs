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
 * Per-reader topics (PERSONALIZE), before switching it on:
 *   KIT_API_KEY=... node scripts/kit-spike.mjs subscriber you+film@example.com film,tv
 *       Gives one of YOUR test addresses its topics in Kit (creates it if new).
 *   npm run build && KIT_API_KEY=... node scripts/kit-spike.mjs create-personalized --template <id>
 *       One draft from this week's real feed, written as Kit Liquid so Kit
 *       fills each reader's four slots. Send it to two test addresses with
 *       different topics: each should get FEATURED plus their own topics.
 *       If Kit shows raw {% ... %} tags instead, leave PERSONALIZE off.
 *
 * Record the outcome (or the exact error and plan limit) on #278 and #272.
 * Runbook: scripts/hq-dispatch.md.
 */
import { renderPosts, FIXTURE_POSTS } from './hq-dispatch-render.mjs';
import fs from 'node:fs';
import { kitRequest, draftUrl, planDraft } from '../dispatch-kit-worker/kit-draft.mjs';
import { parseTopics, formatTopics } from '../src/lib/dispatch-topics.ts';

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
} else if (command === 'subscriber') {
  // A test helper for the owner's OWN addresses: sets topics directly.
  const [email, topics] = rest;
  if (!email?.includes('@')) throw new Error('Pass an email address and topics, e.g. subscriber you+tv@example.com tv');
  const value = formatTopics(parseTopics(topics ?? ''));
  const found = await kitRequest(env, 'GET', `/subscribers?${new URLSearchParams({ email_address: email.toLowerCase(), status: 'all' })}`);
  const existing = found.subscribers?.[0];
  if (existing) await kitRequest(env, 'PUT', `/subscribers/${existing.id}`, { fields: { hq_topics: value } }, { attempts: 1 });
  else await kitRequest(env, 'POST', '/subscribers', { email_address: email.toLowerCase(), fields: { hq_topics: value } }, { attempts: 1 });
  console.log(`${email}: hq_topics = "${value}" (${existing ? 'updated' : 'created'}). If Kit says the field does not exist, create the custom field hq_topics first.`);
} else if (command === 'create-personalized') {
  const templateId = Number(flag('--template'));
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error('Pass --template <id> (see: templates).');
  const feedPath = new URL('../dist/client/dispatch.json', import.meta.url);
  if (!fs.existsSync(feedPath)) throw new Error('Run `npm run build` first.');
  const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  const plan = planDraft(feed, null, { NEWSLETTER_NAME: 'THE HQ DISPATCH', LAYOUT: 'topics', PERSONALIZE: 'true', FIRST_WINDOW_DAYS: '14' }, Date.now());
  if (!plan) throw new Error('No story in the last 14 days to build a test from.');
  const result = await kitRequest(env, 'POST', '/broadcasts', {
    subject: 'THE HQ DISPATCH: per-reader topics test, delete me',
    preview_text: 'Test draft created by scripts/kit-spike.mjs. Never sent.',
    // Not the Worker's marker, so this test never counts as an issue.
    description: '[hq-dispatch spike] Per-reader topics test. Safe to delete.',
    content: plan.content,
    email_template_id: templateId,
    public: false,
    send_at: null,
  }, { attempts: 1 });
  const id = result.broadcast?.id ?? result.id;
  console.log(`Draft created: ${id}\nOpen it: ${draftUrl({}, id)}`);
  for (const [t, xs] of Object.entries(plan.byTopic)) console.log(`  ${t}: ${xs.map((x) => x.title).join(' / ') || '(nothing)'}`);
} else if (command === 'delete') {
  const id = rest[0];
  if (!/^\d+$/.test(id ?? '')) throw new Error('Pass the broadcast id to delete.');
  await kitRequest(env, 'DELETE', `/broadcasts/${id}`, null, { attempts: 1 });
  console.log(`Deleted draft ${id}.`);
} else {
  console.log('Usage: node scripts/kit-spike.mjs templates | create --template <id> | delete <id> | subscriber <email> <topics> | create-personalized --template <id>');
  process.exitCode = 1;
}
