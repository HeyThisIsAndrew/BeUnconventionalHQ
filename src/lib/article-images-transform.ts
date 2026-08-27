/*
  ─── THE ARTICLE-IMAGE REWRITE RULE, WITH NO IMPORTS ────────────────────────

  Separated from ./article-images.ts for the same reason ./instagram-visibility.ts
  is separated from ./instagram.ts: that module statically imports a JSON data
  file, which makes it unloadable under plain `node` (JSON modules need an
  import attribute), and the offline suites run under plain node. A rule kept
  there could only ever be asserted by matching source text — which is how a
  guard starts passing while proving nothing.

  This file imports nothing, so the rule is tested against real inputs.
*/

export interface ArticleImageRendition {
  /** Local path for the `src` attribute. */
  src: string;
  /** Local `srcset`, widest last. Empty when only one width was built. */
  srcset: string;
}

/** `{ [sourceUrl]: { src, srcset } }`, as written by sync-article-images.mjs. */
export type ArticleImageManifest = Record<string, { src?: unknown; srcset?: unknown }>;

/*
  Already a sized rendition on someone else's warm CDN.

  substackcdn URLs carry their own transforms (`w_1456,c_limit,f_auto,
  q_auto:good`). Measured across the store: of 23 unique image URLs, these 13
  are already fine and the 10 raw S3 uploads are the entire 22.54 MB. Building
  local copies of them would add repository weight to fix nothing.

  scripts/sync-article-images.mjs carries the same pattern — it decides what to
  DOWNLOAD, this decides what to LOOK UP, and they must agree or a URL gets
  fetched and then never used.
*/
export const ALREADY_OPTIMISED = /substackcdn\.com\//i;

/**
 * The committed rendition for a source URL, or `null` to keep the original.
 *
 * `null` is the safe answer and is returned for everything uncertain: no URL,
 * an already-optimised CDN URL, no manifest entry, or an entry with no usable
 * `src`. Every caller falls back to the URL it already had, so an image the
 * sync could not reach and an article published between syncs both render
 * exactly as they do today.
 */
export function lookupRendition(
  manifest: ArticleImageManifest,
  rawUrl: unknown
): ArticleImageRendition | null {
  const url = String(rawUrl ?? '').trim();
  if (!url || ALREADY_OPTIMISED.test(url)) return null;

  const entry = manifest?.[url];
  if (!entry) return null;

  const src = String(entry.src ?? '').trim();
  /* An entry with no usable src is corrupt. Falling back beats emitting an
     empty src, which resolves to the current page URL. */
  if (!src) return null;

  return { src, srcset: String(entry.srcset ?? '') };
}

/**
 * Rewrite `<img>` tags in article body HTML to committed renditions.
 *
 * DELIBERATELY CONSERVATIVE, because this is Substack's markup and the risk is
 * not failing to optimise — it is silently dropping or mangling content:
 *
 *   • only `<img>` tags, only their `src`, and only when a rendition actually
 *     exists — everything else is returned byte-identical;
 *   • an existing `srcset`, `loading` or `decoding` is never overwritten;
 *   • no reparsing and no DOM, so other attributes, their order, and the
 *     surrounding markup are untouched;
 *   • image COUNT and ORDER cannot change, by construction;
 *   • a throwing lookup returns the tag verbatim.
 */
export function rewriteBodyImages(
  bodyHtml: string,
  lookup: (url: string) => ArticleImageRendition | null,
  sizes = '(max-width: 900px) 92vw, 720px'
): string {
  const body = String(bodyHtml ?? '');
  if (!body) return body;

  return body.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src) return tag;

    let local: ArticleImageRendition | null;
    try {
      local = lookup(src);
    } catch {
      return tag;
    }
    if (!local?.src) return tag;

    let out = tag.replace(/(\ssrc=["'])[^"']+(["'])/i, `$1${local.src}$2`);

    if (local.srcset && !/\ssrcset=/i.test(out)) {
      out = out.replace(/<img\b/i, `<img srcset="${local.srcset}" sizes="${sizes}"`);
    }
    if (!/\sloading=/i.test(out)) out = out.replace(/<img\b/i, '<img loading="lazy"');
    if (!/\sdecoding=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"');

    return out;
  });
}

/*
  ─── INTRINSIC DIMENSIONS, PARSED FROM THE FILENAME ─────────────────────────

  Substack uploads keep their pixel dimensions in the filename:

    .../public/images/66b03785-c2cf-4153-96c6-81ed4c41fd05_1086x1609.png

  which is the same trick src/lib/local-content.ts uses to size Sanity assets
  from an `image-<hash>-<W>x<H>-<ext>` ref rather than dereferencing metadata.

  THE BUG THIS EXISTS FOR.

  The article hero hardcoded `width="1456" height="816"`. With
  `.article-hero { width: 100%; height: auto }` the browser reserves space from
  those attributes and then reflows to the image's REAL ratio once it loads.
  Every cover was 16:9 (2560x1440, 3840x2160, 2048x1152), so 1456/816 = 1.784
  was close enough that the reflow was invisible, and the hardcoding survived.

  Then an article shipped a 1086x1609 PORTRAIT cover. In a 720px column the
  reserved box is 720/1.784 = 404px and the real box is 720/0.675 = 1067px, so
  the entire article body jumped down by ~660px after the hero loaded. That is
  a single enormous layout shift on the LCP element.

  Returning the real ratio removes it for every aspect ratio, present and
  future, without anyone having to remember to update a constant.
*/

