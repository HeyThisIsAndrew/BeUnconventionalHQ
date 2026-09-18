/*
  Thumbnail sizing for content cards.

  A card's media box is never larger than ~360 CSS px (4-up desktop grid capped
  at 1536px) and is 42vw on phones, but the sources arrive at full size:
  YouTube hands us `maxresdefault.jpg` at 1280x720, and Substack hands us the
  original upload, commonly 2048x1152. Shipping those into a 164px-wide phone
  card is most of a megabyte of waste per screen.

  This module maps a raw thumbnail URL to a `src` plus a `srcset`, so the
  browser picks by viewport AND pixel density instead of us guessing one
  resolution for every device. Guessing one is what the first pass did, and it
  traded a visibly soft image on desktop retina for the mobile saving.

  Pure string work, no I/O — see scripts/card-images.test.mjs.
*/

export interface CardImageSources {
  /** Fallback for browsers ignoring srcset, and the `src` attribute. */
  src: string;
  /** `srcset` value, or '' when only one rendition is safe to offer. */
  srcset: string;
}

/*
  ─── YOUTUBE ───────────────────────────────────────────────────────────────

  Rendition sizes are fixed by YouTube:

    mqdefault    320x180   16:9
    hqdefault    480x360   4:3, letterboxed
    sddefault    640x480   4:3, letterboxed
    maxresdefault 1280x720 16:9

  The 4:3 ones carry baked-in black bars. That is survivable here — and only
  here — because `.content-card-img` is `object-fit: cover` inside a 16:9 box,
  so cropping 4:3 to 16:9 removes exactly the bars and nothing else. The
  descriptor is still the true width (cropping takes height, not width), so
  the `w` values below are honest.

  maxresdefault is NOT generated for every video — only uploads at 720p or
  better have one, and requesting a missing rendition yields YouTube's grey
  120x90 placeholder. So it is offered ONLY when the incoming URL already
  named it, which is proof it exists. Never synthesise it from a lower one.
*/
const YT_HOST = 'i.ytimg.com';
const YT_RENDITION = /\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg/;

/** Intrinsic width of each rendition, for `w` descriptors. */
const YT_WIDTHS: Record<string, number> = {
  mqdefault: 320,
  hqdefault: 480,
  sddefault: 640,
  maxresdefault: 1280,
};

function youtubeSources(url: string): CardImageSources {
  const match = url.match(YT_RENDITION);
  if (!match) return { src: url, srcset: '' };

  const current = match[1];

  // Only maxresdefault proves a high-res rendition exists. Anything else is
  // left exactly as it came in: downgrading a small one saves nothing and
  // upgrading it risks the placeholder.
  if (current !== 'maxresdefault') return { src: url, srcset: '' };

  const at = (rendition: string) => url.replace(YT_RENDITION, `/${rendition}.jpg`);

  // hqdefault as `src`: it is the smaller file and the one a srcset-ignoring
  // browser should get, and unlike sddefault it exists for every video.
  const src = at('hqdefault');

  return {
    src,
    srcset: [
      `${at('mqdefault')} ${YT_WIDTHS.mqdefault}w`,
      `${src} ${YT_WIDTHS.hqdefault}w`,
      `${at('sddefault')} ${YT_WIDTHS.sddefault}w`,
      `${at('maxresdefault')} ${YT_WIDTHS.maxresdefault}w`,
    ].join(', '),
  };
}

/*
  ─── THE RENDITION THAT ALWAYS EXISTS ──────────────────────────────────────

  srcset has NO fallback semantics. Once the browser has picked a candidate,
  a dead candidate is a dead <img> — it does not retry a neighbour. So when
  the `maxresdefault` offered above turns out not to exist, the whole element
  fails and Layout.astro's fail-safe paints a branded panel over a video that
  has a perfectly good thumbnail one rendition down.

  Two different ways it turns out not to exist, and they need different
  detection (see Layout.astro):

    404          the plain missing case, fires an `error` event
    HTTP 200 +   YouTube answers some missing renditions with its grey 120x90
    placeholder  "no thumbnail" graphic instead, which fires `load`

  `hqdefault` is the recovery target for both: YouTube generates it for every
  video, live or not, and it is what `youtubeSources()` already puts in `src`.

  Exported so the client-side recovery cannot drift from the build-time
  rewrite — they must agree on which rendition is the safe one, and the
  string surgery is identical either way. Pure, so it is testable offline.
*/

