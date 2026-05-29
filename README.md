# Be Unconventional HQ

A cinematic creator hub for film, TV, gaming, and live events — built with [Astro](https://astro.build) as a fast, static-first site. Content (YouTube videos + Substack articles) is fetched at build time and baked into the HTML, so the live site stays fresh on every deploy with zero runtime backend.

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

`npm run dev` fetches the latest content, then starts the dev server at
`http://localhost:4321`. It also prints a **network URL and a QR code** so you
can open the site on your phone (same Wi-Fi) while developing.

| Command           | What it does                                           |
| :---------------- | :----------------------------------------------------- |
| `npm run dev`     | Fetch content + start dev server (with mobile QR code) |
| `npm run build`   | Generate the static site into `./dist/`                |
| `npm run preview` | Serve the built `./dist/` locally                      |

## Content pipeline

`scripts/fetch-feeds.mjs` runs automatically before `dev` and `build` and writes
two caches under `src/data/cache/`:

- **Articles** — Substack RSS (`/feed`).
- **Videos** — YouTube. The channel's RSS feed currently 404s, so the script
  falls back to scraping the channel's Videos tab (`ytInitialData`). Thumbnails
  use `maxresdefault` with an `hqdefault` fallback.

Pages read these caches via `src/data/feeds.js` (`getArticles()` / `getVideos()`).
If a fetch fails, the previous cache is kept so the build never breaks.

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
  data/            site.js, categories.js, constants.js, feeds.js, cache/
  layouts/         Layout.astro (head, GA4, nav/footer, reveal observer)
  pages/           index, videos, articles, about, contact, links
  styles/          app.css (design tokens + base + utilities)
```

## Deployment — Cloudflare Pages

The site is a static `dist/` build, hosted on **Cloudflare Pages**.

**Option A — Git integration (recommended):** connect the repo in the Cloudflare
Pages dashboard with:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `NODE_VERSION = 22.12.0` (or rely on `.nvmrc`)

**Option B — direct upload via Wrangler:**

```bash
npm run build
npx wrangler pages deploy
```

`wrangler.toml` already sets `pages_build_output_dir = "dist"`. The custom domain
(`beunconventionalhq.com`) is managed in the Cloudflare dashboard.

## License

Private project. All rights reserved. © 2026 Be Unconventional HQ.
