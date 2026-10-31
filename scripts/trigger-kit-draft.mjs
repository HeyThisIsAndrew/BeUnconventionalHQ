/**
 * Runs the weekly Kit draft Worker (dispatch-kit-worker/) by hand.
 *
 *   node scripts/trigger-kit-draft.mjs                 dry run: emails the
 *                                                      would-be draft, Kit untouched
 *   node scripts/trigger-kit-draft.mjs --execute       a real run (creates the
 *                                                      draft if CREATE_DRAFTS is on)
 *   node scripts/trigger-kit-draft.mjs --test-failure  sends the failure alert
 *
 * Needs WEBSUB_SECRET (the shared automation secret, already in .env).
 * Runbook: scripts/hq-dispatch.md.
 */
import { signAutomationRequest } from '../src/lib/automation-auth.mjs';

const URL_ = process.env.DISPATCH_KIT_URL || 'https://hq-dispatch-kit.heythisisandrewb.workers.dev/draft';
if (!process.env.WEBSUB_SECRET) throw new Error('WEBSUB_SECRET is required; use the existing local .env.');
const execute = process.argv.includes('--execute');
const forceFailure = process.argv.includes('--test-failure');

const body = JSON.stringify({ dryRun: !execute, forceFailure });
const response = await fetch(URL_, {
  method: 'POST', headers: await signAutomationRequest(process.env.WEBSUB_SECRET, body), body,
  signal: AbortSignal.timeout(120000),
});
const text = await response.text();
let result;
try { result = JSON.parse(text); } catch { result = { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }; }
console.log(JSON.stringify(result, null, 2));
if (forceFailure && result.alerted) console.log('The failure alert was sent. Nothing else happened.');
else if (!response.ok || !result.ok) process.exitCode = 1;
