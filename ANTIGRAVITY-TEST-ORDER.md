# Antigravity test order: PR #295, branch `fix/audit-redirects-event-links`

**Read this file and run the tests in it. It is a work order, not documentation.**
Do not edit or delete it: Claude removes it before this branch merges. Everything you
need is here; you do not need the conversation that produced it.

You are the TEST team. **You do not fix anything.** Do not edit source files, do not
commit, push, open, merge or close PRs, do not run sync, deploy or media-kit scripts,
and do not trigger GitHub workflows. Your only output is the report at the end.

Read `CLAUDE.md` (hard rules 3, 4, 11 and 12) and `GEMINI.md` first. Follow GEMINI.md's
cleanup rule: nothing you create may be left in the repository.

---

## Why this run exists

1. **The owner cannot see the new `/ethics` page** on the branch preview. The branch
   builds it (`src/pages/ethics.astro`) and Cloudflare reports the preview deployed.
   Leading hypothesis, unverified: earlier commits on this branch made `/ethics` a
   **301** to `/collaborations/press-kit#editorial-standards`, and browsers cache 301s
   indefinitely, so a browser that visited it then still jumps to the press kit
   without asking the server. Lane A decides this with evidence.
2. **CI `test-and-build` failed** on `72ad66c`: `scripts/article-sync.test.mjs`, "429
   partial failures retain completed posts…". Claude traced it to a race in
   `scripts/substack-relay.mjs` (articles joined the download queue in async completion
   order, not RSS order), fixed it in `65f916e`, and measured 200/200 local passes
   against 4/40 failures before. Lane D re-proves that independently.
3. A full regression pass over everything else in the PR (Lane C), because the owner
   asked for proof that nothing broke.

---

## Standard of proof

- **CONFIRMED / PASS** needs the exact URL, the command or steps, the raw output
  (headers, status codes, console lines) or a screenshot, the browser and viewport,
  and for anything failing, a second fresh reproduction.
- **NOT REPRODUCED**: ran exactly as written at least twice; it did not happen.
- **NOT TESTED**: could not run it as written. Say why. Never substitute an emulator or a
  guess and report it as tested.
- No severity words without evidence. Lane F re-runs every FAIL before it is reported.

---

## Environments

- **Commit preview (use this first).** The Cloudflare bot comment on PR #295
  ("Deploying with Cloudflare Workers") lists a **Commit Preview URL** for the newest
  commit, e.g. `https://<8 hex chars>-beunconventionalhq.heythisisandrewb.workers.dev`.
  Its hostname is new for each commit, so **no browser can have a cached redirect for
  it**. Record which commit it says it deployed; it must be `65f916e` or later.
- **Branch preview:** `https://fix-audit-redirects-event-links-beunconventionalhq.heythisisandrewb.workers.dev`
- **Production:** `https://beunconventionalhq.com` runs `main`, which does NOT have this PR.
  Use it only as "before".
- **Local build:** `git fetch origin && git checkout fix/audit-redirects-event-links`,
  `npm ci && npm run build && npm run preview` → `http://localhost:4321`. Kill orphaned
  `workerd`/`wrangler` first if the port is busy.
- Browsers: Chrome desktop 1440x900, plus 390x844 and 360x800 where stated. Use a **fresh
  profile or incognito window** for every Lane A check.

Run Lanes A to E in parallel. Lane F runs last.

---

## Lane A: Is `/ethics` deployed, and why can't the owner see it? (primary)

A1. With curl (no browser cache involved), on the commit preview, the branch preview and
production:
```
curl -sS -o /dev/null -D - "<host>/ethics"         | head -20
curl -sS -L -o /dev/null -w '%{http_code} %{url_effective}\n' "<host>/ethics"
curl -sS "<host>/ethics" | grep -o '<h1[^>]*>[^<]*</h1>'
curl -sS -D - -o /dev/null "<host>/_redirects"
```
Expected on both previews: **200, no `Location` header**, `<h1>` contains `ETHICS POLICY`.
Expected on production: 404 (not merged yet). Record exactly what each returned.

