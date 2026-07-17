# Live-Status Endpoint — Operator Guide (issue #20)

`GET /api/live-status.json` answers one question: **is the channel live right
now?** It powers the Takeover Billboard (homepage transforms when a stream
starts).

## Architecture

```
platform adapters (src/lib/platforms/youtube.ts, twitch.ts…)
    └── LiveStatusProvider seam        src/lib/live-status.ts
            └── checkLiveStatus()      parallel, error-isolated aggregation
                    └── endpoint       src/pages/api/live-status.json.ts (edge, on-demand)
                            └── frontend consumer (Takeover Billboard — not built yet)
```

- The site stays fully static; only this route runs per-request
  (`prerender = false`). Astro 5+ folded the old `output: 'hybrid'` into
  `static`, so **no global config change was needed** — the Cloudflare adapter
  emits a worker for just this route.
- Providers are error-isolated: one platform failing (quota, outage, bad key)
  can never mask another platform being live. Failures come back as data in
  `errors[]`.

## Response shape

```json
{
  "isLive": true,
  "streams": [
    {
      "platform": "youtube",
      "videoId": "abc123",
      "title": "SDCC Live Show",
      "url": "https://www.youtube.com/watch?v=abc123"
    }
  ],
  "errors": [],
  "checkedAt": "2026-07-17T18:00:00.000Z"
}
```

The endpoint never 500s for expected conditions. Before credentials are
configured it returns `isLive: false` with
`errors: [{ platform: "youtube", message: "not_configured" }]`.

## Deployment: Pages → Workers migration (REQUIRED — root cause of the /api 404)

Confirmed 2026-07-17 (epic #24): production returned 404 on
`/api/live-status.json` because the site deploys via a **Cloudflare Pages**
project, which serves only the static `dist/client` half of the build.
`@astrojs/cloudflare` v13 (required by Astro 6) targets **Cloudflare Workers**
— it emits `dist/server` (worker + generated `wrangler.json` with an assets
binding to `../client`), and Pages never looks at it. There is no Pages mode
on this adapter line, so the fix is a one-time project migration:

1. **Cloudflare dash → Workers & Pages → Create → Workers → Connect to Git**
   (Workers Builds) → select this repo, `main` branch.
2. Build command: `npm run build` · Deploy command: `npm run deploy`
   (which runs `npx wrangler deploy --config dist/server/wrangler.json`).
3. **Env vars**: add `YOUTUBE_API_KEY` (encrypt) on the new Worker
   (Settings → Variables and Secrets). `YOUTUBE_CHANNEL_ID` optional.
4. **If the first deploy errors on the SESSION KV binding** ("kv_namespaces
   requires an id"): Astro's session driver expects a KV namespace. Either
   create one (`Workers KV → Create namespace`, e.g.
   `beunconventionalhq-sessions`) and add a root `wrangler.jsonc` with
   `{ "name": "beunconventionalhq", "kv_namespaces": [{ "binding": "SESSION",
   "id": "<paste id>" }] }` — the build merges it into the generated config —
   or skip if the deploy succeeds without it (newer wrangler can provision).
5. **Custom domain**: remove `beunconventionalhq.com` (+ www) from the Pages
   project, then add them on the Worker (Settings → Domains & Routes).
6. **Keep the Pages project paused** (disable automatic deployments) as
   rollback for a week, then delete it.
7. Verify: `/api/live-status.json` returns JSON (`not_configured` before the
   key, real status after). `_headers`/`_redirects` in `dist/client` are
   honored by Workers static assets, so the security headers carry over.

GitHub Actions CI is unaffected; the "Cloudflare Pages" PR check is replaced
by a Workers Builds check.

## Credentials (required before it goes live)

| Variable | Where | Notes |
|---|---|---|
| `YOUTUBE_API_KEY` | Cloudflare Pages → Settings → Environment variables (encrypt) | Google Cloud → YouTube Data API v3 key. Same key the sync script uses. |
| `YOUTUBE_CHANNEL_ID` | optional | Defaults to the HQ channel (`UCXqU6781pQgYXDExLvMw2Og`). |

For local `astro dev`, put them in `.env`.

## Quota math (why the cache policy is what it is)

Live detection uses `search.list` = **100 units/call** against the free
**10,000 units/day** — a hard ceiling of ~100 checks/day.

The CDN is the rate limiter, not application code:

- `s-maxage=900` → Cloudflare hits this endpoint at most ~96×/day
  (~9,600 units worst case, inside quota even with the daily sync running).
- `max-age=0` → browsers always revalidate against the edge; no stale tabs.
- `stale-while-revalidate=300` → visitors get instant answers while the edge
  refreshes in the background.

Trade-off: "going live" appears on the site within ≤15 minutes. To tighten
that later without quota risk, add a 0-quota presence signal (e.g. the
`canlive` scrape or RSS heuristic) as a cheap pre-check gating the expensive
`search.list` call.

## Twitch (built — activate with credentials)

The Twitch adapter (`src/lib/platforms/twitch.ts`, app-token auth with lazy
caching) and provider are implemented and tested. The endpoint includes
Twitch in the live check **only when all three vars exist** — fully inert
otherwise:

| Variable | Where |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | dev.twitch.tv → register an application. Worker env (encrypt the secret). |
| `TWITCH_CHANNEL_LOGIN` | the channel's login name (the twitch.tv/<login> part) |

No quota economics like YouTube's — Helix limits are per-minute buckets; the
CDN cache stays the effective rate limiter. Simulcasts return both platforms
in `streams[]`; the billboard prefers the YouTube entry.

Adding any further platform stays the same recipe: adapter in
`src/lib/platforms/`, a `create<X>LiveProvider()` wrapper, one conditional
push in the endpoint.

## Tests

```
node scripts/live-status.test.mjs
```

Offline (stubbed fetch), covers: live/offline mapping, aggregation, error
isolation, quota-failure surfacing, simulcast.
