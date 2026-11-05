# THE HQ DISPATCH: the weekly newsletter

Issues #266 (template), #272 (weekly Kit draft), #273 (feed), #278 (Kit API
check). Sent from Kit (formerly ConvertKit).

**Launch path: the Kit draft Worker.** We are on Kit's free Newsletter plan,
and Kit's RSS-to-email needs the paid Creator plan, so the site does the RSS
part itself: a Cloudflare Worker builds a **draft** broadcast in Kit every
Thursday, and a human reviews it and presses Send. The RSS route is kept at
the bottom of this file for the day the plan changes.

## How it fits together

```
src/data/articles.json ─┐
src/data/videos.json  ──┼─> selectDispatchEntries() ─┬─> /dispatch.xml  (RSS; Kit Creator plan only)
                        │   (src/lib/dispatch-feed.ts)│
                        │                             └─> /dispatch.json (20 stories, each with its
                        │                                  FEATURED and LATEST boxes pre-rendered
                        │                                  from post-template.liquid.html)
                        └─> sync-dispatch-images.mjs             │
                            composes each story's art            │  Thursdays 16:00 UTC, or by hand
                            into public/dispatch/images/         v
                                               dispatch-kit-worker/ (hq-dispatch-kit)
                                               stories since the last draft, at most 6,
                                               joined in order, nothing else
                                                                 │
                                                                 v
                                     Kit: POST /v4/broadcasts, send_at null = a DRAFT,
                                     in the HQ Dispatch email template (template.html)
                                                                 │
                                                                 v
                                     email to the owner with the link; a human presses Send
```

## Files

| File | What it is |
| --- | --- |
| `email/hq-dispatch/template.html` | The email shell. Paste into Kit > Send > Email Templates > New > **HTML**. |
| `email/hq-dispatch/post-template.liquid.html` | The FEATURED and LATEST FROM THE HQ story boxes. Paste into the RSS broadcast's **Post** content block > Post Template (HTML). |
| `email/hq-dispatch/mockup.html` | Both rendered with five real stories. Open in a browser to review. **Generated**: `node scripts/hq-dispatch-render.mjs`. |
| `src/pages/dispatch.json.ts` | The feed the Kit draft Worker reads: `/dispatch.json`, with each story's boxes pre-rendered |
| `src/lib/dispatch-boxes.ts` | How the boxes are rendered one story at a time from the one Liquid template |
| `dispatch-kit-worker/` | The weekly draft Worker: `kit-draft.mjs` (the logic), `worker.mjs`, `wrangler.jsonc` |
| `scripts/kit-spike.mjs` | Issue #278, by hand: list Kit templates, create one test draft, delete it |
| `scripts/trigger-kit-draft.mjs` | Run the Worker by hand (dry run unless `--execute`; `--test-failure` tests the alert) |
| `scripts/dispatch-kit.test.mjs` | Offline guards for the Worker, in `npm test` |
| `src/pages/dispatch.xml.ts` | The RSS feed: `https://beunconventionalhq.com/dispatch.xml` (Creator plan route only) |
| `src/lib/dispatch-feed.ts` | What the feed lists and what each item carries |
| `scripts/sync-dispatch-images.mjs` | Builds each listed story's image. `npm run sync:dispatch-images -- --execute`. Runs in CI after every article and YouTube sync. |
| `scripts/dispatch-image.mjs` | The image composer (the "never cut off" rule lives here) |
| `scripts/build-dispatch-art.mjs` | Renders the header and the fallback art. `npm run build:dispatch-art`, only when the design changes. |
| `public/dispatch/` | `header-1200x400.png`, `fallback-1200x675.jpg`, and `images/` (one JPEG per story) |
| `src/data/dispatch-images.json` | Source image URL to composed file |
| `scripts/hq-dispatch-email.test.mjs`, `scripts/dispatch-feed.test.mjs` | Offline guards, both in `npm test` |

## Design language

It's the site's, translated into email-safe HTML. No Astro or Tailwind markup
is copied; the values are.

