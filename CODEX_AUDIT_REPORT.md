# Codex Audit Report: Be Unconventional HQ

## Summary

The Astro static site was cleaned up and reorganized for maintainability, GitHub Pages compatibility, metadata quality, and smoother frontend interactions. The site remains Astro v6, Tailwind CSS v4 via `@tailwindcss/vite`, vanilla CSS, and GitHub Pages-ready with base path `/BeUnconventionalHQ/`.

## Files Modified

- `src/components/Categories.astro`
- `src/components/Navbar.astro`
- `src/layouts/Layout.astro`
- `src/pages/index.astro`
- `src/styles/global.css`

## Files Created

- `src/components/Hero.astro`
- `src/data/categories.js`
- `src/data/site.js`
- `public/robots.txt`

## Main Cleanup Completed

- Removed duplicated/commented navbar styles from `Navbar.astro`.
- Removed empty/redundant component style blocks.
- Moved inline hero and category styles into reusable CSS classes in `global.css`.
- Confirmed `Layout.astro` imports `global.css` and `theme-red.css`.
- Confirmed `Navbar` is imported in `Layout.astro`, not `index.astro`.
- Extracted the hero section into `src/components/Hero.astro`.
- Moved hardcoded category data into `src/data/categories.js`.
- Moved site metadata defaults into `src/data/site.js`.
- Removed duplicate animation keyframes from `Categories.astro`.
- Preserved the Ken Burns animation.
- Preserved the existing color and font system.
- Preserved GitHub Pages base path compatibility.

## Features Added

- Hero CTA hover effect:
  - Bright red hover state
  - `scale(1.02)` transform
  - Red glow box-shadow
  - Smooth `0.3s ease` transition

- Open Graph and Twitter meta tags in `Layout.astro`:
  - `og:title`
  - `og:description`
  - `og:image`
  - `og:url`
  - `og:type`
  - `twitter:card`
  - `twitter:title`
  - `twitter:description`
  - `twitter:image`

- Scroll animation system:
  - `.animate-on-scroll`
  - IntersectionObserver in `Layout.astro`
  - `data-delay` stagger support
  - Applied to category cards

- Active nav state:
  - Uses `Astro.url.pathname`
  - Adds `active` class to matching nav links
  - Active links use accent color and bottom indicator

- Hero parallax:
  - Scroll listener moves hero background at `0.4x` scroll speed
  - Max movement capped at `80px`
  - Uses CSS custom property and `transform`
  - Keeps Ken Burns animation intact

- SEO crawler file:
  - Added `public/robots.txt`

## Verification

- Ran `npx prettier --write src`.
- Ran `npm run build`.
- Build completed successfully.
- Generated production CSS is emitted under `/BeUnconventionalHQ/assets/`.
- No new npm packages were installed.

## Remaining Items For Human Review

- `robots.txt` references `sitemap.xml`, but the project does not currently generate a sitemap.
- Social links in `src/data/site.js` are placeholders and can be filled in later.
- Additional pages such as `/videos`, `/articles`, `/about`, `/contact`, and `/events` are linked but not yet implemented in this audit.

## Current File Tree

```text
public/.nojekyll
public/banner.png
public/favicon.ico
public/favicon.svg
public/logo.png
public/profile.jpg
public/robots.txt
src/components/Categories.astro
src/components/Hero.astro
src/components/Navbar.astro
src/data/categories.js
src/data/site.js
src/layouts/Layout.astro
src/pages/index.astro
src/styles/global.css
src/styles/theme-gold.css
src/styles/theme-red.css
```

## Key Implementation Notes

- `index.astro` is now intentionally small:

```astro
---
import Layout from '../layouts/Layout.astro';
import Categories from '../components/Categories.astro';
import Hero from '../components/Hero.astro';
---

<Layout title="Be Unconventional HQ">
  <Hero />
  <Categories />
</Layout>
```

- `Layout.astro` now owns shared metadata, navbar rendering, and scroll animation setup.
- `Hero.astro` owns hero markup and parallax behavior.
- `Navbar.astro` owns nav links and active route logic only.
- `Categories.astro` imports category data and renders semantic category cards only.
- `global.css` owns navbar, hero, CTA, category, and scroll animation styling.
