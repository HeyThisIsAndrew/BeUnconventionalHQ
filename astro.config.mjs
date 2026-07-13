// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import sanity from '@sanity/astro';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://beunconventionalhq.com',
  base: '/',
  // 'ignore' (default): dev accepts links with or without a trailing slash,
  // and Cloudflare Pages serves the canonical trailing-slash form in prod.
  // Canonical <link> and the sitemap are normalized to trailing slashes.
  trailingSlash: 'ignore',
  build: {
    assets: 'assets',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    react(),
    sitemap(),
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
