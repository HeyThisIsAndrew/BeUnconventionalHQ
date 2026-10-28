/** Browser fallback for this publication only. No cookies, tokens or arbitrary proxy URLs. */
import { XMLParser } from 'fast-xml-parser';
export const SUBSTACK_PUBLICATION = 'https://beunconventionalhq.substack.com';

export async function renderPublicSubstack(browser, url) {
  const target = new URL(url);
  const api = ['/api/v1/posts', '/api/v1/archive'].includes(target.pathname)
    && target.searchParams.get('limit') === '20'
    && /^(0|[1-9]\d*)$/.test(target.searchParams.get('offset') ?? '')
    && Number(target.searchParams.get('offset')) <= 5000
    && Number(target.searchParams.get('offset')) % 20 === 0
    && [...target.searchParams.keys()].every(key => ['limit', 'offset', 'sort'].includes(key))
    && ['limit', 'offset', 'sort'].every(key => target.searchParams.getAll(key).length <= 1)
    && (!target.searchParams.has('sort') || target.searchParams.get('sort') === 'new');
  if (target.origin !== SUBSTACK_PUBLICATION ||
      !(api || (!target.search && (target.pathname === '/feed' || /^\/p\/[a-z0-9-]+$/.test(target.pathname))))) {
    throw new Error('Browser source only accepts this publication feed and public post paths');
  }
  if (!browser?.quickAction) throw new Error('Substack browser source is not configured');
  const response = await browser.quickAction('content', {
    url: target.toString(),
    rejectResourceTypes: ['image', 'media', 'font', 'stylesheet', 'script'],
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Substack browser source failed: HTTP ${response.status}`);
  let html;
  try {
    const payload = JSON.parse(raw);
    if (payload.success === false) throw new Error('Browser source did not return successful content');
    html = payload.result;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    html = raw;
  }
  if (typeof html !== 'string' || !html.trim()) throw new Error('Browser source returned empty content');
  return html;
}

/** Chrome displays JSON/XML as escaped text in a pre element. Decode once. */
export function browserTextDocument(html) {
  const pre = html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
  if (!pre) return html;
  const value = new XMLParser({ parseTagValue: false }).parse(`<pre>${pre[1]}</pre>`).pre;
  if (typeof value !== 'string') throw new Error('Browser source returned an invalid text document');
  return value;
}
