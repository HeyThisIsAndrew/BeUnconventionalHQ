/**
 * Pokes the social distribution Worker (social-blast-worker/). deploy.yml runs
 * it after every production deploy; the owner runs it by hand to preview.
 *
 *   node scripts/trigger-social-blast.mjs            run a blast now
 *   node scripts/trigger-social-blast.mjs --inspect  show what the next run
 *                                                    would post; changes nothing
 *
 * Needs WEBSUB_SECRET (the shared automation secret, already in .env).
 * Runbook: scripts/social-blast.md.
 */
import { signAutomationRequest } from '../src/lib/automation-auth.mjs';

const BLAST_URL = process.env.SOCIAL_BLAST_URL || 'https://hq-social-blast.heythisisandrewb.workers.dev/blast';
const inspect = process.argv.includes('--inspect');
if (!process.env.WEBSUB_SECRET) throw new Error('WEBSUB_SECRET is required; use the existing local .env.');

const body = JSON.stringify({ inspect });
const response = await fetch(BLAST_URL, {
  method: 'POST', headers: await signAutomationRequest(process.env.WEBSUB_SECRET, body), body,
  // A live run waits for every platform to answer.
  signal: AbortSignal.timeout(120000),
});
const text = await response.text();
let result;
try { result = JSON.parse(text); } catch { result = { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }; }
if (inspect && result.report) {
  console.log(result.report.subject, '\n');
  console.log(result.report.text);
} else {
  console.log(JSON.stringify({ ok: result.ok, action: result.action, problems: result.problems ?? 0, error: result.error, reportError: result.reportError }, null, 2));
}
if (!response.ok || !result.ok) process.exitCode = 1;
