# Be Unconventional HQ — agent guide

Cinematic entertainment-media site. Astro 7 (static output + `@astrojs/cloudflare`),
Tailwind v4 (via `@tailwindcss/vite`). Video/short/live/event/featuredBrand content
is a local JSON store (`src/data/videos.json`) — see "Data flow" below for the
architecture pivot away from Sanity as the runtime data source. Deployed on Cloudflare.

## Commands

- `npm test` — offline unit suites (no network/credentials): events date helpers,
  live-status, video merge, taxonomy sync. Run before committing lib changes.
- `npm run build` — production build. Fully offline: video/short/live/event/
  featuredBrand data is bundled from `src/data/videos.json` at build time, no
  network fetch involved. (Article syncs from Substack's posts API can still fail
  offline; those pages try/catch to empty data by design, so the build still
  proves compilation.)
- `npx astro check` — type check. The bar is: introduce zero NEW errors (baseline
  is 0/0/0 as of the Astro 7 migration — CI will show any new count directly).
- `npm run dev` — refreshes the content cache, then dev server.
- `npm run deploy` — wrangler deploy of the built worker (`dist/server`).
  Production target is **Cloudflare Workers** (git-connected Workers Builds),
  NOT Pages — Pages serves only `dist/client` and 404s every `/api/*` route
  (@astrojs/cloudflare v13 is Workers-only). Runbook: `scripts/live-status.md`.

## Hard rules (learned the expensive way)

1. **Calendar dates are `YYYY-MM-DD` strings.** Never `new Date("YYYY-MM-DD")` —
   it UTC-shifts to the prior day west of Greenwich. Use `src/lib/events.ts`
   (`parseEventDateToLocal`, `toYMD`, `getEventStatus`, `formatEventDateRange`).
   Compare dates as same-precision strings. `scripts/events.test.mjs` guards this.
