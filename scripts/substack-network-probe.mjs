/** Temporary connectivity diagnostics. Fixed public publication, no credentials. */
import { parsePostHtml } from './substack-post-html.mjs';
import { parseWatchFeed } from './substack-watcher.mjs';
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
    for (const target of ['https://beunconventionalhq.substack.com/feed', 'https://beunconventionalhq.substack.com/p/the-batman-part-ii-why-soderbergh']) try {
      const started = Date.now();
      const response = await env.BROWSER.quickAction('content', {
        url: target,
        rejectResourceTypes: ['image', 'media', 'font', 'stylesheet', 'script'],
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 },
      });
      const raw = await response.text();
      let html = raw;
      try { html = JSON.parse(raw).result ?? raw; } catch {}
      let post;
      try {
        if (target.endsWith('/feed')) { const feed = parseWatchFeed(html.match(/<rss\b[\s\S]*?<\/rss>/i)?.[0] ?? html); post = { count: feed.length, newest: feed[0] }; }
        else { const p = parsePostHtml(html); post = { id: p.id, title: p.title, tags: p.postTags?.length, body: p.body_html?.length }; }
      } catch (error) { post = { error: error.message, prefix: html.slice(0, 150) }; }
      results.push({ target, browser: true, status: response.status, bytes: raw.length, seconds: (Date.now() - started) / 1000, post, error: response.ok ? undefined : raw.slice(0, 300) });
    } catch (error) { results.push({ browser: true, error: error.message }); }
    return Response.json({ colo: request.cf?.colo, results });
  },
};
