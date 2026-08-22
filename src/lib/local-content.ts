/**
 * Local-JSON readers for the `event` and `featuredBrand` doc types that used
 * to be queried straight from Sanity. Mirrors the pattern in videos-source.ts:
 * one place pages get this data, backed by src/data/videos.json.
 *
 * Sanity is still used for image hosting - most existing docs carry real
 * Sanity asset references (logo/heroImage), so urlFor() below builds real
 * cdn.sanity.io URLs for those. That's a browser-side image fetch, not a
 * build-time API call, so it doesn't reintroduce the egress dependency this
 * pivot removes. Docs created in the Local CMS (no Sanity asset pipeline
 * available to it) instead store a plain image URL string - urlFor() below
 * accepts that too, as a pass-through.
 */
import { createImageUrlBuilder } from '@sanity/image-url';
import localVideos from '../data/videos.json';

const SANITY_PROJECT = { projectId: '38nhxsib', dataset: 'production' };
const builder = createImageUrlBuilder(SANITY_PROJECT);

/**
 * Sanity asset ids are self-describing: `image-<hash>-<W>x<H>-<ext>`. The
 * Local CMS's upload endpoint (astro.config.mjs) now uploads straight to
 * Sanity and stores this bare id string as the field value (not a resolved
 * URL, not a full asset-reference object) - keeps videos.json diffable and
 * ImageUploadField's value contract a plain string. Detecting the shape here
 * is what lets a bare ref resolve through urlFor() *and* keep CLS dimensions,
 * identical to how a real frozen-export Sanity asset reference object does.
 */
const SANITY_IMAGE_REF_RE = /^image-[a-f0-9]+-\d+x\d+-\w+$/i;

export function isSanityImageRef(value: unknown): value is string {
  return typeof value === 'string' && SANITY_IMAGE_REF_RE.test(value);
}

/**
 * Chainable no-op matching ImageUrlBuilder's fluent API, for plain URLs.
 *
 * A Proxy rather than a hand-listed set of methods: every transform the real
 * builder grows (`quality`, `fit`, `dpr`, …) has to be a silent no-op here or
 * the first caller to use one throws on an externally-hosted image. Listing
 * them by hand meant that failure was one new call site away — this cannot
 * drift. Only `url()` is real.
 */
function plainUrlBuilder(url: string) {
  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'url' || prop === 'toString') return () => url;
        return () => chain;
      },
    },
  );
  return chain;
}

export function urlFor(source: any) {
  if (isSanityImageRef(source)) return builder.image({ asset: { _ref: source } });
  if (typeof source === 'string') return plainUrlBuilder(source);
  return builder.image(source);
}

/**
 * Sanity image asset _refs are self-describing: `image-<hash>-<W>x<H>-<ext>`.
 * That lets us reserve the image box (CLS) without dereferencing
 * asset->metadata.dimensions the way the old GROQ projections did. Plain
 * URL strings (arbitrary external URLs) have no embedded dimensions - callers
 * fall back to an unconstrained box, same as any doc with no logo at all.
 */
function imageDimensions(source: any): { width: number; height: number; aspectRatio: number } | null {
  const ref = isSanityImageRef(source) ? source : source?.asset?._ref;
  if (typeof ref !== 'string') return null;
  const match = /-(\d+)x(\d+)-/.exec(ref);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return { width, height, aspectRatio: width / height };
}

/** Public read of the dimensions encoded in a Sanity asset id. */
export function getImageDimensions(source: any) {
  return source?.dimensions ?? imageDimensions(source);
}

export interface ImageSet {
  /** Largest candidate — the `src` fallback for browsers ignoring srcset. */
  src: string;
  /** `srcset` with width descriptors, or '' for images with no known size. */
  srcset: string;
  /** Intrinsic box for the `src`, so the slot can be reserved (CLS). */
  width: number;
  height: number;
}

/**
 * Build a responsive image set from a Sanity asset, NEVER asking the CDN for
 * more pixels than the asset actually has.
 *
 * ─── WHY THE CAP IS THE POINT ─────────────────────────────────────────────
 * Sanity happily serves `?w=1600` for a 768px-wide original: it upsamples and
 * returns a genuinely 1600px-wide, genuinely blurry file. That is strictly
 * worse than asking for 768 — more bytes, less detail, and the softness reads
 * as "the site is low quality" rather than "this source image is small". The
 * events hero shipped exactly that (a 768x432 asset requested at 1600x900).
 * Capping at the native width cannot make an image sharper, but it stops us
 * paying to make it worse, and it makes the real ceiling visible in the
 * markup instead of hiding it behind an interpolated upscale.
 *
 * @param source   Sanity image field (object or bare `image-…` id string).
 * @param widths   Candidate CSS widths, ascending. Values above the asset's
 *                 native width are dropped and replaced by the native width.
 * @param aspect   Optional forced aspect ratio (w / h) for a cropped box.
 *                 Omit to keep the asset's own proportions.
 */
