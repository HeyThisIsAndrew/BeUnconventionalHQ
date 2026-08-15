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
