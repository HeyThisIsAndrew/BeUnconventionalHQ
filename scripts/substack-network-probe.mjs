/** Temporary connectivity diagnostics. Fixed public publication, no credentials. */
import { parsePostHtml } from './substack-post-html.mjs';
export default {
  async fetch(request, env) {
    const paths = ['https://beunconventionalhq.substack.com/feed'];
    const results = [];
    for (const path of paths) {
      try {
        const response = await fetch(path, {
          signal: AbortSignal.timeout(20000), redirect: 'manual',
          headers: { Accept: '*/*', 'User-Agent': 'BeUnconventionalHQ-ArticleSync/1.0 (+https://beunconventionalhq.com)' },
        });
        const text = await response.text();
        let posts;
        try { const data = JSON.parse(text); if (Array.isArray(data)) posts = data.slice(0, 2).map(p => ({ title: p.title, tags: p.postTags?.length, body: p.body_html?.length })); } catch {}
        if (response.ok && path.includes('/home/post/')) {
          try { const post = parsePostHtml(text); posts = [{ id: post.id, title: post.title, tags: post.postTags?.length, body: post.body_html?.length }]; } catch (error) { posts = [{ error: error.message }]; }
        }
        results.push({ path, status: response.status, ray: response.headers.get('cf-ray'), retryAfter: response.headers.get('retry-after'), bytes: text.length, posts });
      } catch (error) { results.push({ path, error: error.message }); }
    }
    try {
      const started = Date.now();
      const response = await env.BROWSER.quickAction('content', {
        url: 'https://beunconventionalhq.substack.com/p/dune-part-three-final-trailer-denis',
        rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 },
      });
      const raw = await response.text();
      let html = raw;
      try { html = JSON.parse(raw).result ?? raw; } catch {}
      let post;
      try { const p = parsePostHtml(html); post = { id: p.id, title: p.title, tags: p.postTags?.length, body: p.body_html?.length }; } catch (error) { post = { error: error.message }; }
      results.push({ browser: true, status: response.status, bytes: raw.length, seconds: (Date.now() - started) / 1000, post, error: response.ok ? undefined : raw.slice(0, 300) });
    } catch (error) { results.push({ browser: true, error: error.message }); }
    return Response.json({ colo: request.cf?.colo, results });
  },
};
