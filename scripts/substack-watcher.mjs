import { XMLParser } from 'fast-xml-parser';
import { signAutomationRequest } from '../src/lib/automation-auth.mjs';

const FEED = 'https://beunconventionalhq.substack.com/feed';
const STATE_KEY = 'watcher:published:v1';
const ALERT_KEY = 'watcher:last-alert:v1';

/** The public archive avoids RSS CDN delays; keep the existing canonical GUIDs. */
export function watchArticlesFromPosts(posts) {
  if (!Array.isArray(posts) || !posts.length) throw new Error('Substack archive returned no articles');
  return posts.map(post => {
    const url = new URL(post.canonical_url);
    if (url.origin !== 'https://beunconventionalhq.substack.com' || !url.pathname.startsWith('/p/') ||
        typeof post.title !== 'string' || !post.title.trim() || !Number.isFinite(Date.parse(post.post_date))) {
      throw new Error('Incomplete article metadata in Substack archive');
    }
    return { guid: url.toString(), title: post.title.trim(), url: url.toString(), publishedAt: new Date(post.post_date).toISOString() };
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function parseWatchFeed(xml) {
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const items = doc.rss?.channel?.item;
  const list = items ? (Array.isArray(items) ? items : [items]) : [];
  if (!list.length) throw new Error('Substack RSS returned no articles');
  return list.map(item => {
    const url = new URL(item.link);
    const guid = typeof item.guid === 'object' ? item.guid['#text'] : item.guid;
    if (url.origin !== 'https://beunconventionalhq.substack.com' || !url.pathname.startsWith('/p/') ||
        typeof item.title !== 'string' || !item.title.trim() || !Number.isFinite(Date.parse(item.pubDate))) {
      throw new Error('Incomplete article metadata in RSS');
    }
    return { guid: String(guid || url.toString()), title: item.title.trim(), url: url.toString(), publishedAt: new Date(item.pubDate).toISOString() };
  });
}

export async function callGateway(env, payload) {
  if (!env.WEBSUB_SECRET || !env.HQ_SITE) throw new Error('Automation gateway is not configured');
  const body = JSON.stringify(payload);
  const response = await env.HQ_SITE.fetch(new Request('https://beunconventionalhq.com/api/automation', {
    method: 'POST', headers: await signAutomationRequest(env.WEBSUB_SECRET, body), body,
    signal: AbortSignal.timeout(25000),
  }));
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try { reason += `: ${(await response.json()).error}`; } catch { /* no HTML in logs */ }
    throw new Error(`Automation gateway failed: ${reason}`);
  }
  return response.json();
}

/** Pure orchestration with injected storage/network. Scheduled ticks coalesce in the object. */
export async function watchSubstack({
  storage, requestFeed, requestArticles, refreshSource, dispatch, notify,
  now = Date.now(), dryRun = false, forceFailure = false,
}) {
  try {
    if (forceFailure) throw new Error('Intentional watcher failure test. No content was changed.');
    const articles = requestArticles ? await requestArticles() : parseWatchFeed(await requestFeed(FEED));
    const previous = await storage.get(STATE_KEY);
    if (!previous) {
      if (!dryRun) await storage.put(STATE_KEY, { seen: articles.map(a => a.guid), seededAt: now });
      return { ok: true, action: dryRun ? 'would-seed' : 'seeded', count: articles.length };
    }
    const seen = new Set(previous.seen);
    const fresh = articles.filter(article => !seen.has(article.guid));
    if (!fresh.length) return { ok: true, action: 'unchanged', count: articles.length };
    if (dryRun) return { ok: true, action: 'would-dispatch', articles: fresh };
    // Publishing must not hit a five-minute cached snapshot from BEFORE the
    // new article appeared. Warm the complete payload before firing GitHub.
    await refreshSource();
    await dispatch(fresh.slice(0, 20)); // One event imports the whole feed; keep metadata bounded.
    await storage.put(STATE_KEY, {
      ...previous, seen: [...new Set([...articles.map(a => a.guid), ...previous.seen])].slice(0, 500),
      lastDispatchedAt: now, lastDispatchedGuids: fresh.map(a => a.guid),
    });
    return { ok: true, action: 'dispatched', articles: fresh };
  } catch (error) {
    let alerted = false;
    let alertError;
    if (!dryRun) {
      try {
        let previous;
        try { previous = await storage.get(ALERT_KEY); } catch { /* storage outages still need alerts */ }
        if (!previous || previous.message !== error.message || now - previous.at >= 3600000) {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(error.message)))].slice(0, 6).map(n => n.toString(16).padStart(2, '0')).join('');
          await notify({
            message: error.message, incidentId: `substack-${Math.floor(now / 3600000)}-${hash}`,
            test: forceFailure,
          });
          alerted = true;
          try { await storage.put(ALERT_KEY, { message: error.message, at: now }); } catch { /* alert was delivered despite a storage outage */ }
        }
      } catch (notificationError) { alertError = notificationError.message; }
    }
    return { ok: false, error: error.message, alerted, ...(alertError ? { alertError } : {}) };
  }
}
