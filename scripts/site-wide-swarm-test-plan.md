# Site-wide swarm test plan — go/no-go for `integration/youtube-local-astro7` → `main`

Written 2026-07-23. This is the full pre-merge QA pass for the entire body
of work this branch carries: the Astro 6→7 migration, the Sanity→local-JSON
pivot for video/short/live/event/featuredBrand content, the Local CMS
(`/local-cms`), the taxonomy-as-code YouTube sync, and the automated hourly
sync workflow. **Nothing in this branch is live on `main` yet** — this test
plan is the gate before that merge, not a check on production.

Assign each numbered section below to a separate agent/tester. Each section
is meant to stand alone — an agent picking up only §4 shouldn't need
context from §7. Every test case has a concrete pass/fail condition; avoid
vague "looks fine" verdicts. **Report using the template in §11**, filled in
per section, with a final consolidated GO / NO-GO / GO-WITH-CONDITIONS call.

**Setup common to all sections**, unless a section says otherwise:
```bash
git checkout integration/youtube-local-astro7
git pull origin integration/youtube-local-astro7
npm ci
npm run dev        # for interactive/CMS sections
# or
npm run build && npm run preview   # for production-parity sections
```

---

## 1. Build & compile integrity (do this first — gates everything else)

- [ ] `npm test` — every offline suite green (events, live-status, twitch, videos, shorts, taxonomy, dispatch, metrics). Report the exact assertion count; flag ANY failure as blocking.
- [ ] `npx astro check` — must be exactly **0 errors / 0 warnings / 0 hints** across all files. This is the documented baseline (`CLAUDE.md`); any new error/warning is blocking.
- [ ] `npm run build` — must complete with no unexpected errors. Expected (non-blocking) behavior: `/articles`, `/feed/videos`, `/videos` pages log "file not created, response body was empty" — this is by design (RSS fetches fail offline, pages try/catch to empty data). Anything else failing is blocking.
- [ ] `npm run preview` — hits the built worker; confirm it serves `200` on `/` and on `/api/live-status.json` (expect `{"status":"not_configured"}` or similar without a real API key — not a 404, not a 500).
- [ ] `npm audit --omit=dev` and `npm audit` (full) — record findings. As of 2026-07-23 there are 17 known vulnerabilities, all transitive through `sanity`'s CLI tooling and `wrangler`'s `miniflare`/`sharp` dependency chain — **dev/build tooling only, nothing in the runtime request path**. Confirm this is still true (none of the flagged packages appear in the actual served bundle) rather than taking that on faith — grep `dist/` for the flagged package names as a sanity check. Flag as blocking only if a vulnerability is found in something that actually ships to the browser or runs at request time.

## 2. Production route isolation (security/scope boundary)

