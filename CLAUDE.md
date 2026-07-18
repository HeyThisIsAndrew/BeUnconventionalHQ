# Be Unconventional HQ — agent guide

Cinematic entertainment-media site. Astro 6 (static output + `@astrojs/cloudflare`),
Tailwind v4 (via `@tailwindcss/vite`), Sanity CMS (`sanity:client` virtual module),
GROQ. Deployed on Cloudflare.

## Commands

- `npm test` — offline unit suites (no network/credentials): events date helpers,
  live-status, video merge. Run before committing lib changes.
- `npm run build` — production build. Sanity fetches may fail offline; pages
  try/catch to empty data by design, so the build still proves compilation.
- `npx astro check` — type check. **~65 pre-existing errors** live in untouched
  files (DOM typing in inline scripts). The bar is: introduce zero NEW errors.
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
5. **Sanity `video` docs have THREE field classes** (epic #34): FACTUAL (YouTube
   facts — synced every run), DERIVED (topics/hubs/requiresReview — recomputed
   from YouTube tags every run UNLESS `manualTaxonomyOverride` is on: the Sync
   Lock), EDITORIAL (featured, notes, … — seeded once, never overwritten).
   Clean Tier-1 tag matches auto-publish; the sync never demotes a status a
   human set. Taxonomy keywords live IN SANITY (`youtubeSyncKeywords` on
   topic/featuredBrand/event) — never hardcode them in scripts.
6. **No `filter: drop-shadow` on `<img>`** — known iOS Safari rendering bugs.
7. **Rearrange layouts with responsive CSS / grid areas, not JS reordering or
   duplicated per-breakpoint markup.**

## Data flow

- **Videos:** pages call `getVideosUnified()` (`src/lib/videos-source.ts`) —
  Sanity `video` docs (published only) merged over the legacy RSS/scrape cache
  (`src/data/cache/videos.json`, refreshed by `scripts/fetch-feeds.mjs`).
  Sanity wins on id collision; Sanity failure degrades to legacy.
- **Articles:** Substack RSS via `getArticles()` (no Sanity schema yet).
- **Events / featured brands:** Sanity via GROQ in the page frontmatter.
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
  `/admin` (Sanity Studio, header-gated via `public/_headers`).
- The muted-grey text palette fails WCAG contrast in places — that is a known,
  deliberate design trade-off; don't "fix" it without the owner.
- `.sr-only` is global (`src/styles/global-base.css`). Card grids under an h1
  get a structural sr-only `<h2>`.
- Secrets: never committed; see `.env.example`. The sync script requires
  `--execute` to write (dry-run default).
