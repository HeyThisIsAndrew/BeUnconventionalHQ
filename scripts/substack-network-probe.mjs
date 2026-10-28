/** Isolated verification of the complete public Substack JSON transport. */
import { renderPublicSubstack, browserTextDocument } from './substack-browser-source.mjs';
export default {
  async fetch(request, env) {
    const results = [];
    for (const endpoint of ['archive', 'posts']) {
      if (results.length) await new Promise(resolve => setTimeout(resolve, 11000));
      const url = `https://beunconventionalhq.substack.com/api/v1/${endpoint}?limit=20&offset=0${endpoint === 'archive' ? '&sort=new' : ''}`;
      const started = Date.now();
      try {
        const html = await renderPublicSubstack(env.BROWSER, url);
        const posts = JSON.parse(browserTextDocument(html));
        results.push({ endpoint, seconds: (Date.now() - started) / 1000, count: posts.length,
          newest: posts.slice(0, 2).map(p => ({ id: p.id, title: p.title, date: p.post_date, canonical: p.canonical_url, tags: p.postTags?.length, body: p.body_html?.length })) });
      } catch (error) { results.push({ endpoint, seconds: (Date.now() - started) / 1000, error: error.message }); }
    }
    return Response.json({ colo: request.cf?.colo, results });
  },
};
