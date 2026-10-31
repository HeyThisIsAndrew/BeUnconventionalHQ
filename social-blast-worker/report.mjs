/**
 * The run report: one email per run that did anything, sent through Resend.
 * It carries three things, so the owner has one place to look:
 *   - what went live (with links to the posts) or failed;
 *   - in dry-run, the exact text each platform WOULD have posted;
 *   - the ready-to-post drafts for X and YouTube Community (issue #284),
 *     each with a one-tap link that opens the composer.
 */

const PLATFORM_NAMES = {
  bluesky: 'Bluesky', threads: 'Threads', facebook: 'Facebook Page', x: 'X', youtube: 'YouTube Community',
};

const STATUS_LABELS = {
  posted: 'Posted',
  previewed: 'Dry run (not posted)',
  drafted: 'Draft, ready to post',
  blocked: 'Blocked',
  'not-configured': 'Live, but credentials are missing',
  failed: 'Failed, will retry',
  'failed-final': 'Failed, gave up',
  unknown: 'Unknown, check the platform by hand',
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function isProblem(result) {
  return ['blocked', 'not-configured', 'failed', 'failed-final', 'unknown'].includes(result.status);
}

function composeLink(platform, result, env) {
  if (platform === 'x' && result.text) return { href: `https://x.com/intent/post?text=${encodeURIComponent(result.text)}`, label: 'Open in X' };
  if (platform === 'youtube' && env.YOUTUBE_COMMUNITY_URL) return { href: env.YOUTUBE_COMMUNITY_URL, label: 'Open YouTube Community' };
  return null;
}

/**
 * entries: [{ item, type, skipped?, results: { platform: result } }]
 * Returns { subject, text, html, problems }.
 */
export function buildReport(entries, env, { inspect = false } = {}) {
  const brand = env.BRAND_NAME || 'Site';
  const stories = entries.filter((e) => !e.skipped);
  const problems = entries.reduce((n, e) => n + Object.values(e.results ?? {}).filter(isProblem).length, 0);
  const live = String(env.LIVE_PLATFORMS ?? '').trim();
  const head = stories.length
    ? `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`
    : `${entries.length} skipped`;
  const subject = `${brand} social: ${head}${problems ? `, ${problems} need${problems === 1 ? 's' : ''} attention` : ''}${live ? '' : ' (dry run)'}`;

  const text = [];
  const html = [`<div style="font-family:system-ui,sans-serif;max-width:640px">`];
  if (!live) {
    const note = 'Dry run: nothing was posted. Live platforms are switched on with LIVE_PLATFORMS (see scripts/social-blast.md).';
    text.push(note, '');
    html.push(`<p style="background:#fff4d6;padding:8px 12px;border-radius:6px">${esc(note)}</p>`);
  }
  if (inspect) {
    text.push('Inspection only: no state was saved and nothing was sent.', '');
  }
  for (const entry of entries) {
    const { item } = entry;
    text.push(`## ${item.title}`, item.link, `Type: ${entry.type ?? 'n/a'}`);
    html.push(`<h2 style="margin:24px 0 4px">${esc(item.title)}</h2>`,
      `<p style="margin:0 0 12px"><a href="${esc(item.link)}">${esc(item.link)}</a><br>Template set: ${esc(entry.type ?? 'n/a')}</p>`);
    if (entry.skipped) {
      text.push(`Skipped: ${entry.skipped}`, '');
      html.push(`<p>Skipped: ${esc(entry.skipped)}</p>`);
      continue;
    }
    for (const [platform, result] of Object.entries(entry.results)) {
      const name = PLATFORM_NAMES[platform] ?? platform;
      const label = STATUS_LABELS[result.status] ?? result.status;
      const detail = result.error || result.reason || '';
      text.push(`- ${name}: ${label}${result.templateId ? ` [${result.templateId}]` : ''}${detail ? `: ${detail}` : ''}${result.url ? ` ${result.url}` : ''}`);
      if (result.text) text.push(...result.text.split('\n').map((l) => `    ${l}`));
      const link = composeLink(platform, result, env);
      if (link && result.status === 'drafted') text.push(`    ${link.label}: ${link.href}`);
      html.push(`<div style="border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:8px 0">`,
        `<strong>${esc(name)}</strong>: ${esc(label)}${result.templateId ? ` <small style="color:#888">${esc(result.templateId)}</small>` : ''}`,
        detail ? `<div style="color:#b00020">${esc(detail)}</div>` : '',
        result.url ? `<div><a href="${esc(result.url)}">View post</a></div>` : '',
        result.text ? `<pre style="white-space:pre-wrap;background:#f6f6f6;padding:8px;border-radius:4px;font:14px/1.4 system-ui,sans-serif;user-select:all">${esc(result.text)}</pre>` : '',
        link && result.status === 'drafted' ? `<a href="${esc(link.href)}" style="display:inline-block;padding:6px 12px;background:#111;color:#fff;border-radius:4px;text-decoration:none">${esc(link.label)}</a>` : '',
        `</div>`);
    }
    text.push('');
  }
  html.push('</div>');
  return { subject, text: text.join('\n'), html: html.join('\n'), problems };
}

/** Sends one report. Idempotent on `key`, so a retried send never doubles. */
export async function sendEmail(env, { subject, text, html, key }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL || !env.ALERT_FROM) {
    throw new Error('Report email is not configured (RESEND_API_KEY, ALERT_EMAIL, ALERT_FROM)');
  }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `social-blast-${key}`,
    },
    body: JSON.stringify({ from: env.ALERT_FROM, to: env.ALERT_EMAIL, subject, text, html }),
  });
  if (!response.ok) throw new Error(`Report email failed: HTTP ${response.status}`);
}