/** Pixel dimensions of an image, as declared by its filename. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/*
  Bounded digits and a real image extension, so this cannot match a transform
  segment or an id that happens to contain digits and an `x`. Global, because
  the meaningful match is the LAST one: a substackcdn fetch URL carries the
  encoded original AFTER the transforms, so the filename is always at the end.
*/
const DIMENSIONS_IN_FILENAME = /_(\d{2,5})x(\d{2,5})\.(?:png|jpe?g|webp|gif|avif)\b/gi;

/**
 * Intrinsic dimensions from an image URL's filename, or `null` when unknown.
 *
 * `null` is the safe answer and every caller keeps whatever it was doing —
 * there is no guess here, because a wrong aspect ratio causes exactly the
 * layout shift this is meant to remove.
 */
export function parseImageDimensions(rawUrl: unknown): ImageDimensions | null {
  const url = String(rawUrl ?? '').trim();
  if (!url) return null;

  DIMENSIONS_IN_FILENAME.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  for (let match = DIMENSIONS_IN_FILENAME.exec(url); match; match = DIMENSIONS_IN_FILENAME.exec(url)) {
    last = match;
  }
  if (!last) return null;

  const width = Number(last[1]);
  const height = Number(last[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;

  return { width, height };
}

/*
  ─── LINKS THAT WRAP AN IMAGE NEED A NAME ───────────────────────────────────

  Substack wraps body images in a click-to-enlarge anchor:

    <a target="_blank" href="<full size>" rel="noopener noreferrer">
      <img src="…" alt="" />
    </a>

  and it supplies no alt text, because from its point of view the image is
  already the content. An anchor whose only content is an image with an empty
  alt has NO accessible name at all: a screen reader announces "link" and
  nothing else, 29 times across the current store.

  Lighthouse caught it as `link-name` on /intel/<slug> — 97% accessibility
  where every other audited page scores 100. WCAG 2.4.4 and 4.1.2.

  Two ways to fix it and they are not equivalent. Unwrapping the anchor would
  also work, but it removes a reader-facing affordance (tap the image, get the
  full-size original) to satisfy an audit, which is the wrong trade. Naming the
  link keeps the behaviour and fixes the defect.

  DELIBERATELY CONSERVATIVE, like everything else in this file:

    • only anchors whose content is images and whitespace — any text inside
      already names the link, so it is left alone;
    • an `alt` with real text already names the link, so that is left alone
      too. This only fills the gap where there is genuinely no name;
    • an existing aria-label, aria-labelledby or title is never overwritten;
    • the "new tab" wording is used only when the anchor really does open one;
    • anything unmatched is returned byte-identical.

  Applied at RENDER time rather than at sync time on purpose: it fixes every
  article already in the store on the next build, instead of waiting for each
  one to be re-synced.
*/

/** Anchors, non-greedy. Anchors cannot legally nest, so this cannot mis-scope. */
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

/** An `alt` that actually says something. `alt=""` deliberately does not match. */
const ALT_WITH_TEXT = /\balt\s*=\s*(["'])(?!\1)[^"']*\1/i;

/** An attribute that already supplies an accessible name. */
const ALREADY_NAMED = /\s(?:aria-label|aria-labelledby)\s*=/i;

/**
 * Give an accessible name to links whose only content is an unlabelled image.
 *
 * Returns the HTML unchanged when there is nothing to name, which is the
 * common case for an article with no images.
 */
export function labelImageLinks(html: unknown): string {
  const source = String(html ?? '');
  if (!source) return '';

  return source.replace(ANCHOR, (match: string, attrs: string, inner: string) => {
    if (ALREADY_NAMED.test(attrs)) return match;
    if (ALT_WITH_TEXT.test(attrs)) return match; // a title/alt on the anchor itself
    if (!/<img\b/i.test(inner)) return match;

    /* Visible text inside the link is its name. Strip tags and see what is
       left; anything at all means we must not touch it. */
    if (inner.replace(/<[^>]*>/g, '').trim()) return match;

    /* An image carrying real alt text names the link through its own content.
       Only a missing or empty alt leaves the link silent. */
    if (ALT_WITH_TEXT.test(inner)) return match;

    const opensNewTab = /\starget\s*=\s*(["'])_blank\1/i.test(attrs);
    const label = opensNewTab ? 'Open image in a new tab' : 'Open image';

    return `<a${attrs} aria-label="${label}">${inner}</a>`;
  });
}