/** Renditions that already ARE the safe one, or are below it. */
const YT_SAFE_RENDITIONS = new Set(['hqdefault', 'mqdefault', 'default']);

/**
 * The always-present rendition for a YouTube thumbnail URL, or `''` when
 * there is nothing safer to fall back to — not a YouTube URL, or already at
 * or below `hqdefault`. An empty return means "stop, this one is final".
 */
export function youtubeFallbackSrc(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url || !url.includes(YT_HOST)) return '';

  const match = url.match(YT_RENDITION);
  if (!match) return '';
  if (YT_SAFE_RENDITIONS.has(match[1])) return '';

  return url.replace(YT_RENDITION, '/hqdefault.jpg');
}

/*
  ─── SUBSTACK ──────────────────────────────────────────────────────────────

  Substack proxies through Cloudinary:

    https://substackcdn.com/image/fetch/<transforms>/<url-encoded original>

  where <transforms> is a comma-separated list such as
  `$s_!qfD6!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep`.

  The first pass rewrote this with `.replace(/w_\d+/, 'w_600')`, which assumed
  every URL already carries a width. Measured against src/data/articles.json:
  of 11 proxied URLs only 5 have a `w_`, and NONE have an `h_` — so the width
  rewrite missed 6 of 11 (those cards kept loading the full 2048x1152 upload)
  and the companion `.replace(/h_\d+/, 'h_338')` never once matched.

  Width therefore has to be INSERTED when absent, not just replaced. `c_limit`
  is inserted with it: it bounds the image by the given width and never scales
  up or crops, so an original narrower than the request is passed through
  untouched rather than upsampled. No height is set at all — the card box
  fixes the aspect and `object-fit: cover` does the cropping, so pinning a
  height only risks fighting the source's real ratio.
*/
const SUBSTACK_FETCH = 'substackcdn.com/image/fetch/';

/**
 * Is this a Substack CDN fetch URL, i.e. one substackSources() can rewrite?
 *
 * Exported for the article hero, which needs the substackcdn branch of
 * getCardImageSources() and must NOT be allowed to reach the
 * genericExternalSources() branch below. That branch routes through wsrv.nl,
 * and a cold third-party transcode on the LCP element is the exact thing that
 * was reverted once already — see the header of src/lib/article-images.ts.
 * Calling this first keeps the hero on Substack's own warm CDN or on the raw
 * URL, never on a proxy.
 */
export function isSubstackFetchUrl(raw: unknown): boolean {
  return String(raw ?? '').includes(SUBSTACK_FETCH);
}

/*
  A NOTE ON THE COMMAS, because they look like a bug and are not.

  Every candidate URL below contains commas, and ',' is the srcset candidate
  separator — so this looks unsafe, and the HTML spec's advice to
  percent-encode commas in srcset URLs invites "fixing" it with %2C. Do not.

  The srcset grammar collects a URL as a run of NON-WHITESPACE characters, so
  an embedded comma belongs to the URL and only ", " separates candidates. The
  spec's warning is about URLs that END in a comma; these end in `.jpeg`.
  Verified in Chromium against these exact URLs: with a sentinel `src` proving
  it was selection rather than fallback, the intended candidate was chosen and
  fetched with its commas intact.

  Percent-encoding them would be the actual regression — Cloudinary parses the
  transform segment by literal commas, so `%2C` would arrive as one unreadable
  transform rather than a list.
*/

/** Rendition widths offered to the browser, smallest first. */
/*
  Up to 2000 because the cards grew. A featured tile is 860px on a 4K display,
  which is ~1720 device pixels on a 2x screen, and a ladder stopping at 1200
  means the browser picks 1200 and upscales it 1.4x. Substack originals are
  commonly 2048 wide, so the top of this ladder costs nothing to offer and the
  browser only fetches it on a screen that can actually use it.
*/
const SUBSTACK_WIDTHS = [400, 600, 900, 1200, 1600, 2000];

/** Width used for the plain `src` — covers a phone card at 2x. */
const SUBSTACK_SRC_WIDTH = 600;