- [ ] After `npm run build`, confirm `dist/` contains **zero** references to `local-cms` or `LocalCmsApp`: `grep -ril "local-cms\|LocalCmsApp" dist/` should return nothing except `dist/client/robots.txt` (expected — it's in the disallow list).
- [ ] Confirm `/local-cms` is not a resolvable route at all in the production build (not even a "Restricted Access" page — it should 404, since `injectRoute()` only fires when `command === 'dev'`).
- [ ] Confirm `/admin` (Sanity Studio) still builds and is header-gated per `public/_headers` — this should be unchanged by this branch.
- [ ] Confirm `/api/local-cms/videos` and `/api/local-cms/upload` are dev-server-only Vite middleware (`astro.config.mjs`'s `configureServer` hook) and are **not** present as real routes in the built `dist/server` — grep the server bundle for `local-cms` to confirm.

## 3. Data-integrity / taxonomy correctness (the sync pipeline)

Use `scripts/sync-youtube.mjs`'s exported pure functions directly (no live API key needed — these are unit-testable):

- [ ] Re-run the two scenarios already verified by Claude (documented in `scripts/youtube-automation-test-plan.md` §4) and confirm the same results: a video tagged `['SDCC 2026', 'DC', 'event']` produces `contentStatus: "published"`, `topics: ["events"]`, `hubs: ["sdcc-2026", "dc-comics"]`; a video tagged only `['SDCC 2026', 'DC']` (no Tier-1 keyword) produces `contentStatus: "needs-review"`.
- [ ] **New scenario — multi-hub collision check**: construct a video tagged with keywords matching TWO different event/brand hubs simultaneously that share no keyword overlap (e.g. an SDCC video also tagged `marvel`) — confirm `hubs` contains both, and that it appears on BOTH hub pages after a build (same method as the SDCC/DC test: inject into a scratch copy of `videos.json`, build, grep `dist/` for a unique marker string in the title).
- [ ] **`manualTaxonomyOverride` (Sync Lock) behavior**: take an existing published video doc, set `manualTaxonomyOverride: true`, then re-run `matchVideoTags`/`planVideoSync` with a completely different (or empty) tag set — confirm `topics`/`hubs`/`requiresReview` stay frozen at their pre-lock values, unaffected by the new tags.
- [ ] **`manualTypeOverride` effect**: take a doc with `_type: "video"` and set `manualTypeOverride: "short"` — confirm it disappears from `getVideosUnified()`'s output and appears in `getShortsUnified()`'s output instead (`src/lib/videos-source.ts`). This is the fix that shipped in commit `e929432`; regression-test it specifically.
- [ ] **Idempotency**: run `planVideoSync` twice in a row on the same input+existing-doc — confirm the second run produces an identical result to the first (no drift, no duplicate accumulation in arrays).
- [ ] **Hub keyword collision detection**: run `buildTaxonomyDictionary` against the real `videos.json` and confirm `dict.collisions` is empty (i.e. no two event/brand docs claim the same `youtubeSyncKeywords` entry) — this was empty as of 2026-07-23; if a new hub was added since, re-verify.
- [ ] **Topic bootstrap**: on a `videos.json` with zero `topic` docs, confirm a sync run seeds the 5 default Tier-1 topics (`film`, `tv`, `gaming`, `events`, `uncategorized`) exactly once, and does NOT re-seed them on a second run once they exist.
- [ ] **`sync-youtube.yml` workflow** (needs `YOUTUBE_API_KEY`/`YOUTUBE_CHANNEL_ID` as repo Actions secrets — see `scripts/youtube-automation-test-plan.md` §5 for the full checklist): dry-run via `workflow_dispatch` produces no commit; execute run commits only when `videos.json` actually changed; a no-op run produces no commit and no error.

## 4. Local CMS — full CRUD regression

Run `npm run dev`, open `/local-cms`.

- [ ] **Create**: create one new doc of each type (video, short, live, event, featuredBrand, topic). Confirm each gets a sane default `_id`, appears in the correct filter/list, and the form doesn't crash on an empty/default doc.
- [ ] **Read**: select an existing doc of each type; confirm all tabs (`Factual (Read-Only)`, `Status & Curation`, `Systems Overrides`, `Core Taxonomy`, `Editorial`) render without errors and show correct data.
- [ ] **Update**: edit a title, a tag, a toggle field, and an image URL on a video doc; confirm the change reflects immediately in the master list (React state) and persists after clicking "Save to videos.json" + reloading the page.
- [ ] **Delete**: delete a non-protected doc; confirm the confirm() dialog appears, and after confirming, the doc disappears from the list and (after Save) from `videos.json`.
- [ ] **Delete guard**: attempt to delete a Tier-1 topic (`film`/`tv`/`gaming`/`events`) or `topic-uncategorized` — confirm it's blocked with an explanatory alert, not a silent no-op or a crash.
- [ ] **Duplicate YouTube ID collision guard**: create a new video doc and type in a `youtubeId` that already belongs to an existing doc — confirm it's blocked (alert), not silently creating two docs with the same `_id`.
- [ ] **Orphaned ID fix**: on a doc with a `youtubeId` set, clear the field entirely — confirm `_id` regenerates to a fresh `local-pending-<uuid>` rather than staying frozen on the old `youtube-<id>` value.
- [ ] **Tag chip overflow** (shipped fix, commit `620f432`): add a tag with a very long unbroken string (30+ chars, no spaces) to any `TagsInput` field — confirm it wraps inside its chip instead of overflowing the container/grid.
- [ ] **Image upload**: use the "Upload" button on an event or featuredBrand's image field with a real image file; confirm it POSTs to `/api/local-cms/upload`, writes to `public/uploads/`, and the returned URL previews correctly. Confirm the button now reads as an outlined/neutral style, not a red rounded pill (commit `620f432`).
- [ ] **Atomic writes**: while a save is in flight (or immediately after), inspect `src/data/videos.json` for corruption/partial-write — should never happen (temp-file-then-rename), but worth a spot check under rapid repeated saves.
- [ ] **Responsive layout**: resize the browser (or devtools viewport) to 768px, 1024px, 1440px, 1920px widths inside `/local-cms` specifically — confirm the two-pane layout, the tab bar, and the editor form don't overlap, clip, or overflow at any of these widths. Pay attention to the navbar-overlap and off-center-layout bugs fixed earlier this session — confirm they haven't regressed.
- [ ] **Delete button / scrollbar**: on a doc with a long form (lots of fields), scroll the detail pane and confirm the "Delete" button in the header stays fully clickable and isn't visually clipped by a scrollbar. (Flagged but unconfirmed by Claude — see `scripts/youtube-automation-test-plan.md` history; needs a real browser to verify, which Claude's environment didn't have.)

## 5. Cross-browser / responsive UI (public site, not just the CMS)

Test at minimum: 320px, 390px, 640px, 767px, 1024px, 1440px widths, in at least Chrome and Safari (iOS Safari specifically for anything touching `HeroTrailer.astro` — see §6).

- [ ] No horizontal scroll/overflow at any tested width on: `/`, `/events`, `/events/sdcc-2026`, `/featured`, `/featured/dc-comics`, `/feed`, `/feed/events`, `/links`, `/about`, `/press-kit`.
- [ ] Video modal opens/closes correctly, keyboard-dismissible (Escape), focus-trapped.
- [ ] Calendar modal and category modal: same checks.
- [ ] Discovery Row (Shorts shelf on `/events`) mobile carousel: snap behavior, peek percentage looks intentional (not cut off mid-card) at 320/390/640/767.
- [ ] `SubscribeCTA` component renders identically wherever it's used (it was extracted from duplicated markup this session — confirm no visual drift between its call sites).

## 6. HeroTrailer / iOS Safari — protected component, extra care

`HeroTrailer.astro` is explicitly protected in `CLAUDE.md` — do not suggest rewrites, only report pass/fail.

- [ ] On a real iPhone (or iOS Simulator) Safari: trailer plays on an event/featured page, no black screen.
- [ ] Rotate the device — confirm the trailer restarts (this is documented **accepted behavior**, not a bug — do not flag it as one) and doesn't break/blank out permanently.
- [ ] Confirm no ancestor of the YouTube iframe has `overflow: hidden` (hard rule #3 in `CLAUDE.md`) — inspect computed styles on `.event-hero-bg-wrapper` and its ancestors.
- [ ] Confirm no `<img>` on these pages uses `filter: drop-shadow` (hard rule #6).

## 7. Accessibility

- [ ] Run an axe (or equivalent) audit against `/`, `/events`, `/events/sdcc-2026`, `/featured/dc-comics`, `/feed`, `/local-cms`. Report violations by severity.
- [ ] **Known, accepted, do-not-flag**: the muted-grey text palette fails WCAG AA contrast in multiple places — this is a documented, deliberate design trade-off (`CLAUDE.md`). Do not report this as a new finding; only flag contrast issues that are clearly unintentional bugs (e.g. white-on-white, not the grey palette itself).
- [ ] Heading order: confirm card grids under an `<h1>` have the structural `sr-only <h2>` (convention documented in `CLAUDE.md`) and there are no skipped heading levels.
- [ ] Keyboard navigation: tab through the main nav, the feed filters, the video modal, and the entire `/local-cms` interface (including the tag-chip remove buttons and toggle switches) — confirm every interactive element is reachable and has a visible focus state.

## 8. Security

- [ ] `/api/local-cms/*` endpoints (videos GET/POST, upload POST): confirm these do NOT exist in the production build (cross-reference with §2). If somehow reachable in a prod-like environment, that's a P0 blocking finding.
- [ ] Upload endpoint filename sanitization: confirm `../../../etc/passwd`-style path traversal in an uploaded filename is neutralized (the sanitizer strips `/` and `\`, per prior review — re-verify with an actual crafted filename, don't just trust the code read).
- [ ] Confirm `public/uploads/` is gitignored (commit `620f432`) and no files from local testing have been accidentally committed: `git ls-tree -r HEAD --name-only | grep uploads`.
- [ ] Confirm no secrets (`YOUTUBE_API_KEY`, `SANITY_WRITE_TOKEN`, etc.) appear anywhere in git history on this branch, not just the current tree: `git log --all -p -- .env` should show nothing, `.env` should never appear in `git ls-files`.
- [ ] Confirm `sync-youtube.yml`'s secrets (`YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`) are referenced only via `${{ secrets.* }}`, never echoed to logs anywhere in the workflow.
- [ ] Dependency audit: cross-reference §1's `npm audit` findings — confirm none of the flagged packages (`adm-zip`, `js-yaml`, `sharp`, `smol-toml`, `uuid`) appear in the actual served `dist/` output.

## 9. Chaos / edge-case data

Construct these directly in a scratch copy of `videos.json` (never the committed file), rebuild, and check for crashes or silently-wrong rendering — not just "does it 500":

- [ ] A video doc missing `youtubeId` entirely — should be filtered out (`mapSanityVideo` returns `null` if `!id`), not crash the build.
- [ ] A video doc with `topics: []` and `hubs: []` — should render fine, just not appear on any hub/category page.
- [ ] An event or featuredBrand doc with no `youtubeSyncKeywords` — hub matching should simply never fire for it, not error.
- [ ] Two docs with the same `_id` (simulate the exact bug this session already fixed a guard for) — confirm this can't be produced through the CMS (§4's duplicate-ID test), and if forced directly into the JSON, confirm the build doesn't crash (React key warnings acceptable, hard crashes are not).
- [ ] An extremely long title (300+ chars, no spaces) on a video — confirm card/grid layouts truncate or wrap gracefully, no layout breakage.
- [ ] A `durationSeconds` of `0` or `undefined` — confirm duration display falls back gracefully ("Unknown" or similar), not `NaN` or a crash.
- [ ] Malformed `videos.json` (truncated/invalid JSON) fed to `npm run sync -- --execute`'s existing-doc read path — confirm it logs a warning and proceeds with empty state rather than crashing (per the code's `try/catch` around the initial read).

## 10. End-to-end user journeys

Full click-through paths, not isolated feature checks:

- [ ] Homepage → click a video in "Latest Videos" → modal opens → video plays → close modal → still on homepage, no navigation side-effects.
- [ ] Homepage → nav to `/events` → click SDCC → hub page loads → hub coverage section shows videos → click one → plays correctly.
- [ ] `/featured` → click DC → hub page loads → hub coverage shows videos → same video from the SDCC test should also appear here if it was tagged for both (cross-reference §3's multi-hub test).
- [ ] `/feed` → use `QuadrantFilter` to filter by type/category → results update correctly → paginate to page 2 → still correct.
- [ ] Contact form: submit with valid data → succeeds; submit with missing required fields → validation blocks it, no silent failure.
- [ ] `SubscribeCTA` on at least two different pages it appears on → link/action behaves identically both places.

## 11. Report template

Fill in per section, then roll up to one final verdict.

```
Section 1 (Build/compile):        PASS / FAIL — notes:
Section 2 (Route isolation):      PASS / FAIL — notes:
Section 3 (Taxonomy/sync):        PASS / FAIL — notes:
Section 4 (Local CMS CRUD):       PASS / FAIL — notes:
Section 5 (Cross-browser UI):     PASS / FAIL — notes:
Section 6 (HeroTrailer/iOS):      PASS / FAIL / NOT TESTED — notes:
Section 7 (Accessibility):        PASS / FAIL — notes:
Section 8 (Security):             PASS / FAIL — notes:
Section 9 (Chaos/edge cases):     PASS / FAIL — notes:
Section 10 (E2E journeys):        PASS / FAIL — notes:

Blocking findings (must fix before merge):
  -

Non-blocking findings (fine to merge, track separately):
  -

FINAL VERDICT: GO / NO-GO / GO WITH CONDITIONS
Conditions (if any):
```

Both this report AND Claude's own independent assessment (see
`scripts/youtube-automation-test-plan.md` for the render-logic verification
already done) should be reviewed together before the owner decides on the
`main` merge — neither one alone is the final word.