A2. Fresh incognito window, desktop 1440x900, open `<commit preview>/ethics`. Record the
final URL in the address bar and screenshot the top of the page. PASS =
- the URL stays `/ethics` (no jump to `/collaborations/press-kit`);
- the title "ETHICS POLICY" and "LAST UPDATED: OCTOBER 2026" are fully visible, **not
  under the navigation bar**;
- the page looks like `/privacy` (same dark card, heading sizes, red bullets).

A3. Same at 390x844.

A4. **The cached-redirect test.** Use a profile that has browsed the branch preview
before, if one exists (the owner's own browser is the real case). Open DevTools → Network,
leave "Disable cache" OFF, and load `<branch preview>/ethics`: record the final URL and
whether the `/ethics` row says `301` with `(from disk cache)` / `(memory cache)`. Then tick
"Disable cache" and reload: record the final URL again. If the first load lands on the
press kit from cache and the second lands on `/ethics`, the hypothesis is CONFIRMED. If
no such profile exists, this check is NOT TESTED (a fresh profile cannot show it).

A5. If A1 shows the previews really do return a redirect or a 404 for `/ethics`, that is a
deploy problem, not a cache problem: record the `build-sha` meta on the preview home page
(`curl -sS <host>/ | grep -o 'name="build-sha" content="[0-9a-f]*"'`) and the commit
the Cloudflare comment claims, and stop Lane A there.

A6. Content of `/ethics` (from any working load). PASS =
- a bulleted "Our Editorial Standards" list with these five lines, word for word:
  "Editorial independence on all coverage", "Full disclosure of provided materials",
  "Embargo terms honored in writing", "Corrections issued on the record",
  "Direct contact for press and publicists";
- then one section headed with each of those five lines, in that order;
- then "Affiliate Links & Sponsorships" and "Advertising" sections;
- exactly one `<h1>`; `<title>` is `Ethics Policy | BE Unconventional HQ`;
- `/ethics` appears in `<host>/sitemap-0.xml`;
- no em dash (—) anywhere in the page copy.

---

## Lane B: AdSense readiness, on the commit preview

B1. `/privacy`: has an "Advertising" section containing all of:
- "Third-party vendors, including Google, use cookies to serve ads based on your prior visits"
- "Google's use of advertising cookies enables it and its partners"
- a link to `https://adssettings.google.com`, one to `https://www.aboutads.info/choices`,
  one to `https://policies.google.com/technologies/partner-sites`, all with
  `target="_blank"` and `rel` containing `noopener`;
- "Last updated: October 2026"; the "PRIVACY POLICY" title visible, not under the navbar.

B2. `/ads.txt`: `curl -sS -D - <host>/ads.txt`. PASS = 200, `content-type: text/plain`,
body is **comment lines only** (starting `#`), because no publisher ID is set yet.

B3. CSP: `curl -sS -D - -o /dev/null <host>/ | grep -i content-security-policy`. PASS =
`script-src` includes `https://pagead2.googlesyndication.com`,
`https://*.googlesyndication.com`, `https://*.adtrafficquality.google`,
`https://fundingchoicesmessages.google.com`, `https://*.doubleclick.net`; `frame-src`
includes `https://googleads.g.doubleclick.net` and `https://*.googlesyndication.com`;
`script-src` does NOT contain `data:`; `frame-ancestors 'self'` and `object-src 'none'`
are unchanged. Also confirm the home page console shows **no new CSP violations**
compared with production (list any you see on each, side by side).

B4. No AdSense verification tag yet: `curl -sS <host>/ | grep -c google-adsense-account`
must be `0` (the publisher ID is intentionally empty).

B5. Footer bottom row on `/`, `/privacy`, `/ethics` at 1440, 390 and 360: reads
"Privacy Policy | Ethics Policy" on ONE line, both links work, nothing overflows the
viewport (`document.documentElement.scrollWidth === innerWidth`).

---

## Lane C: Full regression, on the commit preview

C1. **Footer Explore column**: exactly six links (Feed, Intel, Events, Featured, About,
Press / Media) in two rows of three; "Press / Media" → `/collaborations`. **No link with
"Contact" in its text or href anywhere in the footer.** At 360px: no wrapping, no overflow.

C2. **Redirects** (`curl -sS -D - -o /dev/null`), each **301** with exactly this target:
`/contact` → `/collaborations`; `/privacy-policy` → `/privacy`;
`/author/andrew` → `/author/andrew-baxter`; `/masthead` → `/about#masthead` (open it in a
browser: lands on MASTHEAD / INSIDE THE HQ, not hidden under the navbar).
`/ethics` must NOT be a redirect (Lane A).

C3. **Homepage Events tile**, desktop and 390. Today's date decides it (LA Comic Con runs
2026-10-30 to 2026-11-01, Los Angeles time):
- with the real clock: record what the Events tile shows and where it links;
- with DevTools → Sensors / or Playwright `page.clock.setFixedTime`, at noon Los Angeles on:
  2026-10-29 → article `/intel/la-comic-con-2026` ("Read · …");
  2026-10-31 → `/events/la-comic-con-2026` ("Explore Event", "Live now");
  2026-11-02 → article again; 2026-11-14 → `/events/twitchcon-san-diego-2026`;
