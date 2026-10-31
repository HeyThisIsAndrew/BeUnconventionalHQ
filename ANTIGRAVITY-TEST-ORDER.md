# Antigravity test order: branch `fix/audit-redirects-event-links`

**Read this file and run the tests in it. It is a work order, not documentation.**
Do not edit or delete it: Claude removes it before this branch merges. Everything you
need is here; you do not need the conversation that produced it.

You are the TEST team for this change. **You do not fix anything.** Do not edit source files,
do not commit, do not push, do not open or merge PRs, do not run any sync or deploy script, and
do not trigger GitHub workflows. Your only output is the report described at the end. Claude
fixes whatever you prove.

Read `CLAUDE.md` (hard rules 3, 4, 11 and 12 especially) and `GEMINI.md` before starting.
Follow GEMINI.md's cleanup rule: no scratch files, logs or temp scripts left in the workspace.

---

## The standard of proof (read twice)

This repo's history (see `ANTIGRAVITY-WORKLIST.md`): past review swarms here were strong at
finding bugs and weak at proving them. Two of five "P0 blockers" in one review were not bugs,
and one contrast figure was simply wrong. So:

- A result is **CONFIRMED** only if it reproduced **twice from a fresh page load**, a
  **control run** behaved differently, and the report carries the evidence (timestamped
  console log, screenshot or screen recording, exact URL, viewport, browser).
- **NOT REPRODUCED**: you ran the exact steps at least twice and it did not happen.
- **NOT TESTED**: you could not run it as written (no real device, network blocked, etc).
  Say why. **Never substitute an emulator or a guess and report it as tested.**
- No severity labels without evidence. No "probably", no "might". Measure it or mark it NOT TESTED.
- A dedicated **Verifier** (Lane D) re-runs every CONFIRMED claim from scratch before it
  goes into the final report. Anything the Verifier cannot reproduce is downgraded.

---

## Environments

- **Production** (`https://beunconventionalhq.com`) runs `main`. It does NOT have this branch.
  Use it only for Lane A (the bug exists on `main` too) and as the "before" side of comparisons.
- **Branch build, local**: `git fetch origin && git checkout fix/audit-redirects-event-links`,
  then `npm ci && npm run build && npm run preview`. It serves at `http://localhost:4321`.
  Kill any orphaned `workerd`/`wrangler` first if the port is busy. Real network access is
  required: YouTube must load or Lane A is NOT TESTED.
- Browsers: desktop Chrome at 1440x900 is the baseline. Also run Lane B's click checks at a
  390x844 phone viewport. A real iPhone is only for Lane C; if none is available, Lane C is
  NOT TESTED. Say so, don't emulate.

---

## The swarm

Run Lanes A, B and C in parallel. Lane D runs last, over everything A to C confirmed.

### Lane A: Does the trailer's timer cut off a video the reader chose? (primary)

**Hypothesis (unverified, from reading the code):** on a hub or event page with a trailer,
the trailer plays muted in the stage and `reveal()` arms a teardown timer of
`HUB_RUN_MS = 42000` ms. If the reader starts their OWN video from the Coverage grid while
that timer is armed, the video reuses the same iframe and nothing clears the timer. So
~42s after the trailer first appeared, `teardown()` sets the frame to `about:blank` and
fires `hub:stage-idle`, killing the reader's video mid-play. The code is in
`src/pages/featured/[slug].astro` (`initHubStage`: `reveal`, `teardown`, `clearAll`) and the
same block in `src/components/EventAnnouncement.astro` and `EventFeatured.astro`.

Pages (both templates that are live):

- `/events/avengers-doomsday-premiere` (EventAnnouncement, has a trailer)
- `/featured/warner-bros` (hub template, has a trailer)
- `EventFeatured.astro` has no live page right now (no event uses `layoutMode: featured`).
  Report it as NOT TESTED; do not invent a way in.

Paste this into DevTools immediately after the page loads (times are seconds since navigation):

```js
(() => {
  const t = () => (performance.now() / 1000).toFixed(1) + 's';
  const stage = document.querySelector('.hub-stage');
  const frame = stage?.querySelector('.hub-stage-iframe');
  if (!stage || !frame) return console.log('NO STAGE/FRAME on this page');
  new MutationObserver(() => console.log(t(), 'stage:', stage.className))
    .observe(stage, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => console.log(t(), 'frame src:', frame.src.slice(0, 100)))
    .observe(frame, { attributes: true, attributeFilter: ['src'] });
  stage.addEventListener('hub:stage-idle', () => console.log(t(), 'EVENT hub:stage-idle'));
  console.log(t(), 'watching');
})();
```

