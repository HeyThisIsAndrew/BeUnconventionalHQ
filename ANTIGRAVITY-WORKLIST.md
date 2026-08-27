# Antigravity work order

**Read this file, do the work, then delete this file in your final commit.** It is a
work order, not documentation. If it is still in the repo, the work is not finished.

Everything you need is here. You do not need the conversation that produced it.

---

## Your lane, and why it is this one

You and Claude are splitting the backlog so two agents can work without colliding.
The split is **not by difficulty** — it is by **what happens when the agent is wrong**.

You get work where being wrong is **visible and cheap**: a string that is obviously
still the old string, an article that reads badly, a page that plainly does not load.

Claude keeps work where being wrong is **invisible until a real user hits it**: gesture
timing, CSS cascade and specificity, focus management, anything whose failure only
shows on a device or a slow connection.

This is based on what actually happened in this repository, not on any general claim
about models. The full evidence is in issue #153. The short version: your six-lane
review of PR #144 found three genuine defects nobody else had — the deck rail's
keyboard gap, `--color-accent` used as text, and a missing `decoding` attribute. All
three shipped as fixes. In the same review, two of five "P0 blockers" were not bugs,
a contrast ratio was reported as 4.41:1 when it is 3.21:1, a deliberate
`transition-duration: 1ms` was flagged as a defect, and a 77% score was quoted from a
stale local artifact while a fresh run gave 96%. Separately, the trackpad gesture code
shipped twice with bugs the owner reported from his own phone.

Strong at finding. Weaker at proving. So the rules below are all about proving.

---

## Do these, in this order

### 1. #146 — rename "Gaming" to "Games" site-wide  ← start here

The highest-value item in your lane and the best fit: the work is fully enumerable and
the acceptance test is trivial.

**Read the ticket first.** It lists all ten call sites with file and line. Do not
discover them again; do not add sites it does not list without saying why.

Two things it is easy to get wrong:

- **The data must migrate with the code.** `'Gaming'` is compared by string equality
  and also stored in `src/data/articles.json` and `src/data/videos.json`. Change the
  code without the data and the category silently empties.
- **`/category/gaming` is a live indexed URL** and is in the sitemap. It needs a 301 to
  `/category/games`, the redirect stub must **not** carry `noindex`, and the sitemap
  must list only the new URL.

**Do not touch Google Search Console.** That is Andrew's, and it is listed in #145.

### 2. Content tickets — 18 open

`#94, #97, #98, #99, #100, #101, #102, #103, #104, #105, #106, #107, #108, #109, #110,
#111, #112, #113`

Zero blast radius, and long-form drafting is where you are strongest. Highest priority
first: **#94, #100, #101, #112** are `priority: high`. **#105 is PARKED — skip it.**

Two house rules that are easy to miss:

- **No em dashes in anything a reader sees.** Headings, body, alt text, meta
  descriptions. Split into two sentences or use a comma or colon. Code comments are
  exempt. This is in `CLAUDE.md` and it is not negotiable.
- **Release dates, casting and box-office numbers need a source, not recall.** Getting
  a date wrong in an entertainment publication is the one error readers punish.

### 3. #52 — TikTok cross-posting *(only if 1 and 2 are done)*

Mostly API integration and endpoint enumeration. No shared UI, so it cannot break
anything else.

---

## Do not touch these

Not a judgement — these are the files where a plausible-looking change has already
shipped a bug more than once, and where the failure is invisible in review.

| | |
|---|---|
| `src/components/Navbar.astro` | `transition:persist`, global. Owner: *"the last time we worked on Navbar, it broke severely."* |
| `src/pages/featured/index.astro` — gesture and deck code | Three separate gesture bugs have shipped from this file |
| `src/pages/featured/[slug].astro` — stage lifecycle | Trailer arming, teardown and handover are timing-sensitive |
| `src/components/HeroTrailer.astro` | `CLAUDE.md` hard rule 2. Do not change its lifecycle at all |
| `.github/workflows/*` | Five workflows push to `main`; a mistake here breaks content sync |
| `astro.config.mjs` redirects and sitemap | Except the one `/category/gaming` redirect #146 needs |
| `#71`, `#138`, `#151` | Claude's, for the reasons in #153 |
| `#131`, `#145` | Andrew's. #131 he wants to learn himself, not be handed |

---

## How to prove your work — this is the part that matters

Five rules, each written because of a specific thing that went wrong.

1. **Verify against the codebase, not against a description of it.**
   Two of five P0s in the last review came from reading prose as fact. A summary said
   four routes were gated; the real list in `astro.config.mjs` had six. Open the file.

2. **Compute, do not recall.**
   Contrast ratios, package counts, timings, dates. `4.41` vs `3.21` was the difference
   between "passes" and "fails", and it changed a verdict.

3. **A stale artifact is not a measurement.**
   `.lighthouse-reports/` is gitignored and local. If you did not just generate it, it
   is not evidence.

4. **Say what you could not test.**
   A lane that silently skipped something and reported a pass is worse than one that
   reported a fail. Sandboxes here cannot reach `substackcdn.com`,
   `challenges.cloudflare.com`, `cdn.sanity.io` or YouTube — if that blocked you, say so
   rather than reporting a number you did not really get.

5. **Separate "broken" from "broken by this change."**
   None of the five P0s in the last review were caused by the PR under review. Check
   `git diff origin/main...HEAD -- <file>` before calling something a regression.

---

## Definition of done

Before you open a PR, all of these:

```sh
npm test          # must pass; 432 assertions as of this writing
npx astro check   # must be 0 errors, 0 warnings, 0 hints — that is the baseline
npm run build     # must complete
```

`astro check` passing is **not** proof the file compiles. An Astro-style comment placed
inside a `.map()` callback's `return (` passes `astro check` and fails `npm run build`.
Run the build.

Then:

- [ ] One PR per ticket. Do not batch #146 with content work
- [ ] The PR body says what you changed, what you verified, and **what you could not**
- [ ] For #146: paste the output of `grep -rn "Gaming" src/` showing what remains and why
- [ ] For #146: confirm `/category/gaming` 301s and that the stub has no `noindex`
- [ ] `git diff --stat origin/main...HEAD` — if it touches a file in the do-not-touch
      table, stop and say so instead of pushing
- [ ] **Delete this file** in your final commit

---

## If you get stuck

Say so in the ticket rather than working around it. A blocked item reported honestly
costs an hour. A guess that looks finished costs a day, and someone has to find it
first — which is what happened with the `/media-kit` false positive.
