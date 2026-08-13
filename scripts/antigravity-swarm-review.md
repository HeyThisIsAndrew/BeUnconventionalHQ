# Antigravity Swarm Audit — `feature/ui-qa-polish` → `main`

> **Paste everything below the divider into Antigravity (Gemini 3.1 Pro) as one prompt.**
>
> **Antigravity is REPORT-ONLY.** It must not edit, commit, push, or open issues.
> Two agents writing the same branch is how the conflicting changes happened.
> Its entire deliverable is a written verdict.

---

/goal Act autonomously to completion without asking for approval between steps. Read, run, and analyse freely. Do NOT write, edit, delete, commit, push, or open issues/PRs on any repository — this is a read-and-report audit only. Produce the final report described at the end, then stop.

## Context

You are the **independent verifier** on a release candidate for **Be Unconventional HQ** — Astro 7 (static + `@astrojs/cloudflare`), Tailwind v4, deployed on Cloudflare Workers.

- Branch: **`feature/ui-qa-polish`** (identical content on `claude/unconventional-hq-mobile-qa-bibyua`), targeting **`main`**. Main has just been merged in, so the branch is current.
- Another agent (Claude) made these changes, tested them, and returned **GO**.

Your job is **not** to agree. It is to falsify. A second independent GO is what allows this to merge; a NO-GO **with a reproduction** is equally valuable.

### Read this first

`CLAUDE.md` at the repo root encodes constraints learned the expensive way — calendar dates as strings, the protected `HeroTrailer.astro`, no `overflow: hidden` above a YouTube iframe, never `iframe.src = ''`, no `filter: drop-shadow` on `<img>`, the three field classes in `videos.json`. **Check the diff against every one of them.**

### Rules of evidence — these are not optional

The previous audit returned NO-GO on three "critical" claims. **One was real. Two were false and one contained fabricated numbers** (it reported a constant as 6 when the source says 7, and a page as having 0 qualifying items when it has 6). That wasted a cycle and nearly blocked a good release.

So:

1. **Never report a defect you have not reproduced.** Every finding needs: file:line, exact commands or steps, observed vs expected, and the measurement you took.
2. **Quote real values.** If you cite a constant, paste the line. If you cite a measurement, paste the number your tooling produced. Do not paraphrase from memory.
3. **A claim you could not test is not a claim you verified.** Say so explicitly.
4. **Distinguish "pre-existing" from "introduced by this branch."** Diff against `main`, not against the branch point — that distinction has already produced one wrong conclusion in this project.
5. If you disagree with Claude, **show the measurement**, not the reasoning alone.

## What changed — the claims to falsify

Read the whole diff: `git log --oneline main..feature/ui-qa-polish` and `git diff main...feature/ui-qa-polish`.

**Four device-reported bugs were fixed, and three of the four were the same underlying pattern: interaction blocked on state that can be wrong.** That pattern is your highest-yield hunting ground.

