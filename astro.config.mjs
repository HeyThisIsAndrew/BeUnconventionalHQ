// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import sanity from '@sanity/astro';
import react from '@astrojs/react';
import partytown from '@astrojs/partytown';

// Dev-only Local CMS backing store: GET/POST src/data/videos.json straight off
// disk. Only wired into the Vite DEV server (configureServer never runs for
// `astro build`), so this never ships to the production worker bundle.
function localCmsMiddleware() {
  return {
    name: 'local-cms-api',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.middlewares.use('/api/local-cms/videos', /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {Function} next */ (req, res, next) => {
        const filePath = path.resolve(process.cwd(), 'src/data/videos.json');
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filePath, 'utf-8'));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', /** @param {Buffer} chunk */ chunk => body += chunk);
          req.on('end', () => {
            try {
              JSON.parse(body);
            } catch (err) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Invalid JSON, videos.json left untouched.' }));
              return;
            }
            // Atomic write: write to a temp file in the same directory (so the
            // rename is on the same filesystem, a true atomic swap), then
            // rename over the real path. A crash mid-write leaves the temp
            // file corrupted, never videos.json itself.
            const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
            fs.writeFileSync(tmpPath, body, 'utf-8');
            fs.renameSync(tmpPath, filePath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          });
          return;
        }
        next();
      });
    }
  };
}

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
    plugins: [tailwindcss(), localCmsMiddleware()],
    ssr: {
      noExternal: ['react', 'react-dom']
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime', '@sanity/client']
    }
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
      // /local-cms is the dev-only Local CMS admin route — same reasoning.
      filter: (page) =>
        !page.includes('/links') && !page.includes('/admin') && !page.includes('/local-cms'),
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