| Site token | Value | In the email |
| --- | --- | --- |
| `--color-black` | `#0a0a0a` | Page ground |
| `--color-surface` | `#111111` | Every story box (the About page's `.stat-card`) |
| hairline `rgba(255,255,255,0.05)` | `#1d1d1d` | Box borders and rules, flattened because Outlook ignores rgba |
| `--color-accent` | `#cc0000` | **The brand red.** Every fill, rule, border and glow, the button outlines and the big "HQ". |
| `--color-accent-text` | `#ef4444` | Every hover. `#cc0000` is 3.21:1 on `#111111` and fails WCAG AA at label size; the site makes the same split in `theme-red.css`. |
| (email only) | `#ff6b6b` | Red **small text**: kickers and the TYPE \| SECTION labels, weight 700. 6.8:1 on `#111111`; the site's `#ef4444` (5.0:1) read faint in some clients and in dark mode (owner, 2026-10-31). |
| `--color-white` | `#f0f0f0` | Headlines |

- **Story boxes**: `#111111` with a 1px hairline, red border on hover where hover exists.
- **FEATURED** opens on its image at the full width of the box, always (a story with no art gets the fallback, below).
- **LATEST** rows put a 16:9 thumbnail beside the text, **centred vertically** on it; they stack on a phone.
- **Button**: the site's `.cta-button-primary`, a `#cc0000` outline around white uppercase type, filling red on hover. 48px tall, full width on a phone.
- **Section headings**: the `PageTitle` lockup (red spaced kicker, heavy uppercase title, a red "HQ" tucked under it).
- **Brand glow**: `radial-gradient`s of `rgba(204,0,0,…)` over a solid `bgcolor`, so Outlook desktop shows plain dark.
- **Header image**: the logo and a Syne "THE HQ / DISPATCH" lockup, rendered by headless Chrome, because the email itself can't load web fonts. Elsewhere the email uses the system font at weight 800 to 900.

### Links

Every link rests the way its counterpart on the site rests, and **turns red
on hover** (owner's call). Hover works where the client supports it (Apple
Mail, Outlook.com, Gmail on the web); phones have no hover.

| Link | At rest (as on the site) | Hover |
| --- | --- | --- |
| Section links, top bar | Navbar: `#c6c6c6` (`rgba(245,245,245,0.8)` flattened) | `#ef4444` with a red line under it, like the navbar |
| Footer socials, preferences, unsubscribe | Site footer: `#888888` | `#ef4444` (the site's footer goes white; the email goes red) |
| A link inside text | Article link: white on a `#cc0000` underline | `#ef4444` |
| Story headlines | White | `#ef4444` |
| "Read the story ›" | Red | `#ff1a1a` (`--color-accent-hover`, like the navbar's `.cta`) |

### Footer

"BE YOURSELF. BE PASSIONATE. BE UNCONVENTIONAL.", then "WHERE NERD CULTURE
GETS CINEMATIC." in capitals, then "There's more every day at
beunconventionalhq.com." on its own line. Socials in two rows of three:
YouTube, Instagram, TikTok / Bluesky, Letterboxd, Threads. **No X**: the
owner doesn't promote it in the newsletter, and the test fails if it comes
back. Address: **Anaheim, CA 92805**, typed into the template.

## Images are never cut off

The owner's rule, and the reason for most of the machinery above.

The email's image boxes are 16:9. Story art isn't always 16:9 (L.A. Comic
Con's is 1.9:1, some Substack art is square). So each image is **composed
ahead of time** into a 1200x675 JPEG with the **whole picture fitted inside**,
and the space around it filled with a blurred, darkened copy of the same
picture: the treatment the event stage already uses on the site. A 16:9
source fills the frame exactly.

The one thing ever trimmed is YouTube's baked-in black bars on its 4:3
renditions (`hqdefault` and the like), and only those, only on
`i.ytimg.com` URLs. Every video in the store today has a 16:9
`maxresdefault`.

In the email, the image rule is `object-fit: contain`, never `cover`, so
even a wrongly shaped image would letterbox rather than crop. The tests
check both: the composer keeps all four edges of a wide and a tall test
image, and no `object-fit: cover` exists anywhere in the email.

**A story with no built image gets the fallback art** (`fallback-1200x675.jpg`,
the logo on the brand ground), never no image and never the raw original.
That keeps the FEATURED box opening on a full-width picture every time.

**Images are never deleted.** A sent email points at its images for as long
as it sits in an inbox, so `sync-dispatch-images.mjs` never prunes, unlike
the article-image sync. About 75 KB a story.

## Launch: the weekly Kit draft Worker

### What a run does

1. Reads `/dispatch.json` through a service binding to the site Worker (the
   domain's bot protection refuses datacenter IPs).
2. Takes the stories published after the newest story of the last draft. The
   very first run looks back `FIRST_WINDOW_DAYS` (7). **No new stories, no
   draft**: you get a one-line "no new stories" email instead.
3. At most `MAX_STORIES` (6), newest first: the newest is FEATURED, up to five
   more are LATEST. More than six: the newest six go, and the email says how
   many older ones did not fit.
4. Joins the boxes the site pre-rendered: FEATURED box, the LATEST heading,
   then each LATEST box. **The Worker never writes email markup**;
   `scripts/dispatch-feed.test.mjs` proves the joined boxes equal the Liquid
   template rendering the same stories.
5. Writes the copy: subject `THE HQ DISPATCH: <featured title>`, preview text
   the featured summary trimmed to about 90 characters, internal description
   the story titles plus a marker `[hq-dispatch newest=<link>]`.
6. **Checks Kit for that marker before creating**, so a re-run, a lost cache
   or a create that timed out can never make a second draft. Kit is the
   source of truth; the Worker's own state is a cache.
7. Creates the draft (`send_at: null`, `public: false`, the HQ Dispatch
   template) and emails you the link. Kit's 429s and 5xx are retried with
   backoff. Any failure emails you.

It **ships in dry run** (`CREATE_DRAFTS: "false"`): a run emails you the
would-be draft, boxes rendered, and does not touch Kit.

**Schedule:** Thursdays at 16:00 UTC. Cloudflare crons run on UTC with no
daylight saving, so that is 09:00 Pacific in summer and 08:00 in winter.

### Setup, in order

1. **#278 first: prove the free plan takes API drafts.** In Kit, Send > Email
   Templates > New > HTML, paste `email/hq-dispatch/template.html`, save. Then:
   ```
   KIT_API_KEY=... node scripts/kit-spike.mjs templates           # note the HQ Dispatch id
   KIT_API_KEY=... node scripts/kit-spike.mjs create --template <id>
   ```
   Open the draft in Kit. Check the preview keeps the tables, send test emails
   to Gmail and Apple Mail, then `node scripts/kit-spike.mjs delete <id>`.
   Record the result (or the exact error) on #278 and #272. If the free plan
   refuses, stop here: the Worker needs a different shape.
   Also note the draft's real URL in Kit. If it is not
   `https://app.kit.com/campaigns/<id>/draft`, put the right pattern in
   `KIT_DRAFT_URL` (`{id}` is replaced).
2. **GitHub secret** `KIT_API_KEY` (Kit > Settings > Developer, a v4 key).
   `CLOUDFLARE_API_TOKEN`, `WEBSUB_SECRET` and `RESEND_API_KEY` already exist.
3. **Deploy**: Actions > "Deploy Kit draft Worker" > Run workflow.
4. **Dry run by hand**: `WEBSUB_SECRET=... node scripts/trigger-kit-draft.mjs`
   and check the preview email. Test the alert once:
   `node scripts/trigger-kit-draft.mjs --test-failure`.
5. **Switch on**: in `dispatch-kit-worker/wrangler.jsonc` set
   `"KIT_EMAIL_TEMPLATE_ID"` to the template id and `"CREATE_DRAFTS": "true"`,
   then merge. It still only ever makes drafts.

Do not change those vars in the Cloudflare dashboard: the next deploy
overwrites them with `wrangler.jsonc`.

### What goes in an issue, and who writes it

Order: masthead, issue line, editor's note (only if written), FEATURED,
LATEST FROM THE HQ, ALSO THIS WEEK (only if any), footer.

| Piece | Where it comes from | If it is missing |
| --- | --- | --- |
| Issue line | "Issue N \| Week of <Monday>", Pacific. N counts this Worker's drafts in Kit (a deleted draft frees its number); `ISSUE_NUMBER_OFFSET` adds issues sent before. Without a Kit key: the week alone. | n/a |
| Editor's note | **You**, before the Thursday run: `node scripts/trigger-kit-draft.mjs --note "Two or three lines."` (`--note ""` clears it). Used once, then cleared. Max 600 characters, no em dash. Or type it into the draft in Kit. | The block is left out entirely: no box, no gap. Nothing is ever written for you. |
| FEATURED subtitle | Your standfirst, printed whole: the Local CMS **Override Excerpt (Standfirst)**, else the Substack subtitle. Never rewritten. | Left out and listed under WRITE BEFORE SENDING. |
| FEATURED lede | A SEPARATE line: whole sentences from the article's opening paragraph (up to about 320 characters), minus any sentence that repeats the subtitle. This is where the date and place live. | Left out. |
| LATEST blurb | The CMS **Newsletter Summary (one line)** if written; else the subtitle when it is one line (220 characters or fewer, not already cut). Never the body's first sentence, never a YouTube description, never trimmed. | Left out and listed under WRITE BEFORE SENDING (the notice email and the draft's internal description in Kit). Videos need one written: their YouTube text is never used. |
| Inbox preview text | The FEATURED subtitle, whole if it fits 140 characters, else its first whole sentence. | Empty, and listed. |

**Duplicates (phase 1, newsletter only).** Two stories in one issue with the
same subject (the headline before its first " | " or ": ", with format words
such as Review, Reaction, Premiere, LA, Episode N set aside, years kept) or
the same link are one subject: the newest keeps its card, the other moves to
ALSO THIS WEEK (a one-line link, at most `MAX_ALSO`, 4), and the notice says
which and why. This runs on the Worker's copy of the list only: the site's
homepage, Intel, Feed and `/dispatch.xml` are untouched, and nothing is
deleted. Phase 2 (one combined card with Read the story AND Watch now) is
not built. Grouping by franchise (DC, Marvel...) is not on: it would move
every DC story but one out of the main list; switching it on is an owner call.

### Preview and test send (no Kit, no list)

```
npm run build
node scripts/dispatch-preview.mjs --out preview.html --issue 1 --note-placeholder \
  --subtitle "the-game-awards-2026-tickets-on-sale=<subtitle written in Substack, not synced yet>"
RESEND_API_KEY=... node scripts/send-dispatch-test.mjs --issue 1     # to andrew@beunconventionalhq.com ONLY
```

The preview inlines every image, so it opens on a phone. The test send
carries the images inside the email, so the new masthead shows before it is
deployed. `--subtitle` changes the preview only; the article and
`src/data/articles.json` are not touched.

### After merging: re-upload the email template to Kit (manual)

`template.html` changed (the masthead image and the label colours). Kit
keeps its own copy: Kit > Send > Email Templates > open the HQ Dispatch
template > switch to the HTML editor > select all, paste the new
`email/hq-dispatch/template.html` > Save. The new masthead
(`/dispatch/header-v2-1200x400.png`) only loads once the site is deployed,
so do this after the merge, not before.

### By topic: one FEATURED, four slots, the reader's choice (branch feat/newsletter-topics)

**The issue.** `LAYOUT: "topics"` (the default on this branch): FEATURED is
the newest story and the same for everyone. Under it, four slots, one per
topic: Film, TV, Games, Events, by each story's section. A topic with
nothing this week hands its slot on to the next. Events with no story falls
back to the **next upcoming event** on the calendar, as a card that says
only what the event document says (name, dates, venue) and links to its page
on the site. One card per subject still holds (dedupe), and there is no
ALSO THIS WEEK in this layout. `LAYOUT: "classic"` keeps the old shape.

**The reader's choice.** Readers pick topics in two places:
- **On signup:** one line under the email box, "Your topics: all four", and
  a "Choose topics" button that opens a dialog: "Choose what lands in your
  inbox", four topic cards (all on by default, each with a description and a
  checkmark) and a live line saying exactly what the reader will get. The
  cards sat inline once and made the box far too big (owner's call). Leaving
  them all off means all four.
- **On `/newsletter`:** the preference page. A reader types their address and
  gets a signed link by email (48 hours); the link opens their toggles, Save,
  and Unsubscribe. Knowing an address is not enough to change it. Every issue
  links there ("Choose your topics", address filled in by Kit), next to
  Kit's own Update preferences and one-click Unsubscribe, which stay.

Topics live in the Kit subscriber custom field `hq_topics` ("film,tv", empty
means all four). With `PERSONALIZE: "true"` the draft carries the slot rule
as Kit Liquid, so each reader gets four slots from their own topics.
FEATURED never changes. The rule (`fillSlots()`): an even share per topic
first (one topic 4, two topics 2 and 2, four topics 1 each), and any slot
left over (the fourth with three topics, or the share of a topic with too
few stories that week) goes to whichever chosen topic posted most recently.
So Film, TV and Games is one of each plus the newest of the three, which
varies week to week. The Worker works out all 15 combinations itself and
Kit only prints the one a reader chose.
`scripts/dispatch-topics.test.mjs` proves the Liquid picks exactly what the
rule picks for all 16 combinations.

**Preview any reader:** `node scripts/dispatch-preview.mjs --out p.html --reader "film,tv"`.

**Pick the FEATURED story for the next issue (optional):**
`node scripts/trigger-kit-draft.mjs --feature <slug, link or YouTube id>`.

**IMPORTANT, found while building this: site signups do not reach Kit
today.** The signup form saves addresses to Cloudflare KV only
(`subscriber:<email>`). Until that changes, nobody who signs up on the site
gets THE HQ DISPATCH from Kit. This branch adds the sync, OFF by default
(`KIT_SYNC_SIGNUPS`), and `scripts/kv-subscribers-to-kit.mjs` imports the
addresses already in KV (dry run first; `--execute` to import). Everyone it
imports goes through a Kit form, so they get Kit's confirmation email.

**Setup, in order (nothing changes until each step is done):**
1. Kit: create the custom field `hq_topics` (Kit > Grow > Subscribers >
   any subscriber > Add a custom field, or the API), and note the id of
   the Kit form whose confirmation email new signups should get, with its
   confirmation (double opt-in) email turned ON. **`KIT_FORM_ID` is
   required, not optional:** without it `saveKitTopics()` skips anyone Kit
   does not already have, so new site signups never reach Kit at all, and
   the KV import refuses to run.
2. Site Worker secrets (Cloudflare > Workers > beunconventionalhq >
   Settings > Variables and Secrets): `NEWSLETTER_LINK_SECRET` (a long
   random string), `KIT_API_KEY`, `KIT_FORM_ID`, and `KIT_SYNC_SIGNUPS` =
   `true` when ready. `RESEND_API_KEY` is already there. **Add every one as
   a Secret (encrypted), never a plain-text Variable, including the
   non-secret ones (`KIT_FORM_ID`, `KIT_SYNC_SIGNUPS`, `KIT_TOPICS_FIELD`):**
   `wrangler.jsonc` has its own `vars` block and no `keep_vars`, so every
   deploy from GitHub Actions deletes plain-text variables set in the
   dashboard. Secrets survive deploys. (Or add the non-secret ones to the
   `vars` block in `wrangler.jsonc` and commit them.)
   From a terminal: `npx wrangler secret put KIT_FORM_ID --name beunconventionalhq`.
3. The #278 check, extended: create a draft with `PERSONALIZE: "true"`, then
   check in Kit that two test subscribers with different `hq_topics` see
   different slots. If Kit does not render it, leave PERSONALIZE off: every
   reader gets one per topic and nothing breaks.
4. Re-upload `template.html` to Kit (the footer has the new topics link).

### Setup status (2026-11-05)

Done (checked through the Kit and Cloudflare APIs):
- Kit is on the **free** plan, and its v4 API works on it: a draft
  broadcast was created with the HQ Dispatch template and read back as a
  draft (#278). A per-reader topics draft (`create-personalized`) kept its
  `{% case %}` / `{% raw %}` Liquid intact; draft **26827763**, "per-reader
  topics test, delete me", is left in Kit for the owner's preview test.
- Kit sender: andrew@beunconventionalhq.com, verified. Its from-name is
  the bare address; set a display name in Kit if wanted.
- Kit custom field `hq_topics` created (id 1421790).
- `KIT_FORM_ID` = 9953749 ("Newsletter site") in `wrangler.jsonc` vars.
  Check in Kit that this form's confirmation (double opt-in) email is ON:
  the API does not show it.
- `KIT_EMAIL_TEMPLATE_ID` = 5554176 ("HQ Dispatch") in
  `dispatch-kit-worker/wrangler.jsonc`. The Kit API cannot read or update
  an HTML template's HTML, so re-pasting `template.html` into it is by hand.
- Site Worker secrets: `KIT_API_KEY` and `RESEND_API_KEY` set. Resend's
  domain beunconventionalhq.com is verified. GitHub secret `KIT_API_KEY` set.
- KV import dry run: 4 subscriber records, 4 would import, none skipped.
- Free-plan fit: the account will have 3 cron triggers (substack relay,
  Kit Worker, social Worker) of the 5 Workers Free allows; both Durable
  Objects use SQLite storage, which Workers Free includes.

Still open:
- `NEWSLETTER_LINK_SECRET` on the site Worker. **Not through the dashboard
  while a branch preview is the newest version:** on 2026-11-05 adding
  `KIT_API_KEY` in the dashboard built from the newest version, which was
  the `feat-newsletter-topics` preview, and deployed it to production; a
  manual run of `deploy.yml` put main back. Use
  `npx wrangler versions secret put NEWSLETTER_LINK_SECRET --name beunconventionalhq`
  (saves on a new version without deploying), or the dashboard right after
  a production deploy.
- The KV import with `--execute` (sends each of the 4 Kit's confirmation
  email), `KIT_SYNC_SIGNUPS`, `CREATE_DRAFTS`, `PERSONALIZE`: owner's calls.
- The two Workers deploy only after the merge (their code is not on main).

### Decisions (made by Claude at the owner's request, 2026-10-31)

The owner asked for these to be decided for now. Each can be reversed.

| Question | Decision | Why |
| --- | --- | --- |
| Import the existing KV signups into Kit? | **Yes, through a Kit form**, so each gets Kit's confirmation email (`CLOUDFLARE_API_TOKEN=... KIT_API_KEY=... KIT_FORM_ID=... node scripts/kv-subscribers-to-kit.mjs`; all three are required, the Cloudflare token to read KV; dry run first, `--execute` to import). | The site never sent a confirmation. A list that never confirmed is how a first send lands in spam, and confirming is the clean consent record. Some people will not confirm; that is the cost. |
| What is FEATURED? | **The newest story**, unless the owner picks one for the issue: `node scripts/trigger-kit-draft.mjs --feature <slug, link or YouTube id>` before Thursday (used once, then cleared; `--feature ""` clears). | Hands-off by default, editorial when it matters. The newest story still names the issue in Kit, so a pick never breaks the duplicate guard. A pick not in this week's stories is reported and the newest leads. |
| Can a story with no section lead? | **Yes**, but it never fills a topic slot. | FEATURED is "the story of the week", not a topic. |
| ALSO THIS WEEK in the topics layout? | **No.** | Condensing was the point. Duplicates are left out and listed in the notice. The classic layout keeps it. |
| Group duplicates by franchise (DC, Marvel)? | **No.** Same title or same link only. | By franchise, every DC story but one would leave the main list most weeks. |
| Combined review + reaction card (dedupe phase 2)? | **Not now.** | Phase 1 needs a real issue or two first. |
| Issue numbers | **Start at 1** (`ISSUE_NUMBER_OFFSET` 0). | No issue has been sent yet. |
| Label colour | **Keep #ff6b6b.** | 6.8:1 on the box, still reads as the brand red. |

### Editorial opt-out (#275)

Undecided, so the default stands: every published article and long-form
video is eligible, and you curate at the draft review in Kit (delete a box
there). Nothing in the feed or the Worker filters stories.

## The RSS route (needs Kit's paid Creator plan, NOT our launch path)

Kept for when the plan changes. **Do not enable it while the Worker runs**:
two routes would build two newsletters.

1. **Template.** Kit > Send > Email Templates > New > HTML. Paste `template.html`. Save.
2. **RSS feed.** Kit > Automate > RSS > add `https://beunconventionalhq.com/dispatch.xml`. Choose **digest** mode, weekly, on the day and time you want.
3. **Broadcast body.** In the RSS broadcast, pick the HQ Dispatch template. Keep the **Post** content block (Kit won't enable the feed without it). Open its Post Template tab, switch to HTML, paste `post-template.liquid.html`.
4. **Preview text** goes in the broadcast's preview text setting.

The site must be deployed before Kit reads the feed: the header, fallback
and story images are served from the site.

## Liquid and RSS notes

### Kit tags in `template.html`

| Tag | Notes |
| --- | --- |
| `{{ message_content }}` | Required. The Post Template's output lands here. |
| `{{ unsubscribe_url }}` | Required (or `unsubscribe_link`). Only ever as an `href`. |
| `{{ subscriber_preferences_url }}` | Optional; kept so readers can change what they get instead of leaving. |
| physical address | Required, as `{{ address }}` **or typed**. It's typed: "Anaheim, CA 92805". |

**Never write a Kit tag, braces and all, inside an HTML comment in
`template.html`.** Kit runs Liquid over the whole file, comments included.
The first draft named the tags in its header note, the broadcast was rendered
into the comment, and the page broke. The test fails if one comes back.

### Kit variables in `post-template.liquid.html`

On the launch path the site renders this template itself (liquidjs, at
build time, `src/lib/dispatch-boxes.ts`), with each post shaped exactly as
Kit's RSS would hand it over (`dispatchKitPost()` in `dispatch-feed.ts`).
The table holds for both routes.

| Variable | From the feed | Used for |
| --- | --- | --- |
| `posts` | new items since the last send | The loop, `limit: 6`: one FEATURED, up to five LATEST |
| `post.title` | `<title>` | Headline and image alt text |
| `post.url` | `<link>` | Image, headline and button links |
| `post.summary` | `<description>` | Summary |
| `post.categories` | `<category>` x2 | Label "TYPE \| SECTION"; `Video` makes the button **Watch now** |
| `post.content` | `<content:encoded>` | **The image**: the first `<img src="…">` |

**Kit has no image variable** (its RSS fields are title, author, date,
categories, url, summary and content). So the feed puts the image first in
`content:encoded` and the Post Template splits on the first `src="`.

### What `/dispatch.xml` provides

`/rss.xml` is left alone: it's the Google News feed. `/dispatch.xml` lists
the **20 newest** stories, articles and long-form videos together (no shorts,
no live streams). Kit makes the first new one FEATURED, so the newest story
leads. Each item:

| Element | Value |
| --- | --- |
| `<title>` | The story title |
| `<link>` | Article: `https://beunconventionalhq.com/intel/<slug>` (no trailing slash). Video: its YouTube watch URL; the site has no per-video page. |
| `<description>` | The editorial summary (`editorialPreview()`, the same text the site's cards use) |
| `<pubDate>` | Publish time |
| `<category>` | Content type (`Review`, `Analysis`… or `Video`), then section (`Film`, `TV`, `Games`, `Events`; omitted when "General") |
| `<content:encoded>` | `<img src="https://beunconventionalhq.com/dispatch/images/<id>.jpg" width="1200" height="675" alt="">` then the summary |

## Assets

All hosted on the site; nothing to host by hand.

| Asset | Where |
| --- | --- |
| Header, 1200x400 | `public/dispatch/header-1200x400.png`, referenced absolutely from `template.html`. To use other art, replace that URL with any absolute https URL to a 1200x400 image. |
| Fallback art, 1200x675 | `public/dispatch/fallback-1200x675.jpg` |
| Story images, 1200x675 | `public/dispatch/images/`, built by the sync |
| Address | Typed in the template: Anaheim, CA 92805 |

**On the address:** US anti-spam law (CAN-SPAM) asks for a valid physical
postal address: a street address, a PO box, or a registered private mailbox.
City and ZIP alone may not count. If Kit or a mailbox provider objects, a PO
box in Anaheim is the usual fix, typed on that same line.

## Testing checklist

Send test broadcasts from Kit to real inboxes. Litmus or Email on Acid covers
more clients faster.

**Kit itself**
- [ ] Kit accepts the template on save (the address is typed, so Kit's own address check should pass on the text).
- [ ] **The Post Template keeps the tables.** View the source of a test email. If Kit strips `<table>` or the `class` attributes, the boxes break. The one thing that can't be tested offline.
- [ ] The feed validates in Kit and the first digest lists this week's stories, newest as FEATURED.
- [ ] `limit: 6`, `forloop`, `contains`, `split` and `truncatewords` render (standard Liquid; confirm Kit's build has them).
- [ ] A title with `&` or a curly apostrophe shows once, not as `&amp;` or `â€™`.
- [ ] Unsubscribe and Update preferences work on a test subscriber.

**Gmail (web, iOS, Android)**
- [ ] Not clipped ("[Message clipped]"). Gmail clips at 102 KB; five stories are about 50 KB before Kit's tracking. Re-measure before raising `limit: 6`.
- [ ] iOS dark mode: headlines and button text stay white.
- [ ] Web: links turn red on hover.
- [ ] A non-Google address in the Gmail app (it ignores `<style>`): layout holds, nothing scrolls sideways.

**Apple Mail (macOS, iPhone, iPad)**
- [ ] Light and dark appearance look the same.
- [ ] Red glow top right of the masthead.
- [ ] macOS hover: links red, box border red, button fills red.

**Outlook**
- [ ] Outlook desktop (classic): 600px column centred, boxes drawn, outline button intact, thumbnails centred vertically. Gradients are expected to be missing.
- [ ] New Outlook / Outlook.com dark mode: colours not re-mapped to grey.

**Phones, 320 to 430px**
- [ ] No horizontal scrolling at 320, 375, 390 and 430.
- [ ] Every image whole and 16:9: FEATURED full width, LATEST thumbnails full width above their text. Header 3:1.
- [ ] 44px tap targets.

**Images off**
- [ ] The header's alt text reads "THE HQ DISPATCH". Boxes keep their shape; headlines still link.

**Verified offline before handoff** (`npm test`, plus a build)
- Kit's required tags, no Liquid inside HTML comments, charset in the first 1024 bytes, the typed address.
- `role="presentation"` on every table, alt on every image, no em dashes, no flex or grid, no X.
- Every text link has a site resting state and a red hover.
- The Liquid rendered by liquidjs: FEATURED first, six boxes at most, 16:9 images, the Video button, the fallbacks, thumbnails centred vertically.
- The composer keeps all four edges of a wide and a tall image and trims only YouTube's letterbox bars; every committed story image is 1200x675.
- `/dispatch.xml` built: 20 items, each with its composed image first in `content:encoded`.
- In a browser at 320 and 375px, with and without `<style>`: no sideways scroll, every image 16:9, header 3:1.
