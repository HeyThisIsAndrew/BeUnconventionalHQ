# Handoff: Dynamic Media Kit (Epic #28) — media-kit-design branch

Written by Claude for whoever (Antigravity or otherwise) picks this up next.
Branch state as of commit `b010618`: `media-kit-design` and
`claude/media-kit-review-audke6` are identical — treat `media-kit-design` as
canonical, the other is a synced mirror kept for a review workflow.

## What this branch actually is

Started as Antigravity's dynamic media kit + FAB button work. Since then it's
had: an accessibility pass (keyboard-operable video cards site-wide, not just
this page), a data-architecture pivot (live API calls at build time →
committed JSON cache), a full mobile-responsive layout for `/media-kit`, and —
the big one — replacing `window.print()` with a server-generated PDF after
three separate print rendering bugs turned out to be unfixable from the client
side. Read the "Do not re-break this" section before touching print CSS or
the download button.

## Architecture as it stands

**Data**: `src/data/cache/channel-stats.json` is a committed file, statically
imported by `src/pages/media-kit.astro`. It is populated by
`node scripts/fetch-channel-stats.mjs` (`npm run refresh-analytics`), which
hits the YouTube Data API (public stats) and, if OAuth creds are present, the
YouTube Analytics API (retention, demographics, geos, impressions). This is
**deliberately not chained into `refresh-content`** (which `dev`/`build:live`/
`start:full` all run) — it used to be, and that combined with Cloudflare
Workers Build's auto-build-on-every-push meant the OAuth flow was firing on
nearly every git push during active iteration. If you ever see `refresh-content`
touching `fetch-channel-stats.mjs` again, that regression came back — undo it.

**The downloadable PDF**: `public/downloads/be-unconventional-hq-media-kit.pdf`
is a committed, pre-generated file — not created by a visitor's browser.
`scripts/generate-media-kit-pdf.mjs` (`npm run generate-media-kit-pdf`) builds
the site, serves it via `npm run preview`, drives headless Chromium
(Puppeteer) to `/media-kit/`, and calls `page.pdf()` with zero margins and
headers/footers explicitly off. The "Download PDF" button on the page is a
plain `<a href="/downloads/...pdf" download="...">` — **not** `window.print()`.
Regenerate this file (and commit it) after any visual change to
`media-kit.astro`, or after refreshing analytics. `update-analytics.yml`
already chains both steps together when manually dispatched.

**Logo pack**: `public/downloads/be-unconventional-hq-logo-pack.zip`, same
pattern, linked from `/press-kit`. It's a *starter* pack built from existing
site assets (`logo.webp`, `favicon.svg/.ico`) — no reversed/white variant, no
transparent PNG export, no horizontal lockup, because those source assets
don't exist yet. Don't imply it's a full kit if you touch the copy.

**Download reliability on iOS**: both files also have explicit
`Content-Disposition: attachment` rules in `public/_headers`. iOS Safari
routinely ignores the HTML `download` attribute specifically for PDFs (a type
it can render natively) and opens its inline viewer instead of downloading —
the header is the actually-reliable fix. If you add another downloadable file
to this page, give it the same header treatment or it may not download
correctly on iOS.

## Do not re-break this

