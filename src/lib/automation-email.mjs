/**
 * Owner notifications for the Cloudflare automation Workers (social
 * distribution, Kit drafts), sent through Resend. Idempotent on `key`, so a
 * retried send never doubles. Brand-neutral: the addresses come from the
 * Worker's own vars (issue #286).
 */
export async function sendOwnerEmail(env, { subject, text, html, key }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL || !env.ALERT_FROM) {
    throw new Error('Owner email is not configured (RESEND_API_KEY, ALERT_EMAIL, ALERT_FROM)');
  }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ from: env.ALERT_FROM, to: env.ALERT_EMAIL, subject, text, html }),
  });
  if (!response.ok) throw new Error(`Owner email failed: HTTP ${response.status}`);
}
