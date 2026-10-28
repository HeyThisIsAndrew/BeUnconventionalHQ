/** The real source class in an isolated, ephemeral Worker. No Cron, gateway or email bindings. */
import { ArticleSource } from './substack-relay.mjs';
const values = new Map();
const state = { storage: {
  get: async key => values.get(key), put: async (key, value) => { values.set(key, value); },
  list: async ({ prefix }) => new Map([...values].filter(([key]) => key.startsWith(prefix))),
  delete: async keys => { for (const key of keys) values.delete(key); },
} };
let source;
export default {
  async fetch(request, env) {
    source ??= new ArticleSource(state, { BROWSER: env.BROWSER });
    const url = new URL(request.url);
    if (url.pathname === '/poll') return Response.json(await source.poll({ dryRun: true }));
    if (url.pathname !== '/posts') return new Response('Not found', { status: 404 });
    return source.fetch(new Request(`https://article-source.internal/posts${url.search}`));
  },
};
