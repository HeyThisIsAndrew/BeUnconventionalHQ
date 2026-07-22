/**
 * Local-JSON readers for the `event` and `featuredBrand` doc types that used
 * to be queried straight from Sanity. Mirrors the pattern in videos-source.ts:
 * one place pages get this data, backed by src/data/videos.json.
 *
 * Sanity is still used for image hosting - these docs carry real Sanity
 * asset references (logo/heroImage), so urlFor() below builds real
 * cdn.sanity.io URLs. That's a browser-side image fetch, not a build-time
 * API call, so it doesn't reintroduce the egress dependency this pivot
 * removes.
 */
import { createImageUrlBuilder } from '@sanity/image-url';
import localVideos from '../data/videos.json';

const SANITY_PROJECT = { projectId: '38nhxsib', dataset: 'production' };
const builder = createImageUrlBuilder(SANITY_PROJECT);

export function urlFor(source: any) {
  return builder.image(source);
}

/**
 * Sanity image asset _refs are self-describing: `image-<hash>-<W>x<H>-<ext>`.
 * That lets us reserve the image box (CLS) without dereferencing
 * asset->metadata.dimensions the way the old GROQ projections did.
 */
function imageDimensions(source: any): { width: number; height: number; aspectRatio: number } | null {
  const ref = source?.asset?._ref;
  if (typeof ref !== 'string') return null;
  const match = /-(\d+)x(\d+)-/.exec(ref);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return { width, height, aspectRatio: width / height };
}

function withImageDimensions<T extends { logo?: any; heroImage?: any }>(doc: T): T {
  return {
    ...doc,
    logo: doc.logo ? { ...doc.logo, dimensions: imageDimensions(doc.logo) } : doc.logo,
    heroImage: doc.heroImage ? { ...doc.heroImage, dimensions: imageDimensions(doc.heroImage) } : doc.heroImage,
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
