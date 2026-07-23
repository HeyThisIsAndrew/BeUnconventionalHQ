# YouTube → live-site automation: test plan

Written 2026-07-23 in response to a real scenario: uploading long-form SDCC
coverage (tagged as an event, covering DC) from the convention floor, with
zero manual site work afterward. This doc is the verification gate before
`integration/youtube-local-astro7` merges into `main` — nothing here touches
production.

**Branch state this was written against:** `integration/youtube-local-astro7`
/ `claude/unconventional-hq-handoff-semzlc`, commit `18c3b93`+. **`main` does
not have any of this yet** — no `videos.json`, no Local CMS, no
`sync-youtube.mjs` local-JSON pivot. Nothing in this doc is live until that
merge happens, separately, with explicit sign-off.

⚠️ **`scripts/youtube-sync.md` is stale** — it documents the old
Sanity-writing pipeline (write tokens, Studio review, chunked commits). The
current `scripts/sync-youtube.mjs` writes straight to `src/data/videos.json`
and has none of that. Trust this doc and the code, not that one, until it's
rewritten.

---

## 1. The design question: "does this make sense?"

Yes, with one correction: **a rebuild always happens** — this is a static
site, so a new video can't appear without one. What changes is *who* triggers
it. Today: you, manually. After this: a scheduled job does it, and only when
there's an actual new video, so you never touch a keyboard at the con.

```
Upload + tag on YouTube
        │
        ▼
GitHub Action (cron, every 15 min) — .github/workflows/sync-youtube.yml
        │  runs `npm run sync -- --execute`
        │  cost: ~2-4 YouTube quota units per run (playlistItems + videos.list)
        │  — trivial against the 10,000/day free tier, even every 15 min
        ▼
src/data/videos.json changed? ──no──▶ exit, no commit, no rebuild triggered
        │ yes
        ▼
git commit + push to main (bot commit)
        ▼
Cloudflare git-connected Workers Build (already configured) auto-deploys
        ▼
Live on the site — no human action after the YouTube upload
```

The real constrained resource isn't YouTube quota (cheap, verified below) —
it's Cloudflare build minutes, which is why the Action only commits (and
therefore only triggers a deploy) when the sync actually produced a diff.
Polling every 15 minutes costs nothing extra on quiet days because it's a
no-op commit-free run.

**During a live event**, if 15 minutes isn't tight enough, temporarily edit
the cron in `.github/workflows/sync-youtube.yml` to `*/5 * * * *` and push —
quota headroom supports it easily (see §3). Revert after.

---

## 2. The tagging checklist — read this before SDCC

This is the part most likely to bite you at the convention, verified against
the real matching code (`scripts/sync-youtube.mjs`, `matchVideoTags`):
matching is **exact, per-tag, normalized** (case/punctuation-insensitive, but
each YouTube tag is checked as a whole unit — no substring or partial match).

For a long-form video to auto-publish **and** appear on both the SDCC event
hub and the DC featured hub, it needs **all three** of these, as separate
YouTube tags:

| Purpose | Tag (any one works) |
|---|---|
| Tier-1 category (**required for auto-publish**) | `event`, `events`, or `convention` |
| SDCC hub | `SDCC 2026`, `sdcc-2026`, `sdcc2026`, `san diego comic-con 2026`, or `san diego comic con 2026` |
| DC hub | `dc`, `dc comics`, `dcu`, or `dc universe` |

**The gotcha, confirmed by direct testing (§4, Test 2):** tagging only
`SDCC 2026` + `DC` — without an explicit `event`/`events`/`convention` tag —
correctly assigns both hubs, but produces **zero Tier-1 topic match**. That
means `contentStatus` stays `needs-review` and the video is invisible
*everywhere*, including the SDCC and DC hub pages, until someone manually
promotes it in the Local CMS. Hub-tagging alone is not enough — always
include a Tier-1 tag.

**Minimum safe tag set for any SDCC/DC video:** `event`, `SDCC 2026`, `dc`
— plus whatever else you'd naturally tag it with.

Also required for it to land as a regular video (not a Short, not excluded
from the DC hub): upload it through YouTube's normal long-form flow, not the
Shorts creator. `isShort` is verified by a live ping check against
`youtube.com/shorts/<id>`, not just duration, so this should be reliable —
but worth a spot-check on the first real upload (§5).

---

## 3. Quota math (why 15-minute polling is safe)

Per run, `scripts/sync-youtube.mjs` costs:
- `channels.list` (1 unit) + `playlistItems.list` (1 unit per 50 uploads) —
  fetches the upload list
- `videos.list` (1 unit per 50 video ids) — fetches details for all of them

For a channel with a few hundred videos, that's roughly 4-8 units per full
run. Free tier is 10,000 units/day. Running every 15 minutes = 96 runs/day =
well under 1,000 units/day even on the high end. There is headroom to run
every 5 minutes during an event without any real risk — the number to
actually watch is Cloudflare build minutes, gated by the commit-only-on-diff
logic in the workflow.

