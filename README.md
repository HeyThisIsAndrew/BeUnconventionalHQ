# Be Unconventional HQ

A cinematic creator hub for film, TV, gaming, and live events — built with [Astro](https://astro.build) as a static site for self-hosting. Content is fetched into local JSON caches, then baked into `dist/` so the finished site can be served by any plain web server.

## Requirements

- **Node 22.12+** (Astro 6 requires it). The repo pins this in `.nvmrc`.

```bash
nvm install   # first time — reads .nvmrc
nvm use       # selects Node 22.12
```

## Local development

```bash
npm install
npm run dev
```

`npm run dev` refreshes the local content cache, then starts the dev server at
`http://localhost:4321`. It also prints a **network URL and a QR code** so you
can open the site on your phone (same Wi-Fi) while developing.

| Command           | What it does                                           |
| :---------------- | :----------------------------------------------------- |
| `npm run refresh-content` | Fetch the latest articles/videos into `src/data/cache/` |
| `npm run dev`     | Refresh content + start dev server (with mobile QR code) |
| `npm run build`   | Generate the static site into `./dist/` from the current cache |
| `npm run build:live` | Refresh content, then build `./dist/` for deployment |
| `npm run preview` | Serve the built `./dist/` locally                      |

## Content pipeline

`scripts/fetch-feeds.mjs` refreshes two caches under `src/data/cache/`:

- **Articles** — Substack RSS (`/feed`).
- **Videos** — YouTube. The channel's RSS feed currently 404s, so the script
  falls back to scraping the channel's Videos tab (`ytInitialData`). Thumbnails
  use `maxresdefault` with an `hqdefault` fallback.

Pages read these caches via `src/data/feeds.js` (`getArticles()` / `getVideos()`).
If a fetch fails, the previous cache is kept so scheduled builds do not wipe out
working content.

### Categorization

Items are sorted into **Film / TV / Gaming / Events** by a weighted keyword
classifier in `fetch-feeds.mjs` (`categorize()` + the `SIGNALS` table). It scores
phrasing ("out of theater reaction" → Film), streaming/season cues → TV,
conventions → Events, and a list of recurring franchises. It's heuristic, not AI
— to improve it, add terms to the relevant `SIGNALS` list.

## Project structure

```text
public/            Static assets (logo, banner, profile, category icons)
scripts/           fetch-feeds.mjs (ingestion) + dev.mjs (dev server + QR)
src/
  components/      Nav, Footer, Hero, cards, Socials, etc.
  data/            site.js, categories.js, constants.js, content-source.js, feeds.js, cache/
  layouts/         Layout.astro (head, GA4, nav/footer, reveal observer)
  pages/           index, videos, articles, about, contact, links
  styles/          app.css (design tokens + base + utilities)
```

## Self-hosting

The site builds to plain static files in `dist/`. Serve that folder with
`nginx`, `caddy`, Apache, or any static file host on your own machine.

Typical production flow on a Raspberry Pi or Linux box:

```bash
npm install
npm run build:live
```

Point your web server at the generated `dist/` directory.

### Automatic refreshes

If you want the site to update itself without manual rebuilds, schedule:

```bash
npm run build:live
```

A simple cron example that refreshes every 30 minutes:

```cron
*/30 * * * * cd /path/to/BeUnconventionalHQ && /usr/bin/npm run build:live >> /var/log/beunconventionalhq.log 2>&1
```

If you prefer `systemd`, run the same command from a timer/service pair.

### Deployment notes

- The repo requires Node `22.12+`.
- `npm run build` only uses the current cache.
- `npm run build:live` is the right command for unattended refresh-and-publish jobs.
- If upstream fetches fail temporarily, the previous cache is preserved.

## License

Private project. All rights reserved. © 2026 Be Unconventional HQ.