function substackSources(url: string): CardImageSources {
  const index = url.indexOf(SUBSTACK_FETCH);
  if (index === -1) return { src: url, srcset: '' };

  const prefix = url.slice(0, index + SUBSTACK_FETCH.length);
  const rest = url.slice(index + SUBSTACK_FETCH.length);

  /*
    The encoded original is everything from the first '/' onward, and it is
    percent-encoded (`https%3A%2F%2F...`), so its own slashes cannot be
    confused for this separator. Splitting on the first '/' keeps the rewrite
    strictly inside the transform list — a naive whole-string regex could
    match digits inside the original's filename, e.g. `..._2048x1152.jpeg`.
  */
  const slash = rest.indexOf('/');
  if (slash === -1) return { src: url, srcset: '' };

  const transforms = rest.slice(0, slash).split(',').filter(Boolean);
  const original = rest.slice(slash);

  const withWidth = (width: number) => {
    const out: string[] = [];
    let sawWidth = false;

    for (const part of transforms) {
      if (/^w_\d+$/.test(part)) {
        out.push(`w_${width}`);
        sawWidth = true;
      } else if (part === 'c_limit') {
        // Re-added below in a known position; drop it here to avoid a dupe.
      } else if (part === 'q_auto:good' || part === 'q_auto') {
        out.push('q_auto:eco');
      } else {
        out.push(part);
      }
    }

    if (!sawWidth) out.push(`w_${width}`);
    out.push('c_limit');

    return `${prefix}${out.join(',')}${original}`;
  };

  return {
    src: withWidth(SUBSTACK_SRC_WIDTH),
    srcset: SUBSTACK_WIDTHS.map((w) => `${withWidth(w)} ${w}w`).join(', '),
  };
}

/** Rendition widths for generic external proxy, smallest first. */
/* Same reasoning as SUBSTACK_WIDTHS above: the cards are large enough now that
   a 1200px ceiling is an upscale on a 2x 4K display. */
const WSRV_WIDTHS = [400, 600, 900, 1200, 1600, 2000];
const WSRV_SRC_WIDTH = 600;