export function buildImageSet(
  source: any,
  { widths, aspect, quality = 80 }: { widths: number[]; aspect?: number; quality?: number },
): ImageSet | null {
  if (!source) return null;

  const native = getImageDimensions(source);
  const ratio = aspect ?? native?.aspectRatio ?? 16 / 9;

  // No embedded dimensions (an arbitrary external URL) — hand back the plain
  // URL untouched rather than inventing a srcset the host cannot serve.
  if (!native) {
    const src = urlFor(source).url();
    return src ? { src, srcset: '', width: 0, height: 0 } : null;
  }

  const capped = Math.min(Math.max(...widths), native.width);
  const candidates = [...new Set(widths.filter((w) => w < capped).concat(capped))].sort(
    (a, b) => a - b,
  );

  const at = (w: number) =>
    urlFor(source)
      .width(w)
      .height(Math.round(w / ratio))
      .auto('format')
      .quality(quality)
      .url();

  const largest = candidates[candidates.length - 1];
  return {
    src: at(largest),
    srcset: candidates.map((w) => `${at(w)} ${w}w`).join(', '),
    width: largest,
    height: Math.round(largest / ratio),
  };
}

function withDimensions(source: any): any {
  if (!source) return source;
  // Bare Sanity ref string from the Local CMS upload endpoint - promote to
  // the same {asset:{_ref}} shape a real frozen-export doc already has, so
  // urlFor() and .dimensions.aspectRatio work identically either way.
  if (isSanityImageRef(source)) return { asset: { _ref: source }, dimensions: imageDimensions(source) };
  // Arbitrary external URL string (hand-pasted, not uploaded) carries no
  // embedded dimensions - pass through unchanged rather than spreading
  // string characters as keys.
  if (typeof source === 'string') return source;
  return { ...source, dimensions: imageDimensions(source) };
}

function withImageDimensions<T extends { logo?: any; heroImage?: any }>(doc: T): T {
  return {
    ...doc,
    logo: withDimensions(doc.logo),
    heroImage: withDimensions(doc.heroImage),
  };
}

/** Equivalent to `*[_type == "event"] | order(startDate desc)`. */
export function getEventsLocal(): any[] {
  return (localVideos as any[])
    .filter((d) => d._type === 'event')
    .map(withImageDimensions)
    .sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
}

/**
 * Equivalent to
 * `*[_type == "featuredBrand" && defined(slug.current)] | order(title asc)`.
 */
export function getFeaturedBrandsLocal(): any[] {
  return (localVideos as any[])
    .filter((d) => d._type === 'featuredBrand' && d.slug?.current)
    .map(withImageDimensions)
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
}

/*
  ONE IMAGE, THE HUB'S OWN.

  This used to gather up to six stills and cross-fade them, pulling from the
  thumbnails of videos tagged to the hub and then from its category. It was a
  neat trick and it was the wrong call: those thumbnails are the channel's own
  video covers, which means they are frequently a photograph of the presenter.
  A hub is somebody else's brand — Marvel's backdrop cannot be a picture of the
  site owner, and "the top of my head behind the Marvel logo" is how it was
  actually spotted.

  So a hub's backdrop is a hub's own art and nothing else: whatever image has
  been chosen for it, blurred, with a slow drift. Borrowing footage from a
  neighbouring category was solving a content gap with someone else's face, and
  a hub with no art yet is better served by the brand-tinted ground it already
  falls back to.

  It is also far less machinery — no cycling timer, no staged hydration, no
  tiers, and one image per hub instead of six.
*/
export type HubBackdrop = { kind: 'sanity'; ref: any };

/**
 * The single image behind a hub, or null if it has none yet.
 *
 *   1. `backdrops[0]` — an explicit override, for when the key art does not
 *      work blurred (a logo on flat white goes to nothing).
 *   2. `heroImage` — the hub's own key art, which is the normal case.
 *
 * Nothing else. A hub with neither falls through to the brand-tinted gradient
 * the page already draws, which reads as a deliberate title card rather than a
 * gap.
 */
export function getHubBackdrop(slug: string): HubBackdrop | null {
  const brand = (localVideos as any[]).find(
    (d) => d._type === 'featuredBrand' && d.slug?.current === slug,
  );
  if (!brand) return null;

  const override = (brand.backdrops ?? []).find(Boolean);
  if (override) return { kind: 'sanity', ref: override };
  if (brand.heroImage) return { kind: 'sanity', ref: brand.heroImage };
  return null;
}

/**
 * The four rows on /featured, and what each is called.
 *
 * Shared rather than declared twice, because a hub page now shows the row it
 * was reached from — and a label that disagrees with the row you just clicked
 * is worse than no label. Adding a hub is a data change; adding a CATEGORY is
 * a design decision, which is why this stays in code.
 */
export const HUB_CATEGORY_LABELS: Record<string, string> = {
  universes: 'The Multiverse',
  streaming: 'Streamers',
  studios: 'Studios',
  gaming: 'Gaming',
};
