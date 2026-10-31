# Social distribution Worker (hq-social-blast)

Announces every new article and long-form video on Bluesky, Threads and the
Facebook Page, and emails ready-to-post drafts for X and YouTube Community.
Issues #281 (copy engine), #282 (live platforms), #284 (draft queue), #286
(portable config). Code: `social-blast-worker/`. Tests:
`scripts/social-blast.test.mjs`.

**It ships in dry run.** Nothing posts anywhere until you name a platform in
`LIVE_PLATFORMS` AND approve the templates it is allowed to use.

## How it works

```
Substack / YouTube sync → commit → deploy.yml builds the site
  → /dispatch.json (the newest 20 stories, same list as /dispatch.xml)
  → deploy.yml nudges POST /blast (signed)   ┐
  → cron every 15 minutes                    ┴→ one Durable Object, one run at a time
      → new story? pick a template per platform (templates.json, rotating)
      → live platform: post · other platforms: preview · X/YouTube: draft
      → one report email to ALERT_EMAIL
```

- **First run announces nothing.** It records every story already in the
  feed, so switching the engine on never blasts the back catalogue.
- **One story, one post per platform.** State lives in a Durable Object (not
  KV, which is eventually consistent and would let two overlapping runs both
  post). A platform is marked in-flight before its request goes out.
- **Failures.** One platform failing never stops the others. A failure that
  certainly did not post is retried up to 3 times, with the same text. A
  failure that MIGHT have posted (the request went out, no answer came back)
  is reported as "unknown" and never retried: check the platform by hand.
- **Old stories are skipped.** A new story published more than
  `MAX_AGE_HOURS` (72) before it reached the feed is reported, not posted.
- **At most `MAX_ITEMS_PER_RUN` (3) stories per run**, oldest first. The rest
  go out on the next run.
- **Every run that did something sends one email**: what posted (with links),
  what failed, the dry-run text, and the X / YouTube drafts with a one-tap
  "Open in X" composer link. An email Resend could not send is kept and sent
  on the next run.
- **Dry run is final per story.** A story previewed while a platform was in
  dry run is never posted there later, so going live never floods a feed with
  last week's stories.

Posts use the platform's link card: Bluesky gets the composed 1200x675
dispatch image as the card picture; Threads and Facebook build the card from
the page's own preview image. Links are the site URL for articles and the
YouTube watch URL for videos (the same links /dispatch.xml carries).

## Wording: `social-blast-worker/templates.json`

Edit it on GitHub. `deploy-social-blast.yml` deploys the change within a few
minutes, so it applies from the next run. No code change.

- Variables: `{{title}}` `{{summary}}` `{{section}}` `{{type}}` `{{url}}`. A
  template that needs a variable the story lacks (no summary, no section) is
  skipped. If none fit, that platform is **blocked** for the story and the
  email says why. Nothing is ever guessed.
- `"approved": true` is what allows a template to post LIVE. Every shipped
  template is `false`: they are drafts written for you to edit. Unapproved
  templates still appear in dry-run previews and in X / YouTube drafts.
- `"platforms": ["youtube"]` limits a template to some platforms. A platform
  with templates of its own uses only those (that is how YouTube gets
  question-style posts).
- `"retired": true` stops using a template without deleting it.
- Rotation: never the template used last time on the same platform for the
  same content type, and different templates across platforms for one story.
- Content type: a video uses `video`; an article in a `sectionMap` section
  (`Events`) uses `event`; otherwise `typeMap` by content type (Review,
  Analysis, News/Announcement); anything else uses `story`.
- Limits: Bluesky 300 graphemes, Threads 500, X 280 (a link counts as 23).
  Only `{{summary}}` is ever trimmed; a title that does not fit skips the
  template.

## Setup (owner, once)

1. **GitHub secrets** (repo → Settings → Secrets and variables → Actions).
   Already set: `CLOUDFLARE_API_TOKEN`, `WEBSUB_SECRET`, `RESEND_API_KEY`.
   Add the ones for each platform you want:

   | Platform | Secrets | Where |
   |---|---|---|
   | Bluesky | `BLUESKY_IDENTIFIER` (handle), `BLUESKY_APP_PASSWORD` | Bluesky → Settings → Privacy and security → App passwords. Never the account password. |
   | Threads | `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` (long-lived) | A Meta app with the Threads use case, permissions `threads_basic` + `threads_content_publish`. Development mode is enough for your own account. |
   | Facebook Page | `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN` | A Page token with `pages_manage_posts` + `pages_read_engagement`, derived from a long-lived user token so it does not expire. |

2. **Deploy**: Actions → "Deploy social distribution Worker" → Run workflow
   (or merge anything under `social-blast-worker/`). The workflow deploys,
   then copies whichever secrets exist onto the Worker.
3. **Within 15 minutes** the first run records the current feed. Nothing is
   emailed for that.
4. **Preview any time**: `WEBSUB_SECRET=… node scripts/trigger-social-blast.mjs --inspect`
   prints what the next run would post and changes nothing.

## Going live, one platform at a time

1. Approve templates in `templates.json` (`"approved": true`). At least six
   per content type you publish keeps rotation working across all five
   platforms. A live platform with no approved template for a story is
   blocked and reported, never posted with an unapproved one.
2. In `social-blast-worker/wrangler.jsonc`, set
   `"LIVE_PLATFORMS": "bluesky"` (comma list: `bluesky,threads,facebook`).
3. Merge. The next new story posts there; everything else stays a preview.

Back to dry run: set `LIVE_PLATFORMS` to `""` and merge.

Do not change these in the Cloudflare dashboard: the next deploy overwrites
dashboard vars with `wrangler.jsonc`.

## Threads token

Long-lived Threads tokens expire after 60 days unless refreshed. The Worker
refreshes it daily (starting a day after you set the secret, because Threads
refuses to refresh a token less than a day old) and keeps the refreshed token
in its Durable Object. A failed refresh is emailed. If you set a new
`THREADS_ACCESS_TOKEN` secret, the Worker notices and switches to it.

## Triggers

- **Cron, every 15 minutes.** The safety net; on its own it is enough.
- **`deploy.yml` → `scripts/trigger-social-blast.mjs`** after each production
  deploy, so a new story goes out minutes after it is live. This step is
  `continue-on-error`: the social Worker being down never fails a site deploy.
- Both are signed with the shared automation HMAC (`WEBSUB_SECRET`,
  `src/lib/automation-auth.mjs`), the same scheme the Substack watcher uses.
  A replayed request can only cause one more run, and runs are idempotent.

The Worker reads `/dispatch.json` and the dispatch images through a service
binding to the site Worker (`HQ_SITE`). The domain's bot protection refuses
datacenter IPs, the binding does not cross it.

## What it will never do

- Post to X or YouTube Community. They have no free or public posting API for
  this; they are drafts in the email, always (#284).
- Publish to Substack. Substack has no write API; it stays the place you write.
- Use AI-written copy, scrapers or unofficial endpoints.

## Not built yet

- The Google Sheet queue and calendar scheduler (#285, Phase 2). Drafts go by
  email for now (owner's decision, 2026-10-30).
- Instagram Stories (#283). The API cannot add link stickers.
- `/dispatch.json` does not yet carry the pre-rendered Kit story boxes that
  #273 asks for; that belongs with the Kit draft Worker (#272).