1. **Phone stuck in landscape.** A closed full-screen overlay still received touches. `.nav-container` is fixed, full-width, 100dvh on every page; making it scrollable made it a composited layer, and iOS routes touches to it while invisible. Fixed with `pointer-events: none` when closed.
2. **iPad navbar untappable.** Same class: `#video-modal` (mounted by `Layout.astro` on *every* route, z-index 300, above the navbar's 100) and `#qr-modal` on `/links` were hidden but still `pointer-events: auto`. Guarded, plus `scripts/e2e-phantom-overlay.test.mjs` enforces the invariant across 12 routes.
3. **iPad carousel: tiles at both ends could never be opened.** The tap-to-centre handler gated links on `.is-active`, which requires crossing the track's horizontal centre — impossible for the end tiles. 4 of 10 dead in iPad landscape. Gate is visibility now; `scripts/e2e-carousel-rail.test.mjs` dispatches real clicks at five widths including tablets.
4. **Splash trap on refresh.** `html.splash-armed { overflow: hidden }` freezes whatever offset the document has; iOS restores scroll on refresh and races the reset, so the reader was frozen mid-page, and `touch-action: none` removed the escape. `arm()` now scrolls to top *before* freezing, plus a while-armed safety net; `scripts/splash-scroll-lock.test.mjs` is a static guard.

5. **Jarring glide on refresh.** Related to 4 but a separate defect: `html { scroll-behavior: smooth }` is global, so the three resets on the reload path in `Hero.astro` did not jump — they *animated* from the restored offset to the top, re-targeting each other, with `arm()`'s instant jump landing mid-flight. Measured at 390×844: a bare `scrollTo(0, 0)` from 1500 passes through **25** distinct intermediate positions; pinned to `auto` it reports **1**. All resets now go through `jumpToTop()`, and `splash-scroll-lock.test.mjs` fails any `window.scrollTo()` in `Hero.astro` that neither states a behavior nor pins one first. **Re-measure this yourself, and audit every other `scrollTo` on the site for the same latent animation.**

Also in scope: Instagram topic qualification (`src/lib/instagram-topic.ts`, `HUB_CAROUSEL_MIN_TILES`), hover de-flicker on carousel tiles and YouTube embeds, Featured row width, contact-modal removal, invisible `::before` touch-target expansion, and a median-of-3 Lighthouse gate.

## Swarm assignments

Run these in parallel. Each returns findings with file:line and a reproduction. **Fix nothing.**

### Agent 1 — Chaos / state-corruption (highest priority)

Every bug this session came from a component reaching a state its author did not anticipate. Try to produce those states.

- **Overlay chaos:** open and close the mobile menu, category overlay, video modal and calendar rapidly and in overlapping sequences. Open one from inside another. Rotate mid-animation. Navigate (ClientRouter) with an overlay open. Hit browser Back with one open. Verify the scroll lock's reference count always returns to zero — a stuck lock leaves the page pinned. `src/lib/scroll-lock.ts`.
- **Refresh × scroll position:** reload at the very top, mid-page, at the very bottom, and mid-splash-animation, on `/` and on interior routes. Then try to scroll **up**. This is bug 4's family; it has shipped three times.
- **Orientation churn:** rotate repeatedly with the menu open, with the carousel mid-scroll, and during the splash lift.
- **Back/forward:** traverse in and out of the homepage repeatedly; the splash must not arm on a back-navigation to a scrolled position.
- **Throttling:** 4x CPU slowdown and slow-3G. Race conditions hide behind fast machines — the splash bug is exactly a race.
- **Reduced motion:** `prefers-reduced-motion: reduce` through every animated path.
- **Double/triple tap** on carousel tiles, nav links and CTAs; **long-press**; **two-finger** scroll.

### Agent 2 — UI/UX and visual regression

- Every route at 320 / 390 / 430 / 768 / 834 / 1024 / 1366 / 1440 / 1920 / 2560, **portrait and landscape**. Tablet widths are explicitly required: bug 3 lived there and nothing else in the suite looked.
- Horizontal overflow, clipped or overlapping content, broken grids, inconsistent gutters, layout shift.
- Typography consistency: the two Instagram rail labels must share family, weight, letter-spacing ratio, colour and uppercase treatment (size may differ). Headings, buttons and links consistent across surfaces.
- Confirm the Featured row aligns with the Subscribe box, and that `/events` and `/feed` are unchanged.
- Hover states on a real pointer: park the cursor **on the edge** of Instagram tiles and in-article YouTube embeds and watch for flicker — the failure was an oscillation loop at frame rate, only visible at the boundary.
- Verify touch targets, accounting for the invisible `::before` expanders in `src/styles/modules/a11y.css` — measuring the layout box alone will under-report.

### Agent 3 — E2E, unit and type checks

- `npm ci`, then `npx astro check` (report the exact error/warning/**hint** counts; the bar is zero new, and hints count), `npm test`, `npm run test:e2e` (13 suites), `npm run build`.
- **Then do the thing that matters most: verify the new tests can actually fail.** Two tests written this session initially passed against a deliberately reintroduced bug because they measured the wrong thing. For each of `e2e-phantom-overlay`, `e2e-carousel-rail` and `splash-scroll-lock` (including its new "must JUMP, never animate" case): reintroduce the original defect in a scratch copy, rebuild, and confirm the test fails. A test that cannot fail is worse than no test — it is false confidence. Report any that do not.
- Check for flakiness: run the e2e suite twice. Note anything order-dependent or timing-dependent.

### Agent 4 — Instagram topic qualification

- Read `src/lib/instagram-topic.ts`, `src/lib/instagram.ts`, `InstagramFeed.astro`, both hub `[slug].astro` pages.
- Independently recompute from `src/data/instagram.json` and `src/data/videos.json` which posts qualify for DC, Marvel, SDCC and D23. **Paste your counts.**
- Verify: DC renders no carousel; Marvel's tiles are genuinely Marvel (check the actual caption evidence per tile); unrelated posts cannot pad a short row; an empty keyword list qualifies nothing rather than falling through to the global feed; the homepage rail is unaffected.
- Try to construct a caption that wrongly qualifies or wrongly fails.
- Confirm `HUB_CAROUSEL_MIN_TILES` and its derivation. Quote the line.

### Agent 5 — Accessibility

- Keyboard-only pass over every overlay and the carousel: focus order, focus visibility, focus trapping, Escape, and focus return on close.
- **Known and deliberately open:** full focus-trapping is not implemented on all overlays. Report it as a gap, not as a regression.
- Verify Escape closes the mobile menu (added this session), the calendar close button has a visible focus ring, and `CategoryOverlay` declares `role="dialog"`.
- Screen-reader semantics on the Instagram rail: the left label must not be announced as interactive; the right one must be.
- Headings: exactly one `<h1>` per page and no skipped levels. **`/category/*` legitimately has none** — they are `noindex` meta-refresh redirect shims.

### Agent 6 — Performance and build integrity

- `npm run lighthouse` and `npm run lighthouse:desktop`. Report every number.
- Scrutinise the median-of-3 confirmation in `scripts/lighthouse-check.mjs`: does it still fail a genuine reproducible regression, or has it been weakened into a way to hide one? Confirm the **worst** sample is written to the artifact.
- Check for new render-blocking resources, CLS, and oversized images.
- Note: Instagram tiles are served full-resolution through `/api/proxy` with no `srcset`, unlike every other host (which gets resized WebP via wsrv.nl). This is a known payload inefficiency, investigated and found **not** to be what fails the Lighthouse gate. Confirm or refute — with measurements.

## Environment notes — do not report these as defects

- `npm ci` first. Node 22.
- **External image hosts** (`cdninstagram.com`, `i.ytimg.com`, `wsrv.nl`, `qrserver.com`) may be blocked in your sandbox. Broken images and `ERR_TUNNEL_CONNECTION_FAILED` console noise from those hosts are environmental. Do note if they prevented you from verifying something.
- The Substack article sync may fail without network; it degrades to empty **by design**.
- `npm run test:e2e` needs ports 4321/4323/4324/4325 free. Kill stray `workerd` / `astro preview` first.
- **If you have WebKit/Safari, say so and use it.** Every iOS fix here is verified by construction and in Chromium only — Chromium hit-tests hidden overlays correctly and resets scroll on reload, so it cannot reproduce two of the four original bugs. Real Safari is the single most valuable thing you can bring.

## Required output

Report only. No code changes, no commits, no issues.

1. **VERDICT: GO or NO-GO** — first line.
2. **Confidence** (high/medium/low) and what would raise it.
3. **Blocking defects** — for each: file:line, reproduction steps, observed vs expected, the measurement, and which claim it falsifies. Mark each **introduced by this branch** or **pre-existing on main** (diff against main to decide).
4. **Non-blocking findings**, ranked.
5. **Tests that cannot fail** — any of the three new tests that still passed with the defect reintroduced.
6. **Claims you could NOT verify**, and why. State plainly whether you tested real iOS Safari.
7. **Disagreements with Claude**, each with the measurement behind it.
8. **Numbers**: build, `astro check` (errors/warnings/hints), unit, e2e, both Lighthouse runs.

Be adversarial and specific. "Looks fine" is not a finding; neither is a defect without a reproduction. If you believe this is safe to merge, say GO and say why you are confident.
