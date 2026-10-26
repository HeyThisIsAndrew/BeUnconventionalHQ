/** Send independently of the website/GitHub gateway, so their outages alert too. */
export async function sendFailureEmail(env, alert, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) throw new Error('Failure email is not configured');
  const result = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `hq-watcher-${alert.incidentId}`,
    },
    body: JSON.stringify({
      from: 'noreply@beunconventionalhq.com', to: 'andrew@beunconventionalhq.com',
      subject: alert.test === true ? 'HQ automation: test failure alert' : 'HQ automation: article watcher failed',
      text: `${alert.message}\n\nThe saved article archive is preserved. The watcher retries on its next five-minute run.\nhttps://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/workflows/sync-articles.yml`,
    }),
  });
  if (!result.ok) throw new Error(`Failure email delivery failed: HTTP ${result.status}`);
  return { ok: true, channel: 'email' };
}
