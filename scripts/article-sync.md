# Article sync: sources, failures, and deployment

The website renders `src/data/articles.json` at build time. A successful sync
commits that snapshot and its image assets; `deploy.yml` then builds and proves
the new commit is live. Existing pages do not depend on Substack being reachable.

## What failed (October 26, 2026)

1. Substack moved its article payload to `<script id="preloads-json"
   type="application/json">`. The scraper only recognized the former
   `window._preloads = JSON.parse("...")` string literal. Every article failed
   extraction, but zero collected posts was accepted as a successful sync.
2. GitHub-hosted runners received Cloudflare HTTP 403 challenges from the posts
   API, RSS, and article pages. Chromium and browser TLS impersonation also
   received 403: changing the User-Agent was insufficient. The AllOrigins
   fallback timed out.
3. Fetch failures deliberately exited 0 when a snapshot existed. This protected
   pages but hid failed publishing: green Actions did not mean fresh articles.
4. On Cloudflare's network the bulk `/api/v1/posts` endpoint returned 429, while
   the public archive, individual post JSON, RSS and article HTML returned 200.
   The source relay therefore uses the archive and individual post endpoints.

Evidence:

- [Original false-success run](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40382926226): RSS 403, proxy timeout, job succeeds.
- [GitHub network comparison](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40384659417): Node, Chromium, and browser TLS requests all challenged.
- [Cloudflare endpoint comparison](https://github.com/HeyThisIsAndrew/BeUnconventionalHQ/actions/runs/40385962606): bulk endpoint 429; RSS, archive, individual post JSON and HTML 200.

## Source order

`scripts/substack-source.mjs` tries:

1. Direct posts API, paginated in batches of 20. Usually works locally.
2. The owned `hq-substack-source` Cloudflare Worker. GitHub calls its workers.dev
   address, avoiding the website domain's separate bot rules. The Worker lists
   20 public archive entries and fetches each full post JSON, four at a time.
   At most 21 subrequests per invocation, with successful pages cached for five
   minutes. Target host and paths are fixed; callers cannot supply a proxy URL.
3. Direct RSS for discovery, followed by full post payloads from article HTML.
   Both the current JSON script and legacy JSON string are supported. Nothing
   scraped from a page is evaluated as JavaScript.

The RSS currently carries **no category tags**, whereas the real posts carry
up to 17 tags. Those tags drive categories, related articles and hub coverage.
An RSS-only importer would silently break this metadata. It is not a complete
replacement for full post JSON, even though RSS contains article body HTML.

Requests have timeouts, with bounded retries for network errors, 429 and 5xx.
Permanent 403 challenges proceed directly to the next source. Exhausted,
malformed, empty or incomplete results fail visibly and preserve the snapshot.
Archive records and editorial overrides survive; identical content does not
change `lastUpdated`, rewrite the snapshot, commit, or trigger a deploy.

## Operate and deploy

- Preview: `npm run sync-articles`
- Write: `npm run sync-articles -- --execute`
- All sources: `npm run sync -- --execute` (forwards the flag to every sync).
- Offline regressions: `node --test scripts/article-sync.test.mjs scripts/youtube-sync-network.test.mjs`
- Hourly safety net: Actions → Sync Substack articles. A manual dry run writes
  neither articles nor image assets and cannot commit anything.
- Relay deployment: Actions → Deploy Substack source relay. It also deploys
  automatically when its files change on main, using the existing
  `CLOUDFLARE_API_TOKEN` repository secret. Hourly syncs do not redeploy it.
- Relay health: `https://hq-substack-source.heythisisandrewb.workers.dev/posts?offset=0`
  must return a nonempty JSON array, including `body_html` and `postTags`.

Overrides: `SUBSTACK_PUBLICATION_URL`, `SUBSTACK_FEED_URL`, and
`SUBSTACK_RELAY_URL`. The default relay is used only for this publication; it
must never supply HQ articles for a different configured publication.

GitHub's failed-workflow notifications now expose exhausted sync failures.
The fast publish watcher and its chosen alert channel are tracked in #279 and
#272. Keep #280 open until three consecutive real publishes have been observed;
a test run cannot prove future publishes or their end-to-end timing.

## YouTube warnings in the supplied log

The Shorts classifier launched 50 HEAD requests at once with no timeout.
Node 26 returned HTTP/2 GOAWAY/session error 11. Probes now run four at a time,
timeout after eight seconds, and retry once. When both attempts fail, a known
Short keeps its classification instead of becoming a regular video solely
because it is longer than 61 seconds. Actual YouTube API failures remain fatal.
