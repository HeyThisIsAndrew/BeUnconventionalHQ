/**
 * One-time import: the addresses the site's signup form saved to Cloudflare
 * KV (`subscriber:<email>`) into Kit, where THE HQ DISPATCH is sent from.
 * Until KIT_SYNC_SIGNUPS was added, the form wrote to KV only, so none of
 * these people would get the newsletter.
 *
 * OWNER'S DECISION (2026-10-31): everyone imported goes through a Kit FORM,
 * so Kit sends its own confirmation email and only people who confirm get
 * the newsletter. The site never sent one, and a list that never confirmed
 * is how a first send lands in spam. KIT_FORM_ID is therefore required.
 *
 *   CLOUDFLARE_API_TOKEN=... KIT_API_KEY=... KIT_FORM_ID=... node scripts/kv-subscribers-to-kit.mjs
 *       dry run: counts and lists, writes nothing
 *   ... node scripts/kv-subscribers-to-kit.mjs --execute
 *       imports, paced under Kit's 120 requests a minute
 *
 * Safe to re-run: Kit's create call updates an address it already has.
 * Skips anyone the preference page marked unsubscribed. Topics saved at
 * signup go into the Kit field (none saved means all four).
 * Runbook: scripts/hq-dispatch.md.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { saveKitTopics } from '../src/lib/newsletter-prefs.ts';
import { parseTopics } from '../src/lib/dispatch-topics.ts';

/** wrangler.jsonc: account and the `KV` binding's namespace. */
const ACCOUNT = 'b10b7bc3e6a0fd361ba0956c8aa7d307';
const NAMESPACE = '39a5bcb599264b7b8cfffcd6c867bf16';
/** Two Kit calls per address (create, add to form), 120 a minute allowed. */
const PACE_MS = 1100;

/** Every `subscriber:` record in KV, parsed. Unreadable values are reported, not guessed at. */
export async function listKvSubscribers({ token, account = ACCOUNT, namespace = NAMESPACE, fetchImpl = fetch }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}`;
  const headers = { Authorization: `Bearer ${token}` };
  const names = [];
  let cursor = '';
  do {
    const q = new URLSearchParams({ prefix: 'subscriber:', limit: '1000', ...(cursor ? { cursor } : {}) });
    const res = await fetchImpl(`${base}/keys?${q}`, { headers });
    if (!res.ok) throw new Error(`Cloudflare KV list: HTTP ${res.status}`);
    const body = await res.json();
    names.push(...(body.result ?? []).map((k) => k.name));
    cursor = body.result_info?.cursor || '';
  } while (cursor);
  const records = [];
  const unreadable = [];
  for (const name of names) {
    const res = await fetchImpl(`${base}/values/${encodeURIComponent(name)}`, { headers });
    if (!res.ok) { unreadable.push(name); continue; }
    try {
      const value = JSON.parse(await res.text());
      records.push({ ...value, email: String(value.email ?? name.slice('subscriber:'.length)).trim().toLowerCase() });
    } catch {
      unreadable.push(name);
    }
  }
  return { records, unreadable };
}

/** Imports (or, without execute, plans) each record. Returns what happened to whom. */
export async function importSubscribers(records, cfg, { execute = false, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!cfg.formId) throw new Error('KIT_FORM_ID is required: imported readers must get Kit\'s confirmation email.');
  const result = { imported: [], skipped: [], failed: [] };
  for (const record of records) {
    if (!record.email || !record.email.includes('@')) { result.skipped.push({ email: record.email, why: 'no address' }); continue; }
    if (record.unsubscribedAt) { result.skipped.push({ email: record.email, why: 'unsubscribed' }); continue; }
    const topics = parseTopics(record.topics);
    if (!execute) { result.imported.push({ email: record.email, topics }); continue; }
    try {
      await saveKitTopics(cfg, record.email, topics, { addToForm: true, fetchImpl });
      result.imported.push({ email: record.email, topics });
    } catch (error) {
      result.failed.push({ email: record.email, why: error instanceof Error ? error.message : String(error) });
    }
    await sleep(PACE_MS);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const execute = process.argv.includes('--execute');
  const { CLOUDFLARE_API_TOKEN, KIT_API_KEY, KIT_FORM_ID, KIT_TOPICS_FIELD } = process.env;
  if (!CLOUDFLARE_API_TOKEN || !KIT_API_KEY || !KIT_FORM_ID) {
    throw new Error('CLOUDFLARE_API_TOKEN, KIT_API_KEY and KIT_FORM_ID are all required.');
  }
  const { records, unreadable } = await listKvSubscribers({ token: CLOUDFLARE_API_TOKEN });
  console.log(`${records.length} subscriber records in KV${unreadable.length ? `, ${unreadable.length} unreadable` : ''}.`);
  const result = await importSubscribers(records, { apiKey: KIT_API_KEY, formId: KIT_FORM_ID, field: KIT_TOPICS_FIELD || 'hq_topics' }, { execute });
  console.log(`${execute ? 'Imported' : 'Would import'}: ${result.imported.length}. Skipped: ${result.skipped.length}. Failed: ${result.failed.length}.`);
  for (const s of result.skipped) console.log(`  skipped ${s.email}: ${s.why}`);
  for (const f of result.failed) console.log(`  FAILED ${f.email}: ${f.why}`);
  if (!execute) console.log('Dry run. Pass --execute to import. Each address gets Kit\'s confirmation email.');
  if (result.failed.length) process.exitCode = 1;
}
