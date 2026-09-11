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
8. **See `scripts/astro-declined-features.md`** for why incremental builds, LQIP placeholders, and the Sanity content loader are explicitly declined. Do not re-propose them.

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
- **Coverage matching is ONE function**, `collectHubCoverage()` in
  `src/lib/hub-coverage.ts`, shared by `/featured/[slug]` and `/events/[slug]`.
  Videos come from `video.hubs` when anything is hub-tagged, and fall back to
  exact NORMALIZED tag matching otherwise; articles have no `hubs` field (they
  sync from Substack) so they are always tag-matched. Never substring-match:
  the event page used to, and it returned zero articles for all 19 events
  while looking like the events simply had no coverage. Shorts and live
  streams are excluded at each CALL SITE, not inside the matcher, so the
  decision stays visible — and so an event page and its overflow feed derive
  the identical list.
  **There is ONE tag list per hub: `youtubeSyncKeywords`, labelled "Tags" in
  the CMS.** There used to be two — a `coverageTags` the site read and a
  `youtubeSyncKeywords` the sync read — and keeping them in step meant
  copy-pasting the same list into two boxes, which is how they drifted. They
  are merged. The one list feeds both `extractHubSeeds()` during the YouTube
  sync AND `getHubMatchTags()` when the site matches articles, so a tag added
  for one purpose serves the other. `getHubMatchTags()` still reads a
  `coverageTags` if it finds one, purely so an un-migrated document does not
  silently lose its coverage; no document in the store carries the field and
  `scripts/event-coverage.test.mjs` fails if one reappears.
- **Tags compare with their spaces closed up** (`compactTag`), so
  "SDCC 2026", "SDCC2026" and "sdcc-2026" are one tag. That is a strict
  widening of exact matching, not a step back toward substrings: "marvel"
  and "marvelstudios" are still different. **The YEAR is what separates one
  edition from the next** — "SDCC 2026" never matches "SDCC 2027" — so every
  recurring event's tags must name its year, in either the four-digit form
  ("pax west 2026") or the two-digit one ("paxwest26") the channel and
  attendees actually write. `scripts/event-coverage.test.mjs` fails if a
  seeded non-premiere event carries a tag naming neither, which is what a
  bare "pax" would be: a tag that claims every edition there has ever been.
- **`excludeCoverage` is the override**, listing article slugs/guids, YouTube
  ids or `_id`s to drop from a hub whatever the tags say. It exists for the
  one case tagging cannot settle: a retrospective, where a post about SDCC
  written in 2027 could be about either edition. **Do not infer the edition
  from the publish date.** It reads plausibly and gets retrospectives
  backwards silently, and wrong coverage on an event page is worse than none
  because nobody notices it. Exclusions apply to hub-TAGGED videos too, so an
  editor never has to know which code path put an item on the page.
- **Event pages cap coverage at six** (`COVERAGE_PAGE_LIMIT`) and overflow to
  `/events/<slug>/coverage`, paginated at 12 — the same display-cap-plus-
  overflow-route pattern "Past Event Archive" uses on `/events`. The overflow
  route builds only for events that have coverage.