function genericExternalSources(url: string): CardImageSources {
  // Only process absolute external URLs
  if (!/^https?:\/\//i.test(url)) return { src: url, srcset: '' };
  
  // Exclude our own domain if we somehow pass an absolute local URL
  if (url.includes('beunconventionalhq.com')) return { src: url, srcset: '' };

  // Instagram blocks wsrv.nl proxy (returns 403). Route it through our own proxy instead.
  if (url.includes('.cdninstagram.com')) {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    return { src: proxyUrl, srcset: '' };
  }

  // Strip protocol for wsrv.nl
  const urlWithoutProto = url.replace(/^https?:\/\//i, '');
  
  // q=85 for high photographic quality (prepping for Instagram), output=webp for modern format
  const withWidth = (w: number) => 
    `https://wsrv.nl/?url=${encodeURIComponent(urlWithoutProto)}&w=${w}&output=webp&q=85`;

  return {
    src: withWidth(WSRV_SRC_WIDTH),
    srcset: WSRV_WIDTHS.map((w) => `${withWidth(w)} ${w}w`).join(', '),
  };
}

/**
 * Map a raw card thumbnail URL to the sources a card should request.
 * Unrecognised external hosts are routed through a high-quality proxy (wsrv.nl)
 * to generate a responsive srcset, saving massive payload weight on mobile.
 */
export function getCardImageSources(raw: unknown): CardImageSources {
  const url = String(raw ?? '').trim();
  if (!url) return { src: '', srcset: '' };

  if (url.includes(YT_HOST)) return youtubeSources(url);
  if (url.includes(SUBSTACK_FETCH)) return substackSources(url);

  // Fallback for AWS S3 direct links, Substack YouTube thumbnails, Instagram, etc.
  return genericExternalSources(url);
}

/*
  `sizes` for the standard card grid, mirroring home-cards.css:

    <=560px   single column, the card FULL WIDTH of it

              This said 42vw, from when the card turned into a horizontal row
              below 560 and its media took `flex: 0 0 42%`. The cinematic
              refactor replaced that layout — every card is a vertical slate at
              every width now — but the `sizes` kept describing the old one.
              Measured at 375: the media box is 336px, 89% of the viewport,
              against a promised 157px. The browser fetched a 158px rendition
              and upscaled it 2.02x, on a phone, where it is most visible.
    <=1100px  two columns with a 1.25rem gap
    >1100px   four columns, container capped at 1536px, 1.5rem gaps
              -> (1536 - 3*24) / 4 = 366px, so 360px is the steady state

  Exported rather than inlined so the card markup and this module cannot drift
  apart — a `sizes` that disagrees with the CSS makes the browser pick the
  wrong rendition, which is the failure mode srcset exists to avoid.
*/
/*
  ─── THIS ONE STRING SERVES TWO DIFFERENT BOXES ────────────────────────────

  `CARD_IMAGE_SIZES` describes the 4-up card grid AND the feed's browse rows,
  and they are not the same width:

                       1536    1920    2240    2600   (--page-max)
    4-up grid card      366     462     542     632   ((container - 3 gaps) / 4)
    feed row card       320     380     440     500   (--feed-card)

  A `sizes` may safely over-state a box — the browser fetches a slightly larger
  rendition and the image is sharp. Under-stating it is the bug: it picks a
  smaller source and the card is visibly soft. So each step is the LARGER of
  the two consumers, rounded up.

  The widest match wins, so these run LARGEST FIRST. Written the other way round
  a `(min-width: 1536px)` earlier in the list swallows every wider screen and
  the 4K steps never apply — a silent soft-image bug, not an error.
*/
export const CARD_IMAGE_SIZES =
  '(max-width: 560px) 90vw, (max-width: 1100px) 47vw, ' +
  '(min-width: 3400px) 635px, (min-width: 2560px) 545px, (min-width: 1920px) 465px, ' +
  '(min-width: 1536px) 370px, 23vw';

/*
  ─── THE HERO CARD IS NOT IN THE CARD GRID ─────────────────────────────────

  `variant="hero"` renders ONE card in the left half of FeaturedHighlights, not
  as a tile in a four-up grid, and it was being described by the grid's `sizes`
  above. The numbers are nearly a factor of two apart, so the browser was
  honouring `(min-width: 1536px) 360px` and fetching a 360px rendition for a
  box measured at 768px: a 2.1x upscale, and the reason the Featured section
  looked soft. On a 2x display it is a 4x upscale.

  It is the exact failure the note above warns about — a `sizes` that disagrees
  with the CSS makes the browser pick the wrong rendition — reached by reusing
  the right string in the wrong place rather than by writing a wrong one.

  Measured against .fh-left, which is half of `.container-page` (max-width
  1536, 2rem gutters) and stacks to full width below 768px:

    <768px    stacked, one column        -> 90vw

              `calc(100vw - 4rem)` was the arithmetic for a 2rem gutter each
              side, which is right at the root's desktop size and wrong on a
              phone, where the root is 16px and the gutter is smaller. Measured
              at 375: the box is 333px against a promised 311px, a 1.07x
              upscale. 90vw covers it at every phone width without needing to
              know what the gutter resolves to.
    >=1536px  container capped at 1536   -> (1536 - 64) / 2 = 736px
    >=1920px  the container steps up too  -> measured 838px at 1920 and 823px
              at 3840 (the section carries its own cap, so it stops growing).
              850 covers both without over-fetching.
    else      half the viewport          -> 50vw, less its share of the gutters
*/
export const HERO_CARD_IMAGE_SIZES =
  '(max-width: 767px) 90vw, (min-width: 1920px) 850px, (min-width: 1536px) 736px, calc(50vw - 3rem)';

/*
  ─── AND THE FEATURED SHELF IS NOT IN THE CARD GRID EITHER ─────────────────

  The tentpole row's cards are `min(90vw, 560px)` — 75% wider than the 320px
  browse cards, so that the shelf reads as the thing to look at. The `sizes`
  did not follow: `CARD_IMAGE_SIZES` promises the browser `360px` above 1536,
  so it fetched a 360px rendition for a 560px box. A 1.56x upscale, 3.1x on a
  2x display, and the cards looked soft at exactly the size meant to show them
  off.

  This is the SECOND time the same mistake has been made — see the hero note
  above, where a 360px rendition went into a 768px box. Both times the cause was
  reusing a correct string somewhere it does not describe. A `sizes` is a claim
  about the CSS; change one and the other is already wrong.

  Mirrors `.feed-row--prestige .feed-row-item` in FeedGrid.astro exactly. The
  breakpoint is 622px because that is where 90vw stops being the smaller of the
  two (560 / 0.9).
*/
export const FEATURED_CARD_IMAGE_SIZES =
  '(max-width: 622px) 90vw, ' +
  '(min-width: 3400px) 860px, (min-width: 2560px) 760px, (min-width: 1920px) 660px, 560px';
