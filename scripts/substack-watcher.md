# Substack publish watcher (#279)

The source Worker runs a five-minute Cron Trigger. It checks the public archive
API, whose current metadata avoids Substack's RSS cache lag (the RSS was still
missing the Batman article over twenty minutes after the API published it).
Discovery is shared for one minute across repeated checks. Existing canonical
post URLs remain the watcher GUIDs, so the transition does not re-announce every
previously seen post. The hourly Actions schedule remains a safety net.

Native API fetching is tried first. When Substack blocks the cloud fetch, a
scoped Cloudflare Browser Run binding loads the same public JSON endpoint in a
browser. JSON displayed inside Chrome's escaped `pre` wrapper is decoded once,
then parsed as data. Full import uses the posts API, preserving all article tags
and bodies; it does not substitute RSS-only metadata. Browser pages reject
images, media, fonts, stylesheets and external scripts.

Browser requests are serialized and spaced at least eleven seconds apart,
including across object restarts, to respect the free-plan request limit. A
persisted daily wall-time budget below the free plan's ten minutes limits
recovery use; exhausted budgets fail visibly and preserve the last snapshot.
Aggregate article pages remain cached for five minutes. The binding does not
need a new API token, paid plan upgrade, or a personal laptop process.

When new articles appear, the watcher first invalidates and warms the full
article source cache. Only after complete data and GitHub acceptance succeed
does it record the new GUIDs as dispatched. This prevents a fast trigger from
syncing an old snapshot and then waiting another hour for the article.

## Architecture and state

- Worker: `hq-substack-source`, config `scripts/substack-relay.wrangler.jsonc`.
- Cron: `*/20 * * * *`, UTC. Twenty-minute cadence stays well inside the daily free-plan browser budget while keeping no PT daylight-saving shift.
- State is in the **existing SQLite-backed Durable Object**, rather than a new
  KV namespace. #279 proposed KV; the sync fix already requires this shared
  object for stable upstream fetching and a global cache. Reusing it provides
  consistent state and coalesces overlapping ticks without adding infrastructure.
- Baseline key: `watcher:published:v1`. Alert throttle: `watcher:last-alert:v1`.
- A private service binding calls the site's `/api/automation` gateway. The
  existing repository-scoped `GITHUB_DISPATCH_TOKEN` remains only on the site
  Worker. No personal laptop token is copied to Cloudflare.
- Requests use a SHA-256 HMAC with a dedicated domain prefix, timestamp and
  five-minute validity window, using the existing `WEBSUB_SECRET`. Secrets are
  not sent in URLs, logged or committed. Public unsigned poll requests fail.
- The gateway first tries this repository's `content-published` event. If the
  stored token has Actions-write permission without Contents-write (the live
  token returned HTTP 403 on repository_dispatch), it falls back to the fixed
  `sync-articles.yml` workflow_dispatch on main. No broader token is required.
  A Substack event runs articles only; the YouTube workflow ignores it.
- Failures preserve the content baseline for retry. Repeated successful ticks
  dispatch nothing. A network timeout after GitHub accepted an event can cause
  another dispatch; downstream content syncing is idempotent and serialized.

## Notifications

The owner selected **email to andrew@beunconventionalhq.com** on October 26,
2026, including one test alert. The source Worker uses the existing Resend integration directly, independently
of the website gateway
and verified `noreply@beunconventionalhq.com` sender. Messages are plain text,
with a stable idempotency key. Identical errors are throttled to one per hour;
failed delivery does not mark the incident as notified. Scheduled failures also
fail the Cron invocation and appear in Worker logs.

`ALERT_CHANNEL` can alternatively be `github`: the gateway starts the dedicated
`Automation failure alert` workflow, which intentionally fails with the error
in its log and uses the owner's GitHub notification settings. It never deploys
the site. Email is the deployed choice for this rollout.

## Deploy and verify

1. Deploy the site's gateway and repository_dispatch workflow triggers from
   main, using the existing production deploy.
2. Run **Deploy Substack source relay**. It configures the Worker's copies of
   `WEBSUB_SECRET` and `RESEND_API_KEY` from the existing repository secret without printing it, then
   deploys the code, service binding and Cron Trigger.
3. Preview: `node --env-file-if-exists=.env scripts/check-substack-watcher.mjs`.
4. Seed/execute: append `--execute`. Repeating with the unchanged feed must say
   `unchanged` and produce no GitHub run.
5. With the chosen channel configured, append `--execute --test-failure` once. This
   intentionally fails polling, verifies notification acceptance, and preserves
   the content baseline. It does not publish or send a newsletter.
6. Observe the next real Substack publish, the resulting repository_dispatch
   run, and production's `/intel/<slug>` page. Record three consecutive real
   publishes on #280 before closing its acceptance criterion.

Target: detection within five minutes plus GitHub queue/build/deploy time.
This is a target, not a guarantee of five minutes end to end: both Cron and
GitHub scheduling can be delayed. Existing scheduled posts need no board move
or manual Run workflow press.

The newsletter Worker (#272), board watcher (#274), social distribution and
scheduler remain separate follow-up work in #131. #278's real Kit API plan
check gates newsletter implementation; do not automatically send broadcasts.

## Cloud verification without publishing

Run **Deploy Substack source relay** on the repair branch with **diagnose_source**
enabled. It creates a temporary source Worker with the real source class and
browser binding, verifies complete articles from GitHub's cloud network, runs
article sync in dry-run mode, checks watcher discovery, then deletes the preview.
It has no Cron, production gateway or email bindings. All offline source tests
also run in the normal unit suite and before production source deployment.

On October 27 (October 28 UTC), isolated cloud tests confirmed the fresh Batman
article (ID 222431475), its 14 tags and its complete 20,417-character body via the
public archive/posts browser paths. Native cloud article requests still returned
429, so browser delivery is a required fallback rather than another native retry.
