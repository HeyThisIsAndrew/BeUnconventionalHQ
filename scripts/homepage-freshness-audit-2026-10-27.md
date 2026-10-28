# Homepage and publishing freshness audit

Audit date: October 27, 2026, Pacific time. Remote evidence includes runs dated
October 28 UTC. Findings were checked against origin/main and the live site,
not just the older local branch. This report records diagnosis and proposed
corrections; it does not represent a production fix or deployment.

## Confirmed findings

### 1. Substack publication detection and ingestion are still failing

The missing post is **Dune: Part Three Final Trailer: Denis Villeneuve Did in
Three Movies What Took Marvel 30**, post ID `222423842`, published October 27 at
6:45 p.m. Pacific (`2026-10-28T01:45:23.686Z`).

It is present in both the public posts API and RSS when fetched from the local
network. The API supplies the body and 11 tags. It is absent from main's
13-record articles.json snapshot, the live Intel archive, article Feed, RSS and
Dispatch feed.

The latest scheduled [article sync, run 40621423092](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40621423092)
started at 7:31 p.m. Pacific and failed:

- GitHub runner -> posts API: HTTP 403.
- GitHub runner -> owned relay: HTTP 502, reporting Substack HTTP 429 on /feed.
- GitHub runner -> direct RSS: HTTP 403.
- The existing snapshot was correctly preserved, but the new post was not imported.

The six most recent scheduled article runs failed; the last successful scheduled
run in the inspected history was October 26 at 20:40 UTC. The workflow is enabled
and configured hourly, but actual recent starts have also had multi-hour gaps.
It is not a dependable substitute for the currently blocked five-minute watcher.

A signed **dry-run** request to the deployed watcher returned:

    { "ok": false, "error": "Substack RSS poll failed: HTTP 429", "alerted": false }

No notification or publish dispatch was requested by this diagnostic. The
watcher cannot discover new posts when its feed fetch fails. Even when discovery
succeeds, watchSubstack() requires the full article source to warm successfully
before it calls the GitHub gateway. That is another gate at which blocked
Substack fetching prevents a publication-triggered GitHub run. No new
publication-triggered article run appears in the inspected history.

This is not evidence that GitHub's Run workflow UI is broken or that the workflow
is disabled. Scheduled runs start, then fail at source fetching. A manually
started run would still need a working source.

The [relay deployment run 40600153355](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40600153355)
was reported failed, but its code upload and Cron deployment actually succeeded.
The subsequent verification failed on upstream HTTP 429, including an article
page request. The previously merged cache/pacing changes therefore did deploy,
but have not restored reliable access from the cloud network.

A read-only run of the real article transformation and merge planner against
the locally available public API response produced:

- 13 existing records -> 14 records.
- 1 added, 0 updated, 0 skipped.
- Dune categorized as Film, with a complete sanitized body and all 11 tags.

A local import can recover this post as an immediate content change. That alone
would not repair unattended future publishing. The permanent fix must establish
and verify an upstream source reachable from the actual cloud execution network;
adding more retries or calling the same blocked source from another workflow
has not solved the observed failure.

Code: scripts/substack-watcher.mjs:46-59;
scripts/substack-relay.mjs:249-267; .github/workflows/sync-articles.yml.

### 2. Homepage Intel intentionally excludes the newest articles

The live homepage shows Clayface Review and L.A. Comic Con in its hero. Its Intel
magazine consequently opens on the older September 8 Lanterns article, although
Clayface is the newest successfully imported article (October 26).

The section's headlines are not hardcoded. The faulty behavior comes from a
hardcoded selection policy: each story is allowed one location on the homepage.
index.astro constructs a set of hero and Featured story keys, removes matching
articles, then selects four Intel stories. The lower-level homepage feed builder
has a second version of the same exclusion rule.

The IntelMagazine component itself opens on articles[0]; it is receiving an
already filtered list. Its center/rail switching is not what removes the latest
article.

Reproduction with the missing Dune post inserted into the article pool shows
Dune claimed by the Film hero, leaving Clayface as the next Intel lead. Therefore
repairing ingestion alone would still fail the requirement that the homepage
Intel section lead with the latest article.

