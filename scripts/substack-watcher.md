# Substack publish watcher (#279)

The source Worker now also runs a five-minute Cron Trigger. It reads the public
RSS once per ordinary tick. The first tick records a baseline without firing;
later ticks compare article GUIDs and dispatch only newly seen articles. The
hourly Actions schedule remains a safety net. Existing YouTube WebSub handling
is unchanged.

When a new article appears, the watcher first invalidates and warms the full
article source cache. This prevents a fast trigger from syncing the old cached
snapshot and then waiting another hour for the article. Only after preparation
and GitHub acceptance succeed does it record the new GUIDs as dispatched.

## Architecture and state

- Worker: `hq-substack-source`, config `scripts/substack-relay.wrangler.jsonc`.
- Cron: `*/5 * * * *`, UTC. Five-minute cadence has no PT daylight-saving shift.
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
- The gateway can dispatch only this repository's `content-published` event.
  A Substack event runs articles only; the YouTube workflow ignores it.
- Failures preserve the content baseline for retry. Repeated successful ticks
  dispatch nothing. A network timeout after GitHub accepted an event can cause
  another dispatch; downstream content syncing is idempotent and serialized.

## Notifications

The gateway uses the existing Resend integration to send plain-text failure
alerts to the editorial inbox, `press@beunconventionalhq.com`, with a stable
idempotency key. Identical errors are throttled to one per hour. Failed alert
delivery does not mark an incident as notified, so the next tick retries it.
Scheduled failures also fail the Cron invocation and appear in Worker logs.

Activation and a real test alert require the owner's selected alert channel.
The initial rollout records that choice in the PR; this document describes the
email configuration implemented here, not proof that an email was delivered.

## Deploy and verify

1. Deploy the site's gateway and repository_dispatch workflow triggers from
   main, using the existing production deploy.
2. Run **Deploy Substack source relay**. It configures the Worker's copy of
   `WEBSUB_SECRET` from the existing repository secret without printing it, then
   deploys the code, service binding and Cron Trigger.
3. Preview: `node --env-file-if-exists=.env scripts/check-substack-watcher.mjs`.
4. Seed/execute: append `--execute`. Repeating with the unchanged feed must say
   `unchanged` and produce no GitHub run.
5. After notification approval, append `--execute --test-failure` once. This
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