**Run A1, the bug run:**

1. Fresh tab, desktop 1440x900. Paste the snippet. Do not click anything.
2. Wait for the trailer to appear (`stage:` gains `is-playing`). Note that time as T0.
3. Within 10s of T0, scroll to COVERAGE and click a **video** card (not an article) whose
   video is longer than 90 seconds. The stage scrolls up; `is-chosen-video` appears and the
   frame src changes to that video. Confirm it is actually playing.
4. Do not touch the page for 90 seconds.
5. **Bug signature:** at ~T0 + 42s, `frame src: about:blank` and `EVENT hub:stage-idle` are
   logged while you were watching your chosen video, and it disappears. Record the exact times.

**Run A2, the control:** same page, fresh tab, but wait until the trailer has ended on its
own (`hub:stage-idle` logged, or T0 + 50s) BEFORE clicking the video card. The chosen video
should play uninterrupted for 90 seconds. If A1 fails and A2 passes, the timer is the cause.

**Run A3, the rail:** repeat A1 but start the video from the **rail** under the stage
(the row of thumbnails) instead of the Coverage grid. Report whether it behaves the same.

**Run A4, natural end:** start a SHORT chosen video (under 40s, after the trailer has ended)
and let it finish. Report what the stage does when it ends (frame src, class, which rail
item becomes active). Report this as an observation, not a bug: the owner decides.

Repeat A1 and A2 on both pages, on production AND the local branch build (four page and
environment pairs). If YouTube refuses to play (sign-in wall, "video unavailable"), the
run is NOT TESTED; note which video id.

### Lane B: Regression sweep of this branch (local branch build only)

Each item: PASS or FAIL, with the URL, viewport and a screenshot for any FAIL.

**B1. Coverage article cards are never dead** (the fix in this branch). On EVERY page under
`/events/*` and `/featured/*` (enumerate them from `dist/client`), at 1440x900 and 390x844:
click each article card in the COVERAGE section. PASS = the stage scrolls into view and shows
that article with a "Read" button whose href is that article, and clicking Read opens it.
Critical case: `/events/la-comic-con-2026` (no trailer, articles only). It was completely
dead on `main`. Confirm on production that it is still dead there (expected, `main` has the bug).

