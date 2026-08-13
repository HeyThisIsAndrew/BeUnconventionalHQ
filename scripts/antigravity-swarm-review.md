# Antigravity Swarm Review — `feature/ui-qa-polish` → `main`

> **Paste the block below into Antigravity (Gemini 3.1 Pro) as a single prompt.**
> It is written to be self-contained: it names the branch, the claims to falsify,
> the commands to run, and the exact output format required.
>
> **Antigravity is REPORT-ONLY on this pass.** It must not edit, commit, push, or
> open issues — a second agent writing to the same branch is how the conflicting
> changes happened last time. Its entire deliverable is a written verdict.

---

/goal Act autonomously to completion without asking for approval between steps. Read, run, and analyse freely. Do NOT write, edit, delete, commit, push, or open issues/PRs on any repository — this is a read-and-report audit only. Produce the final report described at the end, then stop.

## Context

You are the **independent verifier** on a release candidate for **Be Unconventional HQ** (Astro 7 static + `@astrojs/cloudflare`, Tailwind v4, deployed on Cloudflare Workers).

Branch under review: **`feature/ui-qa-polish`** (identical content on `claude/unconventional-hq-mobile-qa-bibyua`), targeting **`main`**.

Another agent (Claude) made these changes and has already tested them and returned a **GO**. Your job is **not** to agree with it. Your job is to try to **falsify** its claims and to find anything it missed. A second independent GO is what allows this to merge; a NO-GO with evidence is equally valuable and is the reason you are being asked.

Start by reading `CLAUDE.md` at the repo root. It encodes hard-won constraints (calendar dates as strings, the protected `HeroTrailer.astro`, no `overflow: hidden` above a YouTube iframe, never `iframe.src = ''`, no `filter: drop-shadow` on `<img>`, the three field classes in `videos.json`). **Several of these are landmines that a plausible-looking change can trip.** Check the diff against every one of them.

## What changed (the claims to falsify)

Review the full diff: `git log --oneline main..feature/ui-qa-polish` and `git diff main...feature/ui-qa-polish`.

The substantive claims are:

1. **iOS landscape dead-zone fixed.** A closed full-screen overlay could still receive touches, making the close button, nav, categories and article gallery untappable in landscape on iOS Safari. Claim: fixed by giving `.nav-container`, `.category-fullscreen-overlay` and `.contact-modal-overlay` `pointer-events: none` when closed / `auto` when open, removing `-webkit-overflow-scrolling: touch`, and moving the category overlay's scrolling to its inner content.
   *Claude could not run WebKit and verified this in Chromium only. This is the single highest-risk claim in the release — attack it hardest.*

2. **Mobile nav overlay** scrolls in landscape without trapping the user, while remaining exactly centred in portrait. Implemented with `justify-content: flex-start` + `margin: auto 0` on `.nav-list`, in a rule at `#navbar .nav-container .nav-list` specifically to outrank `#navbar nav ul { margin: 0 }`.

3. **Hover flicker fixed** on Instagram carousel tiles and in-article YouTube embeds, by splitting each into a static hover target plus an inner frame that owns the border/clip/lift. All hover states gated behind `@media (hover: hover) and (pointer: fine)`.

4. **Instagram rail labels are text, not tiles** — `.ig-rail-label` instead of `.ig-carousel-tile`, so they are excluded from the IntersectionObserver, the `.is-active` highlight and the tap-to-centre handler.

5. **Instagram carousel is topic-qualified.** A hub page's carousel renders only when enough posts genuinely match that hub. Matching is token/hashtag based (`src/lib/instagram-topic.ts`), keywords come from the hub document (`title` + `youtubeSyncKeywords`), and the minimum is `HUB_CAROUSEL_MIN_TILES = 7`, derived from the widest possible row.

6. **Featured hub row** now fills its wrapper and aligns with the Subscribe box, matching `/events` and `/feed`.

7. **Touch targets** below 24px expanded via an invisible `::before` overlay with **zero layout change**.

8. **Contact modal removed entirely** (component, layout mount, e2e suite, dead handler in `Layout.astro`, `#contact` default on `EventBookingCTA`). It was already unreachable; `/collaborations` and the press kit carry the `mailto:` instead.

9. **Lighthouse CI gate** now re-audits a sub-threshold page and takes the median of 3, because the gate was failing on runner noise (same commit passed as `push`, failed as `pull_request`).

## Swarm assignments

Run these as parallel agents. Each returns findings with **file:line evidence** and a reproduction. Do not fix anything you find.

