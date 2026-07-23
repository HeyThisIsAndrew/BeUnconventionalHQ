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

/** Chainable no-op matching ImageUrlBuilder's fluent API, for plain URLs. */
function plainUrlBuilder(url: string) {
  const chain: any = {
    width: () => chain,
    height: () => chain,
    auto: () => chain,
    url: () => url,
  };
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