- with JavaScript disabled → the article.
The Latest tile must always open `/intel/the-game-awards-2026-tickets-on-sale`.

C4. **Event-page article cards** (bug fixed in this PR): on every `/events/*` and
`/featured/*` page, at 1440 and 390, click each COVERAGE article card. PASS = the stage
scrolls into view showing that article with a "Read" button to it, and Read opens it.
Critical: `/events/la-comic-con-2026`. Compare with production, where it is dead.

C5. **Picked article stays put**: on `/featured/warner-bros`, click a COVERAGE article card
within 2s of load, wait 60s untouched. PASS = still showing that article.

C6. **Trailer timer** (fixed in this PR; real YouTube needed): on `/featured/warner-bros`
and `/events/sdcc-2026`, paste this into DevTools right after load:
```js
(() => {
  const t = () => (performance.now() / 1000).toFixed(1) + 's';
  const stage = document.querySelector('.hub-stage');
  const frame = stage?.querySelector('.hub-stage-iframe');
  if (!stage || !frame) return console.log('NO STAGE/FRAME');
  new MutationObserver(() => console.log(t(), 'stage:', stage.className)).observe(stage, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => console.log(t(), 'frame src:', frame.src.slice(0, 100))).observe(frame, { attributes: true, attributeFilter: ['src'] });
  stage.addEventListener('hub:stage-idle', () => console.log(t(), 'EVENT hub:stage-idle'));
  console.log(t(), 'watching');
})();
```
Wait for the trailer (`is-playing`) = T0; within 10s click a COVERAGE **video** card longer
than 90s; watch 90s. PASS = no `frame src: about:blank` and no `hub:stage-idle` while the
chosen video plays. Repeat starting the video from the rail under the stage. Run the same
on production as the "before" (it was cut at ~T0+45s there).

C7. **Article pages**: `/intel/la-comic-con-2026`, `/intel/the-game-awards-2026-tickets-on-sale`,
`/intel/why-im-actually-hyped-for-avengers` each show an "OFFICIAL EVENT HUB" card linking
to its `/events/<slug>`; on the Avengers article it sits under "OFFICIAL FRANCHISE HUB".
Spot-check two other articles: no event card.

C8. **Newsletter subtitle** on `/`: "…from BE Unconventional HQ." with no space before the
period. **Privacy** "Contact Inquiries" section mentions press@beunconventionalhq.com and
the page has no "Resend" and no "contact form".

