# Testing a branch by hand (human test access)

Three ways to try work that is not merged, from least to most setup. None of
them changes what beunconventionalhq.com serves.

## 1. A preview copy of the site (click around on a phone)

GitHub > Actions > **Branch preview** > Run workflow > pick the branch > Run.
After about five minutes the run's summary page shows the address, for
example `https://feat-newsletter-topics-beunconventionalhq.heythisisandrewb.workers.dev`,
with links to the pages worth checking.

It is a preview VERSION of the live Worker (`wrangler versions upload`), not
a deploy: production keeps serving `main`.

**It shares production's data and secrets.** A signup on the preview is a
real record in the real subscriber list, so test with your own addresses.

One-time setup, or forms on the preview will refuse:
- **Turnstile:** Cloudflare > Turnstile > the newsletter widget > Hostname
  Management > add `heythisisandrewb.workers.dev`.
- **Preview URLs:** if the run fails with 404s, Cloudflare > Workers >
  beunconventionalhq > Settings > Domains & Routes > turn Preview URLs on.
- **Newsletter preference page** (`/newsletter`, topics branch only): add the
  Worker secret `NEWSLETTER_LINK_SECRET` (any long random string) under
  Settings > Variables and Secrets. Production code ignores it until merged.

## 2. The newsletter, as an email (no Kit, no list)

```
npm run build
node scripts/dispatch-preview.mjs --out preview.html --issue 1     # open on any device
RESEND_API_KEY=... node scripts/send-dispatch-test.mjs --issue 1   # one copy to andrew@ only
```
Topics branch: add `--reader "film,tv"` to see one reader's version.
Details: scripts/hq-dispatch.md.

## 3. The Workers on your own machine (dry run, nothing posts or sends)

```
npm run build
npx astro preview                                   # the site at localhost:4321
npx wrangler dev --config social-blast-worker/wrangler.jsonc --port 8787 \
  --var FEED_ORIGIN:http://localhost:4321 --var WEBSUB_SECRET:local --test-scheduled
curl http://localhost:8787/__scheduled               # a cron run (the first only records the feed)
WEBSUB_SECRET=local SOCIAL_BLAST_URL=http://localhost:8787/blast node scripts/trigger-social-blast.mjs --inspect

npx wrangler dev --config dispatch-kit-worker/wrangler.jsonc --port 8788 \
  --var FEED_ORIGIN:http://localhost:4321 --var WEBSUB_SECRET:local
WEBSUB_SECRET=local DISPATCH_KIT_URL=http://localhost:8788/draft node scripts/trigger-kit-draft.mjs
```
`FEED_ORIGIN` points the Worker at the local site instead of production.
Without `RESEND_API_KEY` the emails print in the `wrangler dev` terminal
instead of sending. Both Workers stay in dry run unless you change their
`wrangler.jsonc`.
