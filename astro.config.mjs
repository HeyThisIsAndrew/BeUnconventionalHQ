// @ts-check
import { defineConfig, envField } from 'astro/config';
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
          /** @type {Buffer[]} */
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
          /** @type {Buffer[]} */
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
  // 'ignore' (default): dev accepts links with or without a trailing slash.
  // Production (Cloudflare Workers, not Pages) serves the canonical
  // no-trailing-slash form via assets.html_handling: "drop-trailing-slash"
  // in wrangler.jsonc, matching how every internal link in this codebase
  // is already written. Canonical <link> (Layout.astro) and the sitemap
  // (serialize below) are normalized to match — a mismatch here means a
  // canonical tag or sitemap entry points at a URL that immediately
  // redirects elsewhere.
  trailingSlash: 'ignore',
  redirects: {
    '/articles': '/feed/articles',
    '/videos': '/feed/videos',
    '/events-new': '/events',
    // The collaborations hub lived at /press-kit until it grew a second
    // one-sheet and stopped being just a press kit. Anything already shared
    // with a publicist or brand points at the old path.
    '/press-kit': '/collaborations',
  },
  // ClientRouter already swaps pages without a full reload; prefetching the
  // destination on hover/touch-start is what makes that swap feel instant
  // rather than merely fast. 'hover' rather than 'load' so we are not pulling
  // every linked page on a phone's data plan.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  image: {
    // Every <Image> gets a srcset and sizes by default. This is the structural
    // fix behind a real bug: the /links logo carried no width, so Astro used
    // the source's intrinsic 2000x2000 and shipped a 413KB render into a
    // 340px box. With a default layout an unsized image cannot silently go
    // out at source resolution again.
    layout: 'constrained',
    responsiveStyles: true,
  },

  // Typed, validated env access. Replaces reading import.meta.env directly,
  // where a missing variable is indistinguishable from an empty string and
  // surfaces as a runtime error in the browser instead of a build failure.
  // PUBLIC_TURNSTILE_SITE_KEY is optional on purpose: the subscribe widget is
  // designed to omit itself when there is no key, so builds without one (CI,
  // local, preview) must still succeed.
  env: {
    schema: {
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      TURNSTILE_SECRET_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      RESEND_API_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      WEBSUB_SECRET: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
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
        /*
          Route third-party tag scripts through our own origin.

          Partytown executes tags inside a web worker, and a worker fetching a
          cross-origin script needs CORS headers on the response. The pixel
          vendors do not send them, so TikTok failed in production with
          "No 'Access-Control-Allow-Origin' header is present" while Meta and
          Clarity were refused by the CSP. Proxying makes the request
          same-origin, which resolves both at once.

          Any host added here MUST also be added to the allowlist in
          src/pages/api/proxy.js, or the proxy answers 403. See issue #63.
        */
        resolveUrl: function(url, location, type) {
          const proxiedHosts = [
            'www.googletagmanager.com',
            'www.google-analytics.com',
            'analytics.google.com',
            // Meta Pixel
            'connect.facebook.net',
            // TikTok Pixel
            'analytics.tiktok.com',
            // Microsoft Clarity
            'www.clarity.ms',
            'c.clarity.ms',
          ];
          if (type === 'script' && proxiedHosts.includes(url.hostname)) {
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
      // /collaborations/press-kit is the same: a direct-share one-sheet
      // reached from /collaborations (which stays in the sitemap) and
      // carrying its own noindex, so it must not be advertised as a separate
      // canonical destination. The '/press-kit' test matches both it and the
      // legacy /press-kit redirect stub, neither of which belongs here.
      filter: (page) => {
        const url = new URL(page);
        const path = url.pathname.replace(/\/$/, '');
        const excludedPaths = [
          '/links',
          '/admin',
          '/local-cms',
          '/media-kit',
          '/press-kit',
          '/collaborations/press-kit',
          '/articles',
          '/videos',
          '/events-new'
        ];
        return !excludedPaths.includes(path);
      },
      // Strip trailing slashes to match assets.html_handling:
      // "drop-trailing-slash" — otherwise every sitemap entry sends
      // crawlers through an extra redirect hop before reaching the
      // canonical URL.
      serialize: (item) => {
        const url = new URL(item.url);
        if (url.pathname !== '/' && url.pathname.endsWith('/')) {
          url.pathname = url.pathname.slice(0, -1);
        }
        return { ...item, url: url.toString() };
      },
    }),
    sanity({
      projectId: '38nhxsib',
      dataset: 'production',
      useCdn: process.env.NODE_ENV === 'production', // Set to false in dev for fresh data, true in prod for CDN cache
      apiVersion: '2024-03-01',
      // Like /local-cms, the Studio is a dev-only tool; don't ship it to production
      studioBasePath: process.env.NODE_ENV === 'production' ? undefined : '/admin',
    }),
  ],
  adapter: cloudflare({
    /*
      ─── BUILD-TIME IMAGE OPTIMISATION, NOT RUNTIME ─────────────────────────
      This is the fix for the ~938KB mobile image payload behind the 3.4s LCP.

      The adapter's DEFAULT is `'cloudflare'`, which defers resizing to a
      runtime `/_image` route backed by a Cloudflare Images binding. The build
      log announces it cheerfully — "Enabling image processing with Cloudflare
      Images ... with the 'IMAGES' Images binding" — but wrangler.jsonc
      declares no such binding, and Cloudflare Images is a paid add-on that was
      never provisioned. So every `/_image?href=…` request had nothing to
      serve it, and the browser fell back to the untouched originals in
      `/assets/`: logo.webp at 466KB and logo-mark.webp at 414KB. Two logos,
      880KB, on a page that displays them at 150px.

      `'compile'` runs the same sharp pipeline Astro uses locally, at BUILD
      time, and emits plain static files. No binding, no paid add-on, no
      runtime hop — and it also fixes local `astro preview`, where those
      `/_image` requests were returning 404 and rendering broken logos.

      Trade-off, stated plainly: builds do more work up front, and only images
      Astro can see at build time are optimised. Every `<Image>` on this site
      imports from `src/assets/`, so that covers all of them; remote thumbnails
      (YouTube, article covers) are plain `<img>` tags and were never in scope
      for this pipeline either way.
    */
    imageService: 'compile',
  }),
});
