/**
 * Sends ONE test copy of THE HQ DISPATCH preview to the owner, and to nobody
 * else, through Resend (not Kit: no list, no subscribers, nothing scheduled).
 * For checking the layout in real Gmail and Apple Mail, light and dark, on a
 * phone, before anything goes to Kit.
 *
 *   npm run build
 *   RESEND_API_KEY=... node scripts/send-dispatch-test.mjs [--subtitle "<slug>=<text>"] [--note-placeholder] [--issue 1]
 *
 * Same options as scripts/dispatch-preview.mjs. The images travel inside the
 * email (Resend inline attachments, cid:), so the new masthead shows even
 * though it is not deployed yet. Runbook: scripts/hq-dispatch.md.
 */
import { buildPreview } from './dispatch-preview.mjs';

/** The only address this script will ever send to. */
const OWNER = 'andrew@beunconventionalhq.com';
const FROM = 'noreply@beunconventionalhq.com';

if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required (the same key the automation alerts use).');
const args = process.argv.slice(2);
if (args.includes('--to')) throw new Error(`This script only sends to ${OWNER}. There is no --to.`);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const subtitles = {};
args.forEach((a, i) => {
  if (a !== '--subtitle') return;
  const [slug, ...rest] = String(args[i + 1] ?? '').split('=');
  subtitles[slug] = rest.join('=');
});

const { html, plan, attachments } = await buildPreview({
  subtitles, notePlaceholder: args.includes('--note-placeholder'),
  issueNumber: value('--issue') ? Number(value('--issue')) : null, images: 'cid',
});
const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: FROM,
    to: OWNER,
    subject: `[TEST, not sent to the list] ${plan.subject}`,
    html,
    attachments,
  }),
});
const text = await response.text();
if (!response.ok) throw new Error(`Resend refused the test: HTTP ${response.status} ${text.slice(0, 300)}`);
console.log(`Test sent to ${OWNER} only. ${plan.issueMarker}. ${plan.stories.length} stories, ${plan.also.length} in Also this week.`);
if (plan.missing.length) console.log(`Still to write:\n${plan.missing.map((m) => `  - ${m.title}: ${m.field}`).join('\n')}`);
