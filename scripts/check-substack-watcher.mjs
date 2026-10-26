import { signAutomationRequest } from '../src/lib/automation-auth.mjs';

const execute = process.argv.includes('--execute');
const forceFailure = process.argv.includes('--test-failure');
if (!process.env.WEBSUB_SECRET) throw new Error('WEBSUB_SECRET is required; use the existing local .env.');
if (forceFailure && !execute) throw new Error('An alert test sends a notification. Pass --execute explicitly.');
const body = JSON.stringify({ dryRun: !execute, forceFailure });
const response = await fetch('https://hq-substack-source.heythisisandrewb.workers.dev/poll', {
  method: 'POST', headers: await signAutomationRequest(process.env.WEBSUB_SECRET, body), body,
  signal: AbortSignal.timeout(60000),
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (forceFailure && result.alerted === true) {
  console.log('Forced failure reached the notification service. No content baseline was changed.');
} else if (!response.ok || !result.ok) {
  process.exitCode = 1;
}
