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

## Adding Twitch (or any platform) later

1. Build `src/lib/platforms/twitch.ts` (adapter, same pattern as youtube.ts).
2. Add `createTwitchLiveProvider()` in `src/lib/live-status.ts` wrapping it.
3. Append it to the providers array in the endpoint. Done — aggregation,
   error isolation, and the response shape already handle N providers
   (simulcasts return multiple `streams[]`).

## Tests

```
node scripts/live-status.test.mjs
```

Offline (stubbed fetch), covers: live/offline mapping, aggregation, error
isolation, quota-failure surfacing, simulcast.
