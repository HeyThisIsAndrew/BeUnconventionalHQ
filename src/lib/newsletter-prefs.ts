/**
 * Newsletter topics: who wants what, and how a reader changes it.
 *
 *   - The signup form asks for topics inline (Film, TV, Games, Events; all on
 *     by default) and the `subscribe` action stores them with the address.
 *   - The preference page (/newsletter) is reached through a SIGNED link that
 *     is emailed to the address: knowing an address is not enough to change
 *     somebody's topics or unsubscribe them. A link lasts LINK_TTL_HOURS.
 *   - Kit holds the copy the newsletter reads: the subscriber custom field
 *     `hq_topics` ("film,tv"; empty means all four). The Kit draft Worker
 *     turns that into each reader's four slots (dispatch-kit-worker/).
 *   - Kit stays the place a reader unsubscribes in one click: every email
 *     carries Kit's own unsubscribe link, which this does not replace.
 *
 * Plain module: every outside call comes in as an argument, so
 * scripts/newsletter-prefs.test.mjs runs it under node. Runbook:
 * scripts/hq-dispatch.md.
 */
import { formatTopics, parseTopics, type Topic } from './dispatch-topics.ts';

export const LINK_TTL_HOURS = 48;
const DOMAIN = 'HQ_NEWSLETTER_PREFS_V1';
const KIT_API = 'https://api.kit.com/v4';
const encoder = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export const normalizeEmail = (email: string) => String(email ?? '').trim().toLowerCase();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${DOMAIN}\n${message}`)));
}

/** A token for one address, valid until `expires` (ms). Domain-separated from every other HQ signature. */
export async function signPrefsToken(secret: string, email: string, now = Date.now()): Promise<string> {
  if (!secret) throw new Error('No signing secret configured');
  const expires = Math.floor(now / 1000) + LINK_TTL_HOURS * 3600;
  const payload = `${normalizeEmail(email)}\n${expires}`;
  return `${b64url(encoder.encode(payload))}.${b64url(await hmac(secret, payload))}`;
}

/** The address a token was issued for, or null if it is forged, malformed or expired. */
export async function verifyPrefsToken(secret: string, token: string, now = Date.now()): Promise<string | null> {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let payload: string;
  try { payload = new TextDecoder().decode(fromB64url(body)); } catch { return null; }
  const [email, expires] = payload.split('\n');
  if (!email || !/^\d{10}$/.test(expires ?? '') || Number(expires) < now / 1000) return null;
  const expected = await hmac(secret, payload);
  let given: Uint8Array;
  try { given = fromB64url(sig); } catch { return null; }
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0 ? email : null;
}

export function prefsLink(siteUrl: string, token: string): string {
  return `${new URL('/newsletter', siteUrl).toString()}?t=${encodeURIComponent(token)}`;
}

// ─── Kit ────────────────────────────────────────────────────────────────

type Fetch = typeof fetch;

async function kit(apiKey: string, method: string, path: string, body: unknown, fetchImpl: Fetch) {
  const response = await fetchImpl(`${KIT_API}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { 'X-Kit-Api-Key': apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Kit ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

export interface KitConfig {
  apiKey: string;
  /** The subscriber custom field holding topics (KIT_TOPICS_FIELD, default hq_topics). */
  field?: string;
  /** A Kit form to add new signups to, so Kit's own confirmation email applies (KIT_FORM_ID). */
  formId?: string;
}

/** The subscriber Kit has for an address, or null. */
export async function findKitSubscriber(cfg: KitConfig, email: string, fetchImpl: Fetch = fetch) {
  const q = new URLSearchParams({ email_address: normalizeEmail(email), status: 'all' });
  const result = await kit(cfg.apiKey, 'GET', `/subscribers?${q}`, null, fetchImpl);
  return (result.subscribers ?? [])[0] ?? null;
}

/** The topics Kit holds for a subscriber record (all four when the field is empty). */
export function topicsOf(subscriber: any, field = 'hq_topics'): Topic[] {
  return parseTopics(subscriber?.fields?.[field]);
}

/**
 * Creates or updates the subscriber with their topics, then (for a new
 * signup with KIT_FORM_ID set) adds them to the form, which is what makes
 * Kit send its confirmation email. Kit's v4 create call updates an existing
 * address rather than duplicating it.
 */
export async function saveKitTopics(cfg: KitConfig, email: string, topics: readonly Topic[], { addToForm = false, fetchImpl = fetch as Fetch } = {}) {
  const field = cfg.field || 'hq_topics';
  const address = normalizeEmail(email);
  await kit(cfg.apiKey, 'POST', '/subscribers', { email_address: address, fields: { [field]: formatTopics(topics) } }, fetchImpl);
  if (addToForm && cfg.formId) {
    await kit(cfg.apiKey, 'POST', `/forms/${encodeURIComponent(cfg.formId)}/subscribers`, { email_address: address }, fetchImpl);
  }
}

/** Unsubscribes the address in Kit. True if Kit had it. */
export async function unsubscribeKit(cfg: KitConfig, email: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  const subscriber = await findKitSubscriber(cfg, email, fetchImpl);
  if (!subscriber?.id) return false;
  await kit(cfg.apiKey, 'POST', `/subscribers/${encodeURIComponent(subscriber.id)}/unsubscribe`, {}, fetchImpl);
  return true;
}

/** The email that carries the link. Plain words, no tracking, the link and nothing else to click. */
export function prefsEmail(link: string, newsletterName = 'THE HQ DISPATCH') {
  const text = [
    `Here is your link to choose what ${newsletterName} sends you, or to unsubscribe:`,
    '',
    link,
    '',
    `It works for ${LINK_TTL_HOURS} hours. If you did not ask for it, ignore this email and nothing changes.`,
  ].join('\n');
  const html = `<p>Here is your link to choose what ${newsletterName} sends you, or to unsubscribe:</p><p><a href="${link}">Choose my topics</a></p><p>It works for ${LINK_TTL_HOURS} hours. If you did not ask for it, ignore this email and nothing changes.</p>`;
  return { subject: `Your ${newsletterName} topics`, text, html };
}
