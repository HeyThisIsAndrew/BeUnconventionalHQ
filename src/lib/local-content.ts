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
  A backdrop is BLURRED, ALWAYS. That is a design decision and a budget
  decision at the same time, and the second one is why it is worth stating
  plainly: nothing behind the artwork is ever the thing being looked at, so
  detail there is weight with no payoff. Everything gets the small source —
  YouTube's 320x180 `mqdefault` at roughly 10kB rather than the 1280x720
  `maxresdefault` at roughly 150kB — and the blur hides the upscale. Six stills
  cost about 60kB in total instead of nearly a megabyte.

  How hard it is blurred depends on how honestly it belongs to the hub, which
  is what `tier` carries:

    chosen   someone picked this image for this hub. Lightest touch.
    hub      a video tagged to this hub. Its own coverage.
    related  matches the hub's own sync keywords, but is not tagged to it.
    mood     right CATEGORY, not this hub — a gaming still behind PlayStation.
             Blurred past legibility on purpose. It is set dressing, and it
             must never read as a claim that this is the hub's coverage.
*/
export type BackdropTier = 'chosen' | 'hub' | 'related' | 'mood';

export type HubBackdrop = { tier: BackdropTier } & (
  | { kind: 'sanity'; ref: any }
  | { kind: 'url'; url: string }
);

/*
  Which topics stand in for a category when a hub has nothing of its own. Every
  one of these has real thumbnails in the store, which is the only reason this
  is worth doing rather than falling back to flat black.
*/
const CATEGORY_TOPIC_FALLBACK: Record<string, string[]> = {
  universes: ['film', 'tv'],
  streaming: ['tv', 'film'],
  studios: ['film'],
  gaming: ['gaming'],
};

/** YouTube's small 16:9 still. `hqdefault` and `sddefault` are 4:3 and arrive
 *  pillarboxed with baked-in black bars, so they are never used here. */
function smallThumb(url: string): string {
  return url.replace(/\/(maxresdefault|hq720|sddefault|hqdefault)(_live)?\.jpg/, '/mqdefault.jpg');
}

function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The still images a hub uses as its backdrop, best source first.
 *
 * The /featured deck used to put a live YouTube embed behind the artwork on
 * every screen. Two problems, and neither is fixable by configuring the embed:
 * YouTube's chrome is not reliably suppressible — `modestbranding` no longer
 * removes the logo and `rel=0` no longer removes related videos — and the
 * player is roughly 900kB of JavaScript, which is most of why the page felt
 * slow on a phone.
 *
 * So the backdrop is stills, and the video is an enhancement layered over them
 * where there is the bandwidth for it.
 *
 * Sources, in order — each one only runs if the ones above it came up short,
 * so a hub with real coverage never shows borrowed footage:
 *
 *   1. `backdrops` on the hub. Someone picked these; they win outright.
 *   2. Thumbnails of videos TAGGED to this hub, newest first. Free, already in
 *      the store, and current on their own as the sync tags new videos.
 *   3. Videos matching the hub's own `youtubeSyncKeywords` — the same heuristic
 *      the hub page already falls back to for its coverage grid.
 *   4. Videos in the hub's CATEGORY. Thirteen of the fifteen hubs have no
 *      coverage and no artwork at all, and a gaming still behind PlayStation is
 *      a better ground than an empty box — as long as it is blurred past the
 *      point of looking like a claim. See BackdropTier.
 *   5. The hub's `heroImage`, so one image still beats flat black.
 */
export function getHubBackdrops(slug: string, limit = 6): HubBackdrop[] {
  const out: HubBackdrop[] = [];
  const seen = new Set<string>();

  const brand = (localVideos as any[]).find(
    (d) => d._type === 'featuredBrand' && d.slug?.current === slug,
  );
  if (!brand) return out;

  const pushSanity = (ref: any, tier: BackdropTier) => {
    if (!ref) return;
    const key = JSON.stringify(ref?.asset?._ref ?? ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind: 'sanity', ref, tier });
  };

  const pushDoc = (doc: any, tier: BackdropTier) => {
    const url = smallThumb(String(doc.thumbnailUrl));
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ kind: 'url', url, tier });
  };

  for (const ref of (brand.backdrops ?? []) as any[]) pushSanity(ref, 'chosen');
  if (out.length >= limit) return out.slice(0, limit);

  /* Newest first. A backdrop that leads with two-year-old coverage reads as a
     dormant hub even when the hub is active. */
  const pool = (localVideos as any[])
    .filter(
      (d) =>
        (d._type === 'video' || d._type === 'short' || d._type === 'live') &&
        d.thumbnailUrl,
    )
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));

  for (const doc of pool) {
    if (out.length >= limit) return out.slice(0, limit);
    if (Array.isArray(doc.hubs) && doc.hubs.includes(slug)) pushDoc(doc, 'hub');
  }

  const keywords = ((brand.youtubeSyncKeywords ?? []) as any[])
    .filter((k): k is string => typeof k === 'string')
    .map(normalizeTag)
    .filter(Boolean);

  if (keywords.length > 0) {
    for (const doc of pool) {
      if (out.length >= limit) return out.slice(0, limit);
      const tags = [...(doc.youtubeTags ?? []), ...(doc.topics ?? [])]
        .filter((t: unknown): t is string => typeof t === 'string')
        .map(normalizeTag);
      // Exact match on normalised strings, never substring: "max" must not
      // pull in every video whose tags mention "max verstappen".
      if (tags.some((t) => keywords.includes(t))) pushDoc(doc, 'related');
    }
  }

  const topics = CATEGORY_TOPIC_FALLBACK[brand.hubCategory ?? ''] ?? [];
  if (topics.length > 0) {
    for (const doc of pool) {
      if (out.length >= limit) return out.slice(0, limit);
      const docTopics: string[] = (doc.topics ?? []).filter(
        (t: unknown): t is string => typeof t === 'string',
      );
      if (docTopics.some((t: string) => topics.includes(t))) pushDoc(doc, 'mood');
    }
  }

  if (out.length === 0) pushSanity(brand.heroImage, 'chosen');

  return out.slice(0, limit);
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
