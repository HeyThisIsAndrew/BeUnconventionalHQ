// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import sanity from '@sanity/astro';
import react from '@astrojs/react';
import partytown from '@astrojs/partytown';

export default defineConfig({
  site: 'https://beunconventionalhq.com',
  base: '/',
  // 'ignore' (default): dev accepts links with or without a trailing slash,
  // and Cloudflare Pages serves the canonical trailing-slash form in prod.
  // Canonical <link> and the sitemap are normalized to trailing slashes.
  trailingSlash: 'ignore',
  redirects: {
    '/articles': '/feed/articles',
    '/videos': '/feed/videos',
    '/events-new': '/events',
  },
  build: {
    assets: 'assets',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    partytown({
      config: {
        forward: ['dataLayer.push'],
        resolveUrl: function(url, location, type) {
          if (
            type === 'script' &&
            (url.hostname === 'www.googletagmanager.com' ||
             url.hostname === 'www.google-analytics.com' ||
             url.hostname === 'analytics.google.com')
          ) {
            const proxyUrl = new URL('/api/proxy', location.origin);
            proxyUrl.searchParams.append('url', url.href);
            return proxyUrl;
          }
          return url;
        }
      },
    }),
    react(),
    sitemap({
      // WIP routes are excluded from the sitemap so Google doesn't treat them
      // as canonical destinations. Paired with a noindex meta on the pages
      // themselves and a robots.txt Disallow. Remove this filter (and both
      // gates) when /events-new is promoted to /events.
      // /links is a bio/entry utility route (noindex, no robots block — see
      // links.astro) and shouldn't be advertised as a canonical destination.
      // /admin is the embedded Sanity Studio (injected by studioBasePath) —
      // a CMS interface must never be advertised to search engines.
      filter: (page) =>
        !page.includes('/links') && !page.includes('/admin'),
    }),
    sanity({
      projectId: '38nhxsib',
      dataset: 'production',
      useCdn: false, // Set to false to ensure fresh data during development
      apiVersion: '2024-03-01',
      studioBasePath: '/admin',
    }),
  ],
  adapter: cloudflare(),
});
