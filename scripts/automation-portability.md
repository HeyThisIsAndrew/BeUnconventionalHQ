# Cloning the automation for another brand (issue #286)

The social posting Worker and the newsletter Kit Worker carry no brand in
their code. Everything that names this brand lives in the places below, so a
clone (for hey-this-is-andrew, say) is a copy plus these edits.

| What | Where | Change for the clone |
| --- | --- | --- |
| Site, brand name, alert addresses | `social-blast-worker/wrangler.jsonc` and `dispatch-kit-worker/wrangler.jsonc`, `vars` | `SITE_URL`, `BRAND_NAME` / `NEWSLETTER_NAME`, `ALERT_EMAIL`, `ALERT_FROM` (a Resend-verified sender on the new domain) |
| Worker names and account | same files, `name` and `account_id` | New names (`<brand>-social-blast`, `<brand>-dispatch-kit`) so the clones never overwrite these |
| Service binding to the site | same files, `services` | The new site's Worker name |
| Post wording | `social-blast-worker/templates.json` | The new brand's own templates, all `"approved": false` until its owner approves them |
| Email design and footer | `email/hq-dispatch/template.html`, `post-template.liquid.html`, `public/dispatch/` art | New masthead, colours, footer links and postal address |
| Platform accounts | GitHub secrets read by the two deploy workflows | `BLUESKY_*`, `THREADS_*`, `FB_*`, `KIT_API_KEY` for the new accounts |
| Kit setup | the new Kit account | Its email template id (`KIT_EMAIL_TEMPLATE_ID`), the `hq_topics` custom field (or rename `KIT_TOPICS_FIELD`), a confirmation form (`KIT_FORM_ID`) |
| Trigger URLs | `scripts/trigger-social-blast.mjs`, `scripts/trigger-kit-draft.mjs` | Pass `SOCIAL_BLAST_URL` / `DISPATCH_KIT_URL`, or edit the defaults |
| Site side | `src/lib/dispatch-feed.ts` (what the feed lists), `src/pages/dispatch.json.ts`, `src/lib/dispatch-topics.ts` (the four topics) | Only if the new site's content types or topics differ |

What is NOT portable without work: the feed itself is built from this
site's own data files (`src/data/articles.json`, `src/data/videos.json`), so
a clone needs a site that publishes the same `/dispatch.json` shape
(`dispatchJsonItem()` in `src/lib/dispatch-feed.ts` is the contract).
