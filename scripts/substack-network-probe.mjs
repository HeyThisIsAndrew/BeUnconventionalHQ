/** Temporary connectivity diagnostics. Fixed public publication, no credentials. */
export default {
  async fetch(request) {
    const paths = ['/feed', '/api/v1/posts?limit=20&offset=0',
      '/api/v1/archive?sort=new&limit=20&offset=0',
      '/p/dune-part-three-final-trailer-denis'];
    const results = [];
    for (const path of paths) {
      try {
        const response = await fetch(`https://beunconventionalhq.substack.com${path}`, {
          signal: AbortSignal.timeout(20000), redirect: 'manual',
          headers: { Accept: '*/*', 'User-Agent': 'BeUnconventionalHQ-ArticleSync/1.0 (+https://beunconventionalhq.com)' },
        });
        const text = await response.text();
        let posts;
        try { const data = JSON.parse(text); if (Array.isArray(data)) posts = data.slice(0, 2).map(p => ({ title: p.title, tags: p.postTags?.length, body: p.body_html?.length })); } catch {}
        results.push({ path, status: response.status, ray: response.headers.get('cf-ray'), retryAfter: response.headers.get('retry-after'), bytes: text.length, posts });
      } catch (error) { results.push({ path, error: error.message }); }
    }
    return Response.json({ colo: request.cf?.colo, results });
  },
};