**B2. A picked article is not swapped out.** On `/featured/warner-bros` and
`/events/avengers-doomsday-premiere`, desktop: load, click a Coverage ARTICLE card within 2s,
then wait 15s without touching anything. PASS = the stage still shows that article at 15s.
(On `main` it jumped to the rail's first item ~8s after load.)

**B3. Idle behavior unchanged.** Load each of those two pages and touch nothing for 60s.
PASS = once the trailer ends, the rail's FIRST item becomes active. `/events/la-comic-con-2026`
must NOT auto-select anything (it rests on its key art by design).

**B4. Official Event Hub card.** On `/intel/the-game-awards-2026-tickets-on-sale`,
`/intel/la-comic-con-2026` and `/intel/why-im-actually-hyped-for-avengers`: an
"OFFICIAL EVENT HUB" card in the right rail (desktop) or stacked under the article
(phone), linking to `/events/the-game-awards-2026`, `/events/la-comic-con-2026` and
`/events/avengers-doomsday-premiere` respectively, showing the event's logo. On the Avengers
article it sits directly under the "OFFICIAL FRANCHISE HUB" (Marvel) card. Spot-check 3 other
articles: they must have NO event card. Each event page's COVERAGE must list the article
that links to it (the link is two-way by design).

**B5. Homepage hero links to articles.** On `/`, every hero accordion panel's headline links to
its own story: an article to `/intel/<slug>` with a "Read · N min read" button, a video to
`/feed?play=<id>` with a "Watch" button. **No hero panel may link to `/events/...`.**

**B6. Redirects.** Against the local preview, `curl -sI` each of the following and record the
status code and `Location`. Each must be **301** with exactly this target. Then open each in
the browser and confirm where it lands, including the fragment:

- `/contact` → `/collaborations`
- `/privacy-policy` → `/privacy`
- `/ethics` → `/collaborations/press-kit#editorial-standards` (lands on the EDITORIAL STANDARDS list)
- `/author/andrew` → `/author/andrew-baxter`
- `/masthead` → `/about#masthead` (lands on MASTHEAD / INSIDE THE HQ, not hidden under the navbar)

Also confirm none of the five appear in `/sitemap-0.xml`.

**B7. Footer, privacy and subtitle.**

- Footer EXPLORE has a "Contact" link to `/collaborations#contact` that lands on the
  "Contact Information" card. On a 390px phone the seven links show as two rows of three
  with CONTACT centered on a third row, nothing clipped.
- `/privacy` has a "Contact Inquiries" section referencing press@beunconventionalhq.com, and
  the page contains no "Resend" and no "contact form".
- The newsletter subtitle reads "...from BE Unconventional HQ." with NO space before the period.

**B8. Automated suites** (report pass and fail counts verbatim, do not summarise):
`npm test`, `npx astro check` (must be 0 errors / 0 warnings / 0 hints), `npm run build`,
`npm run test:dist`, then `node scripts/e2e-tap-targets.test.mjs`,
`node scripts/e2e-event-hero-layout.test.mjs` and `node scripts/e2e-hero-rotation.test.mjs`,
one at a time, killing `workerd`/`wrangler` between them (each starts its own server on 4321).

### Lane C: Real iPhone (only if a physical iPhone is available)

CLAUDE.md names the muted fallback as "the path to test on a real iPhone". On iOS Safari,
on the local branch build (expose it on the LAN) or production for comparison:

1. `/events/avengers-doomsday-premiere`: tap a Coverage VIDEO card. Within ~3s it should either
   play with sound or reload muted and play. It must never sit on a dead frame.
2. `/events/la-comic-con-2026`: tap the Coverage ARTICLE card; the stage shows it with Read; tap
   Read and it opens the article.
3. Repeat Lane A run A1 on the phone.

If no physical iPhone: the whole lane is **NOT TESTED**. Do not use desktop emulation instead.

### Lane D: Verifier

For every CONFIRMED or FAIL from Lanes A to C: a different agent re-runs it from a fresh
browser profile, following only the written steps. If it does not reproduce, downgrade it
and say so. Also re-read each claim against "Do not report these" below and drop any match.

---

## Do not report these (deliberate decisions, not bugs)

- Event stages (EventAnnouncement and EventFeatured) have NO "Watch on YouTube" link. That
  was the owner's call (CLAUDE.md hard rule 11).
- `/events/la-comic-con-2026` does not auto-select a rail item; it rests on its key art.
- Coverage cards on event and hub pages load into the stage (scroll up plus a Read button)
  rather than navigating directly. That is the intended behavior.
- The homepage Intel section links to articles; the hero also links to articles (B5).
- The muted grey text palette, em-dash-free copy, and anything in
  `scripts/astro-declined-features.md`.
- The footer link row at a 320px viewport already overran before this branch. You may note
  it as **pre-existing**, never as a regression.
- Third-party hosts failing in a sandbox (YouTube, Sanity CDN, wsrv.nl) are environment
  limits, not site bugs. Mark the affected checks NOT TESTED.

---

## Report format (paste it back in chat; do not commit it)

```
# Test report: fix/audit-redirects-event-links @ <commit sha>
Environment: <browser + version, OS, viewport(s), production / local, real device?>

## Lane A: trailer timer vs chosen video
Verdict: CONFIRMED | NOT REPRODUCED | NOT TESTED
| Page | Env | Run | T0 | Chosen video id | about:blank at | stage-idle at | Video cut? |
<one row per run, including controls>
Console logs: <the raw timestamped lines for each run>
Evidence: <screenshots / recording paths>

## Lane B: regression sweep
| Check | Result | URL | Viewport | Evidence / notes |
B1 ... B8 (B1 lists every page and card clicked; B8 lists every suite's raw counts)

## Lane C: iPhone
<results, or NOT TESTED + reason>

## Lane D: verifier notes
<each claim re-run: reproduced / downgraded, and why>

## Pre-existing issues observed (not regressions)
<optional>

## Not tested, and why
<every item you could not run as written>
```

Before finishing: delete every scratch file, log, temp script and screenshot you created
inside the repository (keep evidence only in Antigravity's own `scratch/` artifacts folder),
make sure `git status` shows a clean tree, and stop any preview or `workerd` processes you started.