**Agent 1 — iOS / mobile overlay correctness (highest priority).**
Read `src/styles/modules/responsive-mobile.css`, `landscape.css`, `filters.css`, `navbar.css`, and the overlay components. Ask: is there ANY remaining path where an invisible or closed element can cover content and absorb taps? Check every `position: fixed` full-viewport element on every page for a `pointer-events` guard. Check stacking contexts and `z-index` ordering with the menu open and closed. Check `100dvh` behaviour when iOS collapses the URL bar. Check the scroll-lock (`src/lib/scroll-lock.ts`) reference counting when two overlays open in sequence. If you can drive a real WebKit/Safari engine, do so — that is the one thing Claude could not do.

**Agent 2 — Instagram topic qualification.**
Read `src/lib/instagram-topic.ts`, `src/lib/instagram.ts`, `InstagramFeed.astro`, and both `[slug].astro` hub pages. Independently recompute, from `src/data/instagram.json` and `src/data/videos.json`, which posts qualify for DC, Marvel, SDCC and D23. Verify: DC renders NO carousel; Marvel renders 10 genuinely-Marvel tiles; no unrelated post can pad a short row; an empty keyword list qualifies nothing rather than falling through to the global feed; the homepage global rail is unaffected. Try to construct a caption that wrongly qualifies or wrongly fails.

**Agent 3 — Rendering, layout and responsive.**
Drive a browser over every route at 320 / 390 / 768 / 1440 / 2560 px, portrait and landscape. Look for horizontal overflow, clipped content, overlapping text, broken grids, and any layout shift. Confirm the Featured row aligns with the Subscribe box and that `/events` and `/feed` are unchanged. Confirm the mobile nav is centred in portrait and fully reachable in landscape at short heights (test 640x200 and 956x440 explicitly).

**Agent 4 — Regression hunt on the removal.**
The contact modal was deleted. Prove nothing depended on it: search for orphaned selectors, dead imports, dangling `#contact` links, `data-modal-trigger`, `aria-controls` pointing at a removed id, CSS for `.contact-modal-*` still shipping, and any e2e/unit test referencing it. Confirm `EventBookingCTA` renders a working link. Confirm the Turnstile lazy-loader still behaves for `SubscribeBox`, which shares that code path.

**Agent 5 — Performance and build integrity.**
Run `npm run build`, `npm test`, `npm run test:e2e`, `npx astro check`, `npm run lighthouse`, `npm run lighthouse:desktop`. Report every number. Scrutinise the Lighthouse gate change in `scripts/lighthouse-check.mjs` specifically: does the median-of-3 confirmation still fail a genuine, reproducible regression, or has it been weakened into a way to hide one? Verify the worst sample is what gets written to the report artifact. Confirm no new render-blocking resources and no CLS.

**Agent 6 — Accessibility and semantics.**
Keyboard-only pass over every overlay and the carousel: focus order, focus visibility, focus trapping, Escape handling, and whether focus returns correctly on close. Verify ARIA on the overlays, that the Instagram title label is not announced as interactive, and that the CTA link is. Check heading order and that every page has exactly one `<h1>` (note: `/category/*` are intentional `noindex` redirect shims and legitimately have none).

## Environment notes

- `npm ci` first. Node 22.
- The build is fully offline; article sync from Substack may fail without network and is designed to degrade to empty — that is not a defect.
- External image hosts (`cdninstagram.com`, `i.ytimg.com`, `wsrv.nl`) may be blocked in your sandbox. Broken images and `ERR_TUNNEL_CONNECTION_FAILED` console noise from those hosts are environmental, **not** site defects. Do not report them as findings; do note if they prevented you from verifying something.
- `npm run test:e2e` needs ports 4321/4323/4324/4325 free. Kill stray `workerd` / `astro preview` processes first.

## Required output

Report only. No code changes, no commits, no issues.

1. **VERDICT: GO or NO-GO** — state it in the first line.
2. **Confidence** (high / medium / low) and what would raise it.
3. **Blocking defects** — anything that must be fixed before merge. For each: file:line, reproduction steps, observed vs expected, and which of the 9 claims above it falsifies.
4. **Non-blocking findings** — ranked by severity.
5. **Claims you could NOT verify**, and why. Be explicit; a claim you could not test is not a claim you validated. In particular, say plainly whether you were able to test real iOS Safari.
6. **Disagreements with Claude's conclusions**, with evidence.
7. **Numbers**: build, `astro check`, unit, e2e, and both Lighthouse runs.

Be adversarial and specific. "Looks fine" is not a finding; neither is a defect without a reproduction. If you believe this is safe to merge, say GO and say why you are confident.