1. **Never put `window.print()` back on the Download PDF button.** Three
   separate bugs traced back to it this session: iOS AirPrint stamping a
   URL/date/page-count footer onto every page (not suppressible from CSS at
   all — this is OS-level, not a bug in our code), iOS reserving its own
   margins regardless of `@page { margin: 0 }`, and a `.page{height:9in}`
   compensation that fixed the iOS page-count issue but broke desktop by
   creating dead white space (desktop's print engine doesn't share iOS's
   constraint, so one CSS value can't satisfy both). No CSS-only fix
   reconciles two different browsers' print engines. The PDF is generated
   PDF now — leave it that way.
2. **This stylesheet has a real cascade-ordering trap.** `media-kit.astro`'s
   `<style is:global>` block is one long stylesheet with `@media print` and
   `@media screen and (max-width: 720px)` blocks. CSS cascade resolves ties
   by *source position*, not by which media query "feels" more specific — a
   media-query-scoped rule sitting earlier in the file loses to an
   unconditional rule with the same property sitting later, even though the
   media query matches. This bit the mobile breakpoint once and a print fix
   once (both silently did nothing until moved/`!important`-ed). The mobile
   block now correctly sits at the very end of the stylesheet, after
   everything it overrides. If you add new print or mobile overrides,
   either append them after the relevant base rules, or use `!important` and
   verify empirically (`getComputedStyle` or a real screenshot) — don't trust
   that a `@media` block "wins" by default.
3. **The ambient corner glow (`.page::before`) and the headshot feathering
   (`.headshot-placeholder::after`) are intentionally NOT stripped for print
   anymore** — they were for a while, defensively, because iOS's AirPrint
   pipeline was rasterizing soft rgba shadows/gradients as hard opaque
   blocks. That risk is gone now that Puppeteer generates the file. Don't
   re-add `display:none`/`box-shadow:none` overrides for these unless you
   have a *new*, Chromium-reproducible reason to.
4. **`src/data/cache/channel-stats.json`'s `impressions` field may
   legitimately be `0`.** YouTube only populates that metric for channels
   with Suggested/Home-feed placement; this channel may not have it yet. The
   headline metric card falls back to lifetime Total Views automatically
   when `impressions <= 0` (see `hasImpressions`/`headlineMetricValue` in
   `media-kit.astro`'s frontmatter) — don't "fix" a `0` there by hardcoding
   a number.

## Known open gaps (not blockers, just real)

- **IG/TikTok numbers are hardcoded constants** (`igFollowers`, `tiktokFollowers`
  in `media-kit.astro`), not live. Correctly blocked on the owner's pending
  Meta Developer / TikTok Developer applications (issue #28's own stated
  dependency). Don't wire these live without real adapters.
- **Carpet-readiness photo sample** for `/press-kit` (issue #39) — needs a
  real photo from an actual convention/red-carpet appearance. Don't fabricate
  one; that's a credibility risk for a document meant to support press
  credentialing, not a design placeholder to fill.
- **`analytics-setup-instructions.md`** (issue #45) is `.gitignore`d and
  doesn't exist in any environment an agent can read — it's the owner's own
  local setup notes for a recurring analytics-refresh cadence (iOS Shortcut /
  cron). Don't assume its contents; ask the owner if it matters.
- `update-analytics.yml` needs `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` /
  `YOUTUBE_REFRESH_TOKEN` as **GitHub repo secrets** (separate from whatever
  Cloudflare has configured) to actually run — currently skips gracefully if
  they're absent. Confirm with the owner whether these are set before
  assuming the workflow works end to end.
- Mobile responsiveness for `/media-kit` (previously the merge blocker,
  issue #46) is fixed and closed — verified with real `getBoundingClientRect`
  measurements at 390px width, zero horizontal overflow. Don't re-litigate
  this without new evidence something's actually broken again.

## Verification habits worth keeping

Nothing in this session that mattered got verified by reading CSS and
reasoning about it — every fix that stuck was checked by actually building,
serving, and measuring (headless Chromium screenshots, `scrollWidth`/
`clientHeight` comparisons, rendering the actual generated PDF to an image and
looking at it). Several early "fixes" shipped on code-review confidence alone
turned out to not work at all once measured. If you change anything in
`media-kit.astro`'s print or mobile CSS, rebuild and actually look at the
output before calling it done — `npm run build && npm run generate-media-kit-pdf`,
then open the resulting PDF, or screenshot the page at a real mobile viewport.

## GitHub issues touched this session

- **#28** (Epic 5) — status comments posted, not closed (IG/TikTok adapters +
  tests still correctly blocked on owner's pending API approvals).
- **#39** ("Build out robust Press / Media Kit page", was closed) — commented
  that 2 of 5 original items were never delivered; logo pack now done, carpet
  photo still isn't. Left open/closed state to the owner.
- **#45** ("Configure Automated Analytics Updates") — commented with the
  `refresh-content`/`refresh-analytics` split context. Still open.
- **#46** (mobile layout, filed and closed this session) — closed, fix
  verified.