(This is unrelated to and much cheaper than `/api/live-status.json`'s
`search.list` calls at 100 units/call — those stay separately CDN-cached and
this workflow doesn't touch them.)

---

## 4. Tests already run and verified (by Claude, 2026-07-23)

These used the real pure functions from `scripts/sync-youtube.mjs` — not
guesses — against a scratch copy of `videos.json` that was restored
byte-identical afterward (`git diff --stat src/data/videos.json` confirmed
clean).

### Test 1 — Correctly-tagged video auto-publishes and appears everywhere

Synthetic video, tags `['SDCC 2026', 'DC', 'event']`, run through the real
`matchVideoTags` + `planVideoSync`:

```
contentStatus: "published"
topics: ["events"]
hubs: ["sdcc-2026", "dc-comics"]
requiresReview: false
```

Injected at the front of `videos.json` (matching real sync order — YouTube's
uploads playlist returns newest-first) and built with `npm run build`.
Verified present in the built HTML output:

| Surface | Result |
|---|---|
| Homepage "Latest Videos" (top 3) | ✅ FOUND |
| `/feed` (all content) | ✅ FOUND |
| `/feed/events` | ✅ FOUND |
| `/events/sdcc-2026` (SDCC hub coverage) | ✅ FOUND |
| `/featured/dc-comics` (DC hub coverage) | ✅ FOUND |

**Verdict: PASS.**

### Test 2 — Under-tagged video (hub tags, no Tier-1 tag) stays hidden

Same setup, tags `['SDCC 2026', 'DC']` (no `event` tag):

```
contentStatus: "needs-review"
topics: ["uncategorized"]
hubs: ["sdcc-2026", "dc-comics"]
requiresReview: true
```

Built and checked the same 5 surfaces — **correctly absent from all of
them**, confirming the review gate holds even when hub-matching succeeds.

**Verdict: PASS** (this is the review safety net working as designed, not a
bug — flagging it so it isn't mistaken for one, and so the tagging checklist
in §2 gets followed).

### What these tests do NOT cover

- A real YouTube upload / real API credentials (I don't have access to
  either in this environment).
- The GitHub Action itself actually firing, committing, and Cloudflare
  actually redeploying off that commit.
- `main`, since none of this is merged there yet.
- Homepage ordering reliability at scale — see §6.

---

## 5. Tests for Antigravity (or the owner) to run and report on

Run these against `integration/youtube-local-astro7` — none of this needs
`main`. Fill in ✅/❌ + notes as you go; that filled-in copy of this table is
the report requested.

### A. Workflow secrets

- [ ] Confirm `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` exist as repo
      Actions secrets (Settings → Secrets and variables → Actions). If not,
      add them — same values as your local `.env`.

### B. Dry-run via workflow_dispatch (no writes)

- [ ] Actions tab → "Sync YouTube videos" → Run workflow → select branch
      `integration/youtube-local-astro7` → uncheck "Write videos.json" →
      Run.
- [ ] Expected: job succeeds, logs show the dry-run summary (`[dry-run]
      Would sync N docs...`), **no commit appears** on the branch.

### C. Real execute run via workflow_dispatch

- [ ] Same as B but leave "Write videos.json" checked.
- [ ] Expected: if there are new/changed videos, a bot commit
      (`github-actions[bot]`) appears on `integration/youtube-local-astro7`
      titled "chore: automated YouTube sync". If nothing changed, job exits
      cleanly with no commit — confirm no-op behavior is silent (no spurious
      commit).

### D. Real-world upload test (the actual SDCC dry run)

- [ ] Upload a real long-form test video to the channel (unlisted is fine),
      tagged exactly `event`, `SDCC 2026`, `dc` (plus whatever else).
- [ ] Trigger the workflow (or wait for the next scheduled run).
- [ ] Confirm the resulting `videos.json` entry has `contentStatus:
      "published"`, `topics: ["events"]`, `hubs` containing both
      `sdcc-2026` and `dc-comics`.
- [ ] Run `npm run build` locally (or `npm run preview`) against that
      commit and confirm the video appears on all 5 surfaces from §4,
      Test 1.
- [ ] Repeat with a deliberately under-tagged upload (only `SDCC 2026`) and
      confirm it lands in `needs-review` and stays off all 5 surfaces —
      matching §4, Test 2.

### E. Inert-when-unconfigured check

- [ ] Temporarily rename/remove one secret (or test in a fork without them)
      and confirm the job logs a skip and exits green rather than failing —
      matches the `daily-rebuild.yml` convention.

---

## 6. Known risk to watch, not yet fully hardened

**Homepage "Latest Videos" ordering is implicit, not explicit.**
`src/pages/index.astro` does `(await getVideosUnified()).slice(0, 3)` with no
sort — it relies on `videos.json`'s array order already being newest-first,
which holds *only* because `sync-youtube.mjs` re-fetches the full uploads
list every run (YouTube's uploads playlist is newest-first) and writes synced
docs in that order. `/feed` and `/feed/events`, by contrast, explicitly sort
by `publishedAt`/`date` and don't have this dependency.

This isn't broken today, and Test 1 above confirms the new video did land in
the top-3 homepage slice — but it's a implicit assumption, not a guarantee.
If this matters enough to harden before SDCC, the fix is a one-line explicit
sort in `index.astro` rather than relying on array order. Flagging it here
rather than fixing silently, since it's a design call for whoever's
comfortable with the risk before the branch merges.

---

## 7. Before touching `main`

None of the above requires a production merge. Once §5's checklist is fully
green (and the owner is comfortable), the separate, explicitly-confirmed
next step is: merge `integration/youtube-local-astro7` → `main`, verify
Cloudflare deploys it, confirm the live site matches everything tested here,
*then* let the scheduled cron (which only fires on the default branch)
actually go live.
