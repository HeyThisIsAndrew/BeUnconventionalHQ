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
import { createClient } from '@sanity/client';

// Same project the Studio and urlFor() already point at (src/lib/local-content.ts).
const SANITY_PROJECT_ID = '38nhxsib';
const SANITY_DATASET = 'production';

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
          let chunks = [];
          let totalLength = 0;
          let tooLarge = false;
          req.on('data', /** @param {Buffer} chunk */ chunk => {
            if (tooLarge) return;
            chunks.push(chunk);
            totalLength += chunk.length;
            if (totalLength > 50 * 1024 * 1024) { // 50MB limit
              tooLarge = true;
              res.statusCode = 413;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
              req.on('error', () => {}); // Catch unhandled destroy errors
              req.destroy();
            }
          });
          req.on('end', () => {
            if (tooLarge) return;
            let body = '';
            try {
              body = Buffer.concat(chunks).toString('utf-8');
              JSON.parse(body);
            } catch (err) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Invalid JSON, videos.json left untouched.' }));
              return;
            }
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

      // Uploads straight to Sanity's asset store (already the image host for
      // every existing event/featuredBrand doc - see urlFor() in
      // local-content.ts) instead of public/uploads/, which is gitignored by
      // design (dev-only tool, must never ship image files into the repo) and
      // therefore could never actually serve an uploaded image in production.
      // Returns the bare asset id ("image-<hash>-<W>x<H>-<ext>") - a plain
      // string, kept out of resolving it to a CDN URL here so urlFor() stays
      // the single place that happens, same as every other image on the site.
      server.middlewares.use('/api/local-cms/upload', /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {Function} next */ (req, res, next) => {
        if (req.method === 'POST') {
          let chunks = [];
          let totalLength = 0;
          let tooLarge = false;
          req.on('data', /** @param {Buffer} chunk */ chunk => {
            if (tooLarge) return;
            chunks.push(chunk);
            totalLength += chunk.length;
            if (totalLength > 50 * 1024 * 1024) { // 50MB limit
              tooLarge = true;
              res.statusCode = 413;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
              req.on('error', () => {}); // Catch unhandled destroy errors
              req.destroy();
            }
          });
          req.on('end', async () => {
            if (tooLarge) return;
            try {
              const body = Buffer.concat(chunks).toString('utf-8');
              const parsed = JSON.parse(body);
              if (!parsed.filename || !parsed.data) {
                throw new Error('Missing filename or data');
              }
              const base64Data = parsed.data.split(',')[1];
              if (!base64Data) throw new Error('Invalid base64');
              const buffer = Buffer.from(base64Data, 'base64');

              const token = process.env.SANITY_WRITE_TOKEN;
              if (!token) {
                throw new Error('SANITY_WRITE_TOKEN is not set in .env - required to upload images via the Local CMS. See .env.example.');
              }

              const client = createClient({
                projectId: SANITY_PROJECT_ID,
                dataset: SANITY_DATASET,
                token,
                apiVersion: '2024-03-01',
                useCdn: false,
              });
              const asset = await client.assets.upload('image', buffer, { filename: parsed.filename });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ref: asset._id }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
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
      include: ['react', 'react-dom', 'react/jsx-runtime'],
      exclude: ['@sanity/client']
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
    {
      name: 'dev-only-routes',
      hooks: {
        'astro:config:setup': ({ injectRoute, command }) => {
          if (command === 'dev') {
            injectRoute({
              pattern: '/local-cms',
              entrypoint: 'src/dev-routes/local-cms.astro'
            });
          }
        }
      }
    },
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
      // /media-kit is a direct-share-only PDF route.
      filter: (page) =>
        !page.includes('/links') && !page.includes('/admin') && !page.includes('/local-cms') && !page.includes('/media-kit'),
    }),
    sanity({
      projectId: '38nhxsib',
      dataset: 'production',
      useCdn: process.env.NODE_ENV === 'production', // Set to false in dev for fresh data, true in prod for CDN cache
      apiVersion: '2024-03-01',
      studioBasePath: '/admin',
    }),
  ],
  adapter: cloudflare(),
});