- **The "Official <X> Hub" card is `HubCard.astro`**, used by the event
  template AND the article rail. Its heading comes from the hub's own
  `hubCategory` via `getHubKindHeading()` in `src/lib/hub-labels.ts`
  (Franchise / Streamer / Studio / Gaming, falling back to a bare "Official
  Hub"). It was hardcoded as "Official Franchise Hub", which called Netflix a
  franchise. `gaming` is **"Gaming"**, not "Game": the labels are written out
  rather than de-pluralised because that is the one case chopping an "s"
  gets wrong. `hub-labels.ts` is separate from `local-content.ts` because the
  latter statically imports `videos.json`, which plain `node` refuses without
  a type attribute, so the labels were untestable there.
- **An event is TOLD its hub, an article infers one.** Events carry
  `relatedBrandSlug` (editorial, set in the CMS). Articles sync from Substack
  and have no such field, so `findHubForItem()` (`hub-coverage.ts`) scores
  each hub by how many of its tags the piece carries and returns the best.
  Scoring, not first-match: the Spider-Man review is tagged for Marvel
  Studios, the MCU, Marvel AND Sony Pictures. Ties break on slug so builds
  are deterministic. Known limit, accepted: scoring rewards the hub with the
  LONGEST keyword list, so a GTA piece that mentions Netflix lands on
  Netflix. **`pinnedCoverage`** on a hub doc is the override and beats
  scoring outright; it also adds the item to that hub's coverage, because
  "belongs to this hub" has to mean both. **Precedence is
  `excludeCoverage` > `pinnedCoverage` > tags**, since exclude is what an
  editor reaches for to undo a mistake.
- **Event page metadata is `src/lib/event-seo.ts`**, shared by both event
  templates so they cannot drift: the og:image (a 1200x630 crop of the hero,
  not the site default), the `<title>` via the site-wide `pageTitle()` helper
  (Layout appends NOTHING to `<title>`, so a page that does not call it ships
  brandless), a 120-160 character description built from the event's own kind,
  place and dates, and `schema.org/Event` into Layout's `<slot name="head">`.
  Dates go in as the stored `YYYY-MM-DD` strings (hard rule 1) and an event
  missing a name or a start date emits NO node, because Search Console reports
  a partial one as an error.
- **`script-src` must never allow `data:`.** A QA swarm reported the CSP
  blocking a `data:application/javascript` script on `/featured/*` and
  recommended allowing it, attributing it to a tracking script. It is Astro
  ClientRouter's own EMPTY flush script (the URI ends at the comma), no
  analytics vendor is involved, and blocking it was measured to break nothing:
  served under the real policy, 23 module scripts still executed after a
  client-side navigation and the hub filters still bound and toggled.
  Allowing `data:` there is an XSS amplifier bought with a console warning.
  `scripts/headers-integrity.test.mjs` guards it, reading the POLICY LINE and
  not the file, because "script-src" also appears in a comment above it.
- **The article support rail STACKS below 1200px, it does not vanish.**
  `article.css` used to hide `.article-rail` outright, so a phone reader got
  no hub card, no editorial desk and no Support The HQ. Now only
  `.article-rail-left` (the TOC) is hidden, plus `.article-rail-more`, because
  the column already renders "Suggested Reading" at every width and the rail's
  copy would print it twice. The stacked gap is paid for ONCE: `row-gap` on
  the layout, and the first visible rail block drops its own margin (reach it
  as `.article-rail-more + *`, since `display: none` does not stop
  `:first-child` matching the hidden element).
- **ARTICLES/VIDEOS filters are scoped BY NAME**: `data-coverage="hub"` on the
  hub page, `data-coverage="event"` on event pages, each handler querying its
  own. Astro's ClientRouter keeps both modules alive across a navigation
  between the two, so a bare `[data-coverage]` on both reunites them and
  reproduces the original deep-link bug. The row renders only when both
  content kinds are actually on screen.
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
- **Hub backdrops:** `getHubBackdrop()` (`src/lib/local-content.ts`) returns the
  ONE image behind a hub — its `backdrops[0]` override if set, else its
  `heroImage`, else nothing. It is blurred past any detail and drifts slowly, so
  it is always requested SMALL (640px on /featured, 900px on a hub page).
  **Never source it from video thumbnails.** An earlier version cross-faded up
  to six stills gathered from videos tagged to the hub and then from its
  category; those thumbnails are the channel's own covers, which are frequently
  a photo of the presenter, so hubs ended up backed by the site owner's face. A
  hub is somebody else's brand.
  The wrapper clips and the plate overscans past it — a CSS blur goes weak at
  its own edges, and left flush that near-sharp band shows behind the row
  heading. For the same reason the top/bottom scrims must reach **alpha 1** and
  hold it: at 0.95 a strip of the drifting plate showed at the panel edge, and
  because the plate moves, it read as a leak that grew over time.
- **The /featured stage (right half of an open row):** built from the hub's
  **logo**, not its key art — `heroImage` is already the deck card AND the nav
  thumbnail, so reusing it a third time made a row one image at three sizes.
  The mark sits crisp and large over a blown-up, blurred copy of itself
  (`.backdrop-plate--mark`), on a brand-tinted `.stage-wash` that needs no asset
  at all. Where a hub has a `trailerUrl`, the trailer fades in over the mark,
  **plays once**, and dissolves back to it — never loops (looping is what
  flashed YouTube's title bar back), and never full-bleed (its play overlay and
  captions render dead centre, where no crop reaches them; inset, they land
  inside a smaller framed plate). At most one player exists on the page: a
  collapsed row's frame is *unloaded* to `about:blank`, not hidden. Desktop
  only, gated identically in JS and CSS. The stage is a **sibling** of the
  clipping backdrop wrapper — hard rule 3 forbids any clipping ancestor.
  `scripts/featured-containment.test.mjs` guards all of this.
- **The event hero has THREE mark slots and THREE logo fields.** `.hero-logo`
  (small, top left) reads `heroLogo || logo`; `.hub-stage-mark` (large, in the
  frame the trailer plays in) reads `stageLogo || logo`; `.hub-stage-plate`
  (the blurred ghost feathering the right half) reads whatever is in front of
  it. All three used to read `logo` alone, so a hero read as the same event
  three times over, and worse on a series: PAX West, East, Aus and Unplugged
  all point `logo` at one shared PAX wordmark, so four events were visually
  identical. Each override touches ONE slot; `heroLogo` must never reach the
  stage, or the asset is back in two places.
- **The stage's idle state is KEY ART, not a mark.** The hero already states
  the identity at the top left and the tagline falls back to the event's own
  name directly under it, so a 520px mark in the frame was the same thing a
  third time on one screen. Measured on the Doomsday premiere: the logo asset
  appeared 3 times in the hero markup, now 1. `stageShowMark` (default OFF)
  puts a mark back for an event that genuinely wants one. The ghost follows
  whatever is in front of it — the mark in mark mode, the key art in art mode
  — because a logo-shaped glow around a frame with no logo in it is a leftover
  of a lockup that is not there, and it was one more appearance of the mark.
  **Art mode is a MODIFIER on `.hub-stage-mark`, never a second layer**: every
  state the stage has (`is-playing` → 0.28, `is-item` → 0, reduced-motion)
  is written against that one element, so a new layer would need all three
  rewritten and would silently miss one. The art plate overscans past a clip
  for the usual reason (a CSS blur is weakest at its own edges) and clipping
  is safe on that layer ONLY because it is a SIBLING of the iframe, never an
  ancestor. The stage itself still never clips (hard rule 3).
- **The hero's "Event Details" button goes to `officialWebsite`**, not
  `signUpLink`. `signUpLink` is the REGISTRATION link (an Axs listing for The
  Game Awards, a newsletter form for PAX East) and it still powers the
  "Tickets / RSVP" button further down the page. The two stay separate.
- **The metadata row's vertical position must not depend on the event.** It
  used to move twice over: the copy column was `align-self: end`, so it sized
  to its own content with its BOTTOM pinned, and a taller logo pushed the tags
  up while `.has-cta` (which adds a grid row, shortening the 1fr row above it)
  moved the edge they were pinned to. Measured at 1440x900: 18px of drift
  across logo heights, 32px between an event with a CTA and one without. The
  column stretches now and `.hero-identity` takes `margin-top: auto`, so the
  eyebrow sits at the top of the grid and the lockup stays bottom-anchored.
  `scripts/event-hero-lockup.test.mjs` guards all three of these.
- **Image fields accept two shapes.** The local CMS writes a bare ref string
  (`"image-<hash>-WxH-ext"`); the original frozen Sanity export wrote
  `{_type:'image', asset:{_ref}}`. `urlFor()` and the dimension parser both
  handle either, and the CMS reads through `refOf()` rather than a bare
  `typeof === 'string'` — which used to show D23 and SDCC 2027 as having no
  logo, whose only remedy was re-uploading an asset that was already there.
  The store itself is all strings now. The CMS's **Reuse** button opens a
  picker over every ref in `videos.json` (`collectAssetLibrary()` walks
  documents, not a fixed field list), so referencing an existing logo between
  pages never means uploading it twice.
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
  sitemap filter in `astro.config.mjs`, robots.txt.
  **THE SITEMAP FILTER IN `astro.config.mjs` IS THE SOURCE OF TRUTH, not this
  list.** An earlier version of this note named four routes and omitted two,
  and a review agent took that as the complete set and reported the two
  missing ones as indexable pages wrongly carrying `noindex`. They were
  correctly gated all along. Read the `filter:` array in the sitemap config
  before concluding anything about what is or is not meant to be indexed.
  Gated at the time of writing: `/events-new` (WIP, promotes to `/events`
  later), `/links` (bio-only, deliberately NOT robots-blocked so crawlers can
  read its noindex), `/admin` (Sanity Studio, header-gated via
  `public/_headers`), `/local-cms` (Local CMS, dev-only — shows a static
  "Restricted Access" message in prod), `/media-kit` and
  `/collaborations/press-kit` (standalone print/sales documents that do not
  use `<Layout>` at all, which is also why they carry no canonical — a
  noindexed page does not need one).
- The muted-grey text palette is a deliberate design trade-off; don't "fix" it
  without the owner. It does NOT, however, fail WCAG the way this note used to
  claim: an automated pass over six routes found zero failures at rest.
  `--color-white-muted` (#888888) on `--color-surface` (#111111) is 5.33:1 and
  `--color-accent-text` (#ef4444) is 5.02:1, both clearing AA. The one token
  that genuinely fails is `--color-accent` (#cc0000) at 3.21:1: it is a border
  and glow colour only, never a text or icon colour. Use `--color-accent-text`
  when red needs to be legible.
- **No em dashes in user-facing copy.** House style: split into two sentences,
  or use a comma/colon. Applies to anything a visitor reads — headings, body,
  empty states, alt text, meta descriptions. Code comments are exempt.
- `.sr-only` is global (`src/styles/global-base.css`). Card grids under an h1
  get a structural sr-only `<h2>`.
- Secrets: never committed; see `.env.example`. The sync script requires
  `--execute` to write (dry-run default).
