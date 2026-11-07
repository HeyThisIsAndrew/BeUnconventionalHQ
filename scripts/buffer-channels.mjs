/**
 * Lists the Buffer channels on the account, with the ids the social Worker
 * needs (BUFFER_X_CHANNEL_ID, BUFFER_SUBSTACK_CHANNEL_ID in
 * social-blast-worker/wrangler.jsonc). Read-only: it posts nothing.
 *
 *   BUFFER_API_KEY=… node scripts/buffer-channels.mjs
 *
 * Runbook: scripts/social-blast.md ("X and Substack Notes through Buffer").
 */
import { BUFFER_API } from '../social-blast-worker/platforms.mjs';

async function graphql(query) {
  const response = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) {
    throw new Error(`Buffer answered HTTP ${response.status}: ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body.data;
}

if (!process.env.BUFFER_API_KEY) {
  console.error('Set BUFFER_API_KEY (Buffer: Settings > API).');
  process.exit(1);
}
const { account } = await graphql('query { account { organizations { id name } } }');
for (const org of account?.organizations ?? []) {
  const { channels } = await graphql(`query { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name displayName service } }`);
  console.log(`Organization ${org.name ?? org.id}`);
  for (const c of channels ?? []) console.log(`  ${c.service.padEnd(12)} ${c.id}  ${c.displayName || c.name}`);
}