C9. **Media kit** on production (already updated separately, not part of this PR):
`/media-kit` shows 625 YouTube subscribers, and
`/downloads/be-unconventional-hq-media-kit.pdf` reads "625 YOUTUBE SUBS".

---

## Lane D: CI and the flaky test (local, branch head)

D1. On the branch: run `node --test scripts/article-sync.test.mjs` **100 times** in a loop
and report the pass/fail counts verbatim. Then measure `main` the same way, OUTSIDE the
repository: `git worktree add /tmp/main-check origin/main`, `cd /tmp/main-check && npm ci`,
run the same 100-loop there, report its counts, then `git worktree remove /tmp/main-check`.
The before/after must be measured, not assumed (Claude measured main at 4 failures in 40).
D2. Verbatim results of: `npm test`, `npx astro check` (must be 0/0/0), `npm run build`,
`npm run test:dist`,
`npx astro-seo-audit@0.3.3 --dir dist/client --baseline .astro-seo-audit-baseline.json --fail-on error`,
then one at a time (kill `workerd`/`wrangler` between):
`node scripts/e2e-tap-targets.test.mjs`, `node scripts/e2e-event-hero-layout.test.mjs`,
`node scripts/e2e-hero-rotation.test.mjs`, `node scripts/e2e-featured-highlights.test.mjs`.
D3. The GitHub checks on PR #295 for the newest commit: list each check and its result.

---

## Lane E: Real iPhone (only with a physical iPhone)

On the **commit preview** in Safari (a new hostname, so no cached redirect):
`/ethics` (title visible, five standards), footer "Privacy Policy | Ethics Policy",
`/events/sdcc-2026` Coverage video tap (plays within ~3s, muted if Safari blocks sound,
never a dead frame), `/events/la-comic-con-2026` article card → Read opens the article,
homepage Events tile. No physical iPhone → Lane E is **NOT TESTED**; do not emulate.

---

## Lane F: Verifier

A different agent re-runs every FAIL and every CONFIRMED from Lanes A to E from a fresh
browser profile, following only the written steps. Anything that does not reproduce is
downgraded, with the reason. Then drop anything matching the list below.

---

## Do not report these (deliberate, not bugs)

- Event stages (EventAnnouncement, EventFeatured) have no "Watch on YouTube" link (owner's call, hard rule 11).
- `/events/la-comic-con-2026` does not auto-select a rail item; it rests on its key art.
- Coverage cards on event and hub pages load into the stage (scroll up plus Read) rather than navigating directly.
- The Featured section and the Latest tile do not switch to live events; only the Events tile does.
- No AdSense script or verification tag is present yet (the publisher ID is intentionally empty).
- The muted grey palette; anything in `scripts/astro-declined-features.md`.
- Third-party hosts unreachable from a sandbox (YouTube, Sanity CDN, wsrv.nl): mark NOT TESTED.

---

## Report format (paste it back in chat; do not commit it)

```
# Test report: PR #295 @ <commit sha>   (commit preview: <url>, Cloudflare says: <sha>)
Environment: <browser + version, OS, viewports, which hosts, real device?>

## Lane A: /ethics
A1 curl results per host (status, Location, h1) | A2/A3 screenshots + final URL |
A4 cached-redirect verdict: CONFIRMED / NOT REPRODUCED / NOT TESTED, with evidence |
A5 (only if reached) | A6 content checklist

## Lane B: AdSense readiness      | Check | Result | Evidence |
## Lane C: Regression              | Check | Result | URL | Viewport | Evidence |
## Lane D: CI                      raw counts, verbatim, before vs after for D1
## Lane E: iPhone                  results, or NOT TESTED + reason
## Lane F: Verifier                each claim re-run: reproduced / downgraded, why
## Pre-existing issues (not regressions)
## Not tested, and why
```

Before finishing: delete every scratch file, log, temp script and screenshot you created
inside the repository (keep evidence in Antigravity's own `scratch/` folder), make sure
`git status` is clean, and stop any preview, `workerd` or `wrangler` processes you started.
