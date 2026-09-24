/**
 * Built-site image checks: run AFTER `npm run build`, over every page in
 * dist/client. `npm test` reads source, and these problems only exist once a
 * component has been rendered with real data, so they were invisible to it.
 *
 * Why each rule exists (the site-wide audit of 2026-09):
 *
 *  1. ONE high-priority image per page. `fetchpriority="high"` on several
 *     different images splits the bandwidth the LCP image needs under a slow
 *     connection. /featured shipped four (one per category row, three of them
 *     collapsed) and /feed shipped a 3364px logo at high priority beside its
 *     hero. Counted by distinct `src`: the /feed stage paints one file twice
 *     (a contained copy over a blurred fill), which is one download.
 *
 *  2. No ORIGINAL from Sanity. A `cdn.sanity.io/images/...` URL with no query
 *     string is the uploaded file itself (Ketchup's logo: 3364x1091 PNG, shown
 *     at most 420px wide). Size it through urlFor(...).width()/.height().
 *
 *  3. No ORIGINAL from Substack's S3 bucket. One measured 3840x2160 and
 *     1.2 MB inside a 640px box; getCardImageSources() makes a rendition.
 *
 * Run:  node scripts/built-images.check.mjs   (exit 1 on any violation)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'client');

if (!fs.existsSync(DIST)) {
  console.error('dist/client not found: run `npm run build` first.');
  process.exit(1);
}

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
})(DIST);

/* Standalone print documents (see CLAUDE.md "Conventions"): noindexed, not
   part of the site's navigation, and printed rather than browsed. Their
   images are reported by the audit but are not held to these rules. */
const EXEMPT = ['/media-kit/', '/collaborations/press-kit/', '/local-cms/'];

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, '&') : null;
};
const urlsIn = (tag) => {
  const out = [];
  const src = attr(tag, 'src');
  if (src) out.push(src);
  const srcset = attr(tag, 'srcset');
  /* Candidates are separated by a comma AND whitespace before the next URL.
     A bare split(',') breaks Substack's resize URLs, which contain commas
     ("$s_!x!,f_auto,q_auto:eco,w_600,c_limit/https%3A..."). */
  if (srcset) for (const part of srcset.split(/,\s+(?=https?:|\/)/)) out.push(part.trim().split(/\s+/)[0]);
  return out;
};
const RAW_SANITY = /^https:\/\/cdn\.sanity\.io\/images\/[^?]+$/;
const RAW_S3 = /substack-post-media\.s3\.amazonaws\.com/;

const failures = [];
for (const file of pages) {
  const route = '/' + path.relative(DIST, file).replace(/index\.html$/, '').split(path.sep).join('/');
  if (EXEMPT.some((p) => route.startsWith(p))) continue;
  const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];

  const high = new Set(imgs.filter((t) => /fetchpriority="high"/.test(t)).map((t) => attr(t, 'src')));
  if (high.size > 1) failures.push(`${route}: ${high.size} different images are fetchpriority="high": ${[...high].map((u) => u?.slice(0, 70)).join(' | ')}`);

  for (const tag of imgs) {
    for (const url of urlsIn(tag)) {
      if (RAW_SANITY.test(url)) failures.push(`${route}: unresized Sanity original ${url.slice(0, 110)}`);
      if (RAW_S3.test(url) && !/wsrv\.nl|substackcdn\.com\/image\/fetch/.test(url)) failures.push(`${route}: raw Substack S3 original ${url.slice(0, 110)}`);
    }
  }
}

const unique = [...new Set(failures)];
if (unique.length) {
  console.error(`✗ ${unique.length} image problem(s) in the built site:`);
  /* Grouped by the problem, so one component bug across 40 pages reads as one line. */
  const byKind = new Map();
  for (const f of unique) {
    const key = f.replace(/^[^:]+: /, '');
    byKind.set(key, [...(byKind.get(key) ?? []), f.split(':')[0]]);
  }
  for (const [problem, routes] of byKind) {
    console.error(`  - ${problem}\n      on ${routes.length} page(s): ${routes.slice(0, 5).join(', ')}${routes.length > 5 ? ', …' : ''}`);
  }
  process.exit(1);
}
console.log(`✓ ${pages.length} built pages: one high-priority image each at most, no unresized originals.`);