2. **HeroTrailer.astro is protected.** It encodes iOS Safari iframe, YouTube
   playback, rotation, and WebKit compositing fixes. Do not rewrite it, change
   its lifecycle, conditionally mount/unmount, or duplicate it per breakpoint.
   Accepted behavior: the trailer restarts on rotation (continuity was tested
   and is impossible without a full jsapi redesign — see issue #18).
3. **No `overflow: hidden` on any ancestor of a YouTube iframe** — iOS Safari
   renders the iframe as a black box. Isolate clipping to sibling background
   wrappers (see `.event-hero-bg-wrapper` in the `[slug]` pages).
4. **Never assign an iframe `src = ''`** — it resolves to the current page URL
   and silently reloads the site inside the iframe. Use `'about:blank'`.
5. **`videos.json` docs have THREE field classes** (epic #34, pivoted off Sanity):
   FACTUAL (YouTube facts — synced every run), DERIVED (topics/hubs/requiresReview
   — recomputed from YouTube tags every run UNLESS `manualTaxonomyOverride` is on:
   the Sync Lock), EDITORIAL (featured, notes, … — seeded once, never overwritten).
   Clean Tier-1 tag matches auto-publish; the sync never demotes a status a human
   set. Topic keywords are hardcoded seeds (`TIER1_TOPIC_SEEDS` in
   `scripts/sync-youtube.mjs` — Tier-1 categories are fixed, not editor-managed).
   Hub keywords (`youtubeSyncKeywords` on `event`/`featuredBrand` docs) are read
   from `src/data/videos.json` itself (`extractHubSeeds()`) — this is the local
   equivalent of the old "build the dictionary FROM SANITY every run"; still
   never hardcode hub keywords in the script. `scripts/sync-youtube.mjs` is
   dry-run by default — pass `--execute` to write.
6. **No `filter: drop-shadow` on `<img>`** — known iOS Safari rendering bugs.
7. **Rearrange layouts with responsive CSS / grid areas, not JS reordering or
   duplicated per-breakpoint markup.**

## Data flow

**Architecture pivot (in progress):** video/short/live/event/featuredBrand content
moved from Sanity (live GROQ queries) to a local JSON store, `src/data/videos.json`
— a statically-imported bundle, not a runtime fetch, so pages render real content
with zero network access. `scripts/sync-youtube.mjs` is the YouTube → local JSON
sync (see hard rule 5). Sanity is still used for two things: image hosting (event/
featuredBrand `logo`/`heroImage` are real Sanity asset references; `urlFor()` in
`src/lib/local-content.ts` builds `cdn.sanity.io` URLs from a static
`{projectId, dataset}` config — no live client needed) and the Studio at `/admin`.

- **Videos/shorts/live:** pages call `getVideosUnified()` / `getShortsUnified()` /
  `getLiveStreamsUnified()` (`src/lib/videos-source.ts`) — filters
  `src/data/videos.json` through the same merge logic (`src/lib/videos.ts`) that
  used to run against Sanity. The legacy RSS/scrape cache
  (`src/data/cache/videos.json`, refreshed by `scripts/fetch-feeds.mjs`) is no
  longer part of this merge.
- **Articles:** Substack's internal `/api/v1/posts` JSON endpoint via
  `scripts/sync-articles.mjs` (no Sanity schema ever). Replaced the public `/feed`
  RSS source because RSS's `<category>` element drops most of a post's tags —
  the JSON API's `postTags` carries the full set, which the category/content-type
  mapping and "More From" related-article matching both depend on. Same
  never-delete merge contract as the RSS era (`mergeSnapshot()` in
  `src/lib/articles-transform.ts`); only the fetch and raw-shape mapping changed.
  Undocumented endpoint, so treat it like the YouTube sync's Sync Lock: loud,
  non-fatal failures only — a broken/blocked endpoint must never blank
  `src/data/articles.json`.
- **Events / featured brands:** `getEventsLocal()` / `getFeaturedBrandsLocal()`
  (`src/lib/local-content.ts`), filtering `src/data/videos.json` by `_type`. CLS-
  prevention image dimensions are parsed from the Sanity asset `_ref`'s own
  `image-<hash>-<W>x<H>-<ext>` naming convention, not a GROQ `asset->metadata`
  dereference. "Hub coverage" (videos tagged to a specific event/brand) matches
  `video.hubs` (slugs) against `event.slug.current` / `brand.slug.current` — hubs
  are slugs in the local sync, not Sanity `_id` references, so this replaces the
  old `references($hubId)` GROQ query, it isn't a shortcut around it.
  LocalCmsApp creates *and* edits `event`/`featuredBrand` docs (the "New
  Featured" / "New event" buttons) — the old "no local flow to create one"
  gap is closed. Hubs still carry Sanity asset refs for `logo`/`heroImage`
  from the original export; new ones upload through the CMS instead.
  A `featuredBrand` owns everything /featured renders about it:
  `hubCategory` (which accordion row it sits in), `brandColor.hex` (its glow,
  row tint and button — the RGB triple is derived from this, never stored),
  `description` (the line under the logo), `backdrops` (optional stills for
  the cross-fading backdrop) and `youtubeSyncKeywords`. None of
  these are hardcoded in `src/pages/featured/index.astro` any more; adding a
  hub is a data edit. Adding a *category* is still a code change, by design —
  the four rows are a design decision, not editor content.
- **Hub backdrops:** `getHubBackdrops()` (`src/lib/local-content.ts`) feeds the
  cross-fading plate behind /featured and behind each hub hero. It falls
  through four sources — the hub's own `backdrops`, thumbnails of videos tagged
  to it, videos matching its `youtubeSyncKeywords`, then videos in its category
  — and tags each result with a `tier` saying how honestly it belongs to that
  hub. **Every backdrop is blurred**, harder the further down that list it came
  from, so borrowed footage can never read as a claim of coverage. That is also
  why they are always the SMALL image (`mqdefault`, ~10kB, not
  `maxresdefault`, ~150kB): behind a blur, resolution buys nothing. Never raise
  the source size without removing the blur, and vice versa —
  `scripts/featured-containment.test.mjs` guards the pair. The YouTube trailer
  is a desktop-only layer over this plate; it is never loaded on the compact
  layout (~900kB of player JS) and its own chrome is cropped out rather than
  configured away, because it cannot be configured away.
- **Local CMS:** `/local-cms` (dev-only route, `src/components/admin/LocalCmsApp.tsx`)
  — master/detail editor over `src/data/videos.json`, backed by a dev-server-only
  Vite middleware (`localCmsMiddleware` in `astro.config.mjs`) at
  `/api/local-cms/videos` (GET reads the file, POST overwrites it). Never present
  in the production build — `configureServer` doesn't run for `astro build`.
- **Video IDs:** always `parseVideoId()` from `src/lib/platforms/youtube.ts` —
  never inline regex or URL parsing.
- **Live status:** `/api/live-status.json` (on-demand edge route,
  `prerender = false`) → `src/lib/live-status.ts` providers. The CDN cache is
  the YouTube quota gate (search.list = 100 units). See `scripts/live-status.md`.

## Conventions

- `docs/` is **gitignored** — put operator docs in `scripts/*.md`.
- Offline test suites live in `scripts/*.test.mjs`, run by plain `node`
  (Node 22 native type-stripping; src/lib imports use explicit `.ts`
  extensions — `allowImportingTsExtensions` is on).
- WIP/utility routes are gated three ways: `noindex` prop on `<Layout>`,
  sitemap filter in `astro.config.mjs`, robots.txt. Currently gated:
  `/events-new` (WIP, promotes to `/events` later), `/links` (bio-only,
  deliberately NOT robots-blocked so crawlers can read its noindex),
  `/admin` (Sanity Studio, header-gated via `public/_headers`), `/local-cms`
  (Local CMS, dev-only — shows a static "Restricted Access" message in prod).
- The muted-grey text palette is a deliberate design trade-off; don't "fix" it
  without the owner. It does NOT, however, fail WCAG the way this note used to
  claim: an automated pass over six routes found zero failures at rest.
  `--color-white-muted` (#888888) on `--color-surface` (#111111) is 5.33:1 and
  `--color-accent-text` (#ef4444) is 5.02:1, both clearing AA. The one token
  that genuinely fails is `--color-accent` (#cc0000) at 3.21:1: it is a border
  and glow colour only, never a text or icon colour. Use `--color-accent-text`
  when red needs to be legible.
- `.sr-only` is global (`src/styles/global-base.css`). Card grids under an h1
  get a structural sr-only `<h2>`.
- Secrets: never committed; see `.env.example`. The sync script requires
  `--execute` to write (dry-run default).
