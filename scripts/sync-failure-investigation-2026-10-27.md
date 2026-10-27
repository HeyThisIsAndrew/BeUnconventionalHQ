# Substack sync and CI failure investigation

Investigated October 26–27, 2026 (America/Los_Angeles). Repair branch:
`codex/fix-substack-sync-and-ci`, based on `origin/main` at `a4bcecd2`.

## Earlier chat and merge status

The pinned chat **Fix article sync failures** (chat ID
`01a1799f-08bb-7d41-b297-f950b41f3e9e`) contains the earlier investigation,
implementation, deployment and live checks. Git history and GitHub PR metadata
confirm all four changes reached main on October 26:

| PR | Main commit | Change |
| --- | --- | --- |
| [#288](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/pull/288) | bddbc9d0 | Complete post extraction, owned relay, visible sync failures, bounded YouTube probes |
| [#289](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/pull/289) | 2f5c7a90 | Five-minute publish watcher and alerts |
| [#290](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/pull/290) | aa43db38 | Worker fetch receiver and Actions-only dispatch token compatibility |
| [#291](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/pull/291) | 7b976ae2 | Shared one-minute RSS cache and existing sorted-feed fallback |

The previous final response cited successful tests/deployments and disclosed
the pre-existing image-priority CI failure. Those successful runs were real,
but they did not prove sustained operation after the complete-post cache
expired. Merging while that separate CI gate remained red also left repeated
failure notifications unresolved.

## Email audit and failure families

Read 38 matching messages since October 25, plus the separate intentional
watcher test email. Downloaded and inspected failed logs for all 32 unique
Actions runs referenced by the 33 failed-run emails (one run had an additional
attempt email).

| Messages | Finding |
| --- | --- |
| 23 CI notifications | Same built-site image-priority error in both test-and-build and e2e jobs; present on main before #288 |
| 8 development-branch article-sync notifications | Earlier experiments: relay route propagation 404, upstream rate limits/blocked sources, and a temporary syntax error; one email reports a rerun of the same run |
| 2 later main article-sync notifications | Relay article pages return 429; direct API and RSS return 403 on GitHub runners |
| 1 watcher failure email | Native Worker fetch called with incorrect receiver; already corrected in #290 |
| 4 other matching GitHub messages | Cloudflare deployment comments, not failure notifications |
| 1 additional intentional test email | Approved watcher alert test from the earlier chat |

The large CI volume comes from repeated pushes, PR events and main merges
re-running the same deterministic failure. Each CI run can have two failing
jobs for the same issue. A warning such as `Sanity fetch failed: egress
blocked` in the offline tests is an intentional test fixture, not the cause
of those CI failures.

## Actual production sync timeline

Every sync did not fail. The post-merge main article runs show:

| Local time, October 26 | Run | Result |
| --- | --- | --- |
| 12:48 p.m. | [40390014807](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40390014807) | Success |
| 1:03 p.m. | [40392245728](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40392245728) | Success |
| 1:40 p.m. | [40397752457](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40397752457) | Scheduled success after #291 |
| 5:41 p.m. | [40428039293](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40428039293) | 429 from `/p/how-resident-evil-makes-being-in` through relay |
| 11:41 p.m. | [40462634510](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40462634510) | 429 from `/p/lanterns-the-grounded-blueprint-for` through relay |

Both later runs passed all 17 article regression tests before failing real
network ingestion. Tests and sync execution are different stages. The saved
13-article snapshot remained untouched. Deployments following those failed
syncs were correctly skipped. YouTube and Instagram syncs continued succeeding.
GitHub's nominal hourly schedule did not execute hourly in this interval;
this report counts actual runs, not expected cron ticks.

## Root cause and repair

The relay cached only complete aggregate responses for five minutes. After
expiry it re-fetched RSS and all 13 article pages, four pages concurrently.
One 429 discarded the aggregate even if twelve articles had succeeded. Caller
retries started the full batch again. The one-minute RSS cache introduced in
#291 did not cache individual articles. Logs prove rate limiting; the cache
and retry structure explain why an occasional article failure cascaded into
whole-sync failures and repeated requests.

The repair persists validated complete posts separately, matches them to a
hash of their current RSS item, and refreshes only changed/new items until a
24-hour hard expiry. Tag-only edits without RSS changes can take up to one
day to appear. New posts and RSS-visible edits refresh immediately once the
upstream is reachable. Cache misses are paced, partial successes survive,
and Retry-After cooldowns survive object restarts. Expired or edited data
cannot silently fall back to an old cached body. RSS conditional requests and
a shared rate-limit cooldown further reduce repeated upstream work.

A read-only production watcher check during this investigation also returned
RSS 429. That confirms upstream limits affect feed polling as well as article
pages. The repair cannot guarantee Substack availability, and a blocked feed
continues to report failure instead of declaring stale content current.

The CI defect is independent: FeedSpotlightHero marked the decorative brand
backdrop and a different video thumbnail high priority. Nine category pages
therefore violated the existing one-high-priority-image rule. The decorative
backdrop is now low priority, and `/feed` preloads the visible video artwork
with its matching responsive sizes. No gate was disabled or weakened.

## Validation

- Full offline unit suite passes.
- 42 targeted article/watcher tests pass, including hourly expiry, restarts,
  RSS edits, new posts, tag-only daily refresh, partial 429 recovery, pacing,
  persistent cooldown, ETag 304 and refusal to treat failed refreshes as success.
- Type check: zero errors, warnings or hints.
- Production build succeeds; all ten built-site QA rules pass on 78 pages.
- Worker deployment bundle dry run succeeds.
- Real public Substack reads from the local machine: 13 complete posts from
  14 upstream requests on a cold cache. A simulated six-hour-later object
  restart fetches only RSS and returns the identical 13 complete payloads.
- Full browser suite and GitHub PR checks are tracked on the repair PR.

These checks do not establish recovery from Cloudflare's production egress
or prove a future publish. After merge, the relay deploy and real scheduled
sync must be verified after cache expiry. Keep #280's three-real-publishes
acceptance requirement open.

## All emailed Actions runs

The table below maps every unique emailed failed run to its failure family.

| Run | Failure |
| --- | --- |
| [40462634510](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40462634510) | Substack access / rate limit failure |
| [40428039293](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40428039293) | Substack access / rate limit failure |
| [40393907593](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40393907593) | Built-site image-priority failure |
| [40393812153](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40393812153) | Built-site image-priority failure |
| [40393622340](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40393622340) | Built-site image-priority failure |
| [40391929556](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391929556) | Built-site image-priority failure |
| [40391943248](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391943248) | Built-site image-priority failure |
| [40391933985](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391933985) | Built-site image-priority failure |
| [40391728650](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391728650) | Built-site image-priority failure |
| [40391658059](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391658059) | Built-site image-priority failure |
| [40391193848](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391193848) | Built-site image-priority failure |
| [40391354171](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40391354171) | Built-site image-priority failure |
| [40390950200](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40390950200) | Built-site image-priority failure |
| [40388661495](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40388661495) | Built-site image-priority failure |
| [40388545147](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40388545147) | Built-site image-priority failure |
| [40388455920](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40388455920) | Built-site image-priority failure |
| [40388078972](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40388078972) | Built-site image-priority failure |
| [40388086622](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40388086622) | Built-site image-priority failure |
| [40387729401](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387729401) | Built-site image-priority failure |
| [40387907518](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387907518) | Built-site image-priority failure |
| [40387561298](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387561298) | Built-site image-priority failure |
| [40387124920](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387124920) | Built-site image-priority failure |
| [40386497537](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40386497537) | Built-site image-priority failure |
| [40387560711](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387560711) | Substack access / rate limit failure |
| [40387124577](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40387124577) | Substack access / rate limit failure |
| [40386497078](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40386497078) | Substack access / rate limit failure |
| [40386497078](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40386497078) | Substack access / rate limit failure |
| [40384660172](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40384660172) | Built-site image-priority failure |
| [40385962606](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40385962606) | Substack access / rate limit failure |
| [40383954386](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40383954386) | Built-site image-priority failure |
| [40385726668](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40385726668) | Temporary syntax error on the development branch |
| [40385385605](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40385385605) | Substack access / rate limit failure |
| [40385098154](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40385098154) | Relay route 404 during deployment propagation |