Required correction: select the homepage Intel magazine from the latest eligible
articles independently of hero/Featured placement. If strict latest publication
order is intended, make that rule explicit alongside existing editorial weights.
Allow the newest article to appear in both its dedicated section and the hero.

Code: src/pages/index.astro:58-70; src/components/home/IntelSpread.astro;
src/lib/homepage-feed.ts:459-467 and its Intel allocation.

### 3. The HQ Is Watching is a leftover-video rail

The new Resident Evil video, `ckRQzrWBYVs`, was published at 7:00 p.m. Pacific.
[YouTube sync 40618502886](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40618502886)
and [production deploy 40618713666](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40618713666)
succeeded. The video appears in the live Feed and homepage Latest hero panel.

It is absent from Watching because the hero claims it first. Watching also
excludes the newest Lanterns episodes already claimed by Featured and Poison
Ivy already claimed by the TV hero. Its actual first item is the older October
26 “Don't Skip Clayface if you think it's Scary | PSA”. The visible results match
the code exactly; this is not a failed YouTube sync.

Required correction: select Watching's latest eligible long-form videos directly
by full publication timestamp, capped at the existing rail limit. Do not remove
a video because it also appears in the hero or Featured. Keep Shorts/live
eligibility rules and deduplicate within the rail itself. Keep the existing
player, card and scrolling design.

Code: src/lib/homepage-feed.ts:527-532; src/pages/index.astro:76-80.

### 4. Tests currently protect the conflicting rule

scripts/homepage-feed.test.mjs explicitly asserts that no story appears in two
sections. The Featured tests also assert reservation-based exclusions. Those
checks can pass while Intel and Watching omit every latest item. The previous
Featured work fixed the four-episode window while preserving and extending this
older homepage-wide exclusion behavior.

Required regression coverage should model consecutive real publishes and check:

- A new article becomes the Intel lead even when the hero or Featured shows it.
- A new video becomes Watching's first item even when the hero shows it.
- Lanterns episode rotation continues to work in Featured.
- Mixed Featured selections do not suppress the latest article/video shelves.
- Each section remains internally unique, bounded and correctly ordered.
- A real Substack publication reaches the snapshot and deployed article page
  from the cloud execution path, rather than relying only on mocked transports.

The one-story policy predates today's work: relevant homepage code was introduced
in September's V4 changes. Today's Featured change reserved its four items first,
which also keeps those four episodes out of Watching. The policy needs changing
at the section-selection level, not by hardcoding the current article/video IDs.

## What was ruled out / scope of impact

- PR #293 is merged (October 27, 4:09 p.m. Pacific), not waiting on a branch.
- Homepage, Intel, Feed, /feed/videos and /feed/articles serve build SHA
  `3f5faae8f4786482b8c9e3270042327166797a50`, matching current main during the audit.
  The current live symptoms are not an old production deployment/CDN build.
- YouTube ingestion and the latest production deployment succeeded.
- Featured currently remains explicitly set to Lanterns and opens on Episode 6.
- All public routes inspected returned HTTP 200; stale article content comes from
  the preserved snapshot, not an archive-wide page failure.
- RSS and Dispatch also lack Dune because they depend on that same snapshot.
  This audit does not assert that a newsletter broadcast was sent or should run.
- The local checkout remains on the previously merged repair branch and does not
  contain the newest main-only YouTube sync. Local previews must pull current
  content too; GitHub content sync does not update a laptop checkout automatically.
- Event authoring was excluded as requested.

## Recommended correction order

1. Recover the complete Dune article from the working local source, with its
   normal image stages, and publish it through a reviewable content change.
2. Make Intel and Watching independently reflect their newest eligible content;
   retain Featured's explicit series/mixed control and four-item rotation.
3. Repair and prove the cloud-accessible Substack ingestion/detection path. Keep
   visible failures and snapshot preservation; do not turn blocked syncs green.
4. Add cross-section publication regressions, then verify a real subsequent
   publication through detection, GitHub, snapshot update and production.
