/**
 * Cover-image de-duplication for imported Substack articles.
 *
 * ─── THE BUG THIS EXISTS FOR ──────────────────────────────────────────────
 * A post's cover image is delivered twice by the posts API: once as
 * `cover_image` (which becomes `article.image`, rendered as the page hero) and
 * again as the first `<figure>` inside `body_html`, because the author placed
 * it at the top of the post. Rendering both shows the same photo twice.
 *
 * ─── WHY IT ONLY AFFECTED *SOME* POSTS ────────────────────────────────────
 * It depends on what the cover actually is:
 *
 *   • "Mortal Kombat 2 Review" — cover is an uploaded photo, and the body
 *     opens with that same photo in a <figure>. Both survive sanitization,
 *     so the reader sees it twice.
 *   • "The Boys Season 5 Episode 5" — cover is a YouTube thumbnail
 *     (`/image/youtube/w_728,c_limit/<videoId>`) and the body opens with a
 *     YouTube <iframe> embed, which is NOT on the sanitizer's allowlist and
 *     is dropped entirely. There is no second <img> left to collide with.
 *
 * That asymmetry is why the duplicate looked arbitrary rather than systematic.
 *
 * ─── WHY MATCHING NEEDS A FINGERPRINT ─────────────────────────────────────
 * The two URLs are never byte-identical. Substack rewrites the same asset
 * through its image CDN with different transform parameters, and nests the
 * real upstream URL percent-encoded inside the path:
 *
 *   cover: …/image/fetch/$s_!qfD6!,f_auto,…/https%3A%2F%2F…%2Fa5e6…_2048x1152.jpeg
 *   body:  …/image/fetch/$s_!qfD6!,w_1456,c_limit,f_auto,…/https%3A%2F%2F…%2Fa5e6…_2048x1152.jpeg
 *                                  ^^^^^^^^^^^^^^ only the transform differs
 *
 * So identity is the upstream asset, not the URL. Pure functions, no I/O, so
 * this is testable offline — see scripts/articles.test.mjs.
 */

/**
 * Reduce an image URL to a stable identity for the asset behind it.
 *
 * Two URLs that render the same underlying image return the same string,
 * regardless of the CDN transform applied to either.
 */
export function imageFingerprint(url: string): string {
  if (!url) return '';

  let decoded = String(url);
  try {
    /* Substack nests the upstream URL percent-encoded inside the transform
       path, so decoding is what makes both variants comparable. */
    decoded = decodeURIComponent(decoded);
  } catch {
    /* Malformed escapes — keep the raw string rather than throwing. */
  }

  /* A YouTube thumbnail's identity is the video id, not the frame size. */
  const youtube = decoded.match(/\/image\/youtube\/[^/]*\/([\w-]{6,})/i);
  if (youtube) return `youtube:${youtube[1]}`;

  /* An uploaded asset's identity is its filename in substack-post-media. */
  const upload = decoded.match(/\/public\/images\/([^/?#]+)/i);
  if (upload) return `image:${upload[1]}`;

  /* Anything else: the last path segment with query/fragment removed. */
  const tail = decoded.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  return tail ? `url:${tail}` : '';
}

/**
 * Remove the article's cover image from its body, if the body repeats it.
 *
 * Removes the FIRST matching occurrence only. A whole `<figure>` is preferred
 * over a bare `<img>` so stripping the photo never strands its `<figcaption>`
 * as a caption with nothing above it.
 *
 * Regex over parsed HTML is safe here for the same reason buildPreview() gives:
 * the body has already been through sanitize-html, so the markup is
 * well-formed and the tag set is a known allowlist — this is not parsing
 * arbitrary HTML from the wild.
 *
 * @param bodyHtml sanitized article body
 * @param coverUrl the article's cover image URL (`article.image`)
 */
export function stripCoverImageFromBody(bodyHtml: string, coverUrl: string): string {
  const body = String(bodyHtml ?? '');
  const target = imageFingerprint(coverUrl);
  if (!body || !target) return body;

  const figures = body.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) ?? [];
  for (const figure of figures) {
    const src = figure.match(/<img\b[^>]+src=["']([^"']+)["']/i)?.[1];
    if (src && imageFingerprint(src) === target) {
      return body.replace(figure, '');
    }
  }

  /* No <figure> wrapper — drop the bare <img>, plus a link wrapping only it. */
  const linked = body.match(/<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>/gi) ?? [];
  for (const anchor of linked) {
    const src = anchor.match(/<img\b[^>]+src=["']([^"']+)["']/i)?.[1];
    if (src && imageFingerprint(src) === target) {
      return body.replace(anchor, '');
    }
  }

  const images = body.match(/<img\b[^>]*>/gi) ?? [];
  for (const image of images) {
    const src = image.match(/src=["']([^"']+)["']/i)?.[1];
    if (src && imageFingerprint(src) === target) {
      return body.replace(image, '');
    }
  }

  return body;
}

/*
  ─── ARTICLE BODY IMAGES ARE ORIGINALS UNTIL YOU REWRITE THEM ───────────────

  Substack's `body_html` embeds whatever the author uploaded, at full size. One
  review on /intel carries nine of them, several at 3840x2160, inside a column
  that is ~720px wide. That is megabytes of image for a page that can use a
  fraction of it, and none of it is touched by the components — it arrives as
  a string and goes straight into `set:html`.

  This rewrites only the `src` of each `<img>`, to the same rendition helper
  every component already uses, and adds `srcset`/`sizes` so a phone takes a
  small one. It also marks them `loading="lazy"` and `decoding="async"`: body
  images are below the fold by definition, since the hero and the first
  paragraphs come first.

  DELIBERATELY CONSERVATIVE, because this is other people's markup:

    • only `<img>` tags, only their `src`, only absolute http(s) urls — a
      data: uri or a relative path is left exactly as it was;
    • existing `srcset`, `loading` or `decoding` attributes are never
      overwritten, so anything Substack already got right stays;
    • the tag's other attributes, its order, and everything around it are
      untouched — no reparsing, no reserialising, no DOM;
    • if the helper returns nothing usable the original tag is kept verbatim.

  The image COUNT and their order are unchanged by construction, which is what
  the test asserts — a transform on someone else's HTML earns its keep only if
  it cannot silently drop content.
*/
export function optimiseBodyImages(
  bodyHtml: string,
  getSources: (url: string) => { src: string; srcset: string },
  sizes = '(max-width: 900px) 92vw, 720px'
): string {
  const body = String(bodyHtml ?? '');
  if (!body) return body;

  return body.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src || !/^https?:\/\//i.test(src)) return tag;

    let sources;
    try {
      sources = getSources(src);
    } catch {
      return tag;
    }
    if (!sources?.src) return tag;

    let out = tag.replace(/(\ssrc=["'])[^"']+(["'])/i, `$1${sources.src}$2`);

    /* Never clobber what the source markup already specifies. */
    if (sources.srcset && !/\ssrcset=/i.test(out)) {
      out = out.replace(/<img\b/i, `<img srcset="${sources.srcset}" sizes="${sizes}"`);
    }
    if (!/\sloading=/i.test(out)) out = out.replace(/<img\b/i, '<img loading="lazy"');
    if (!/\sdecoding=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"');

    return out;
  });
}
