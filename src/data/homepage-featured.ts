/**
 * The homepage's Featured section: WHAT it features, and where it links.
 *
 * It mirrors /feed's featured shelf rather than naming a show itself (it used
 * to hardcode "Lanterns", which Andrew caught: the section must be the feed's
 * featured section, and fall back to plain featured content when there is
 * none). So it asks the feed's own functions, in src/lib/feed-rails.ts:
 *
 *   COLLECTION  selectCollections() picks the collection an editor flagged
 *               (`featuredSeries`), exactly as FeedGrid does for its first
 *               prestige shelf. Its members, its eyebrow ("FEATURED SERIES •
 *               DC"), its accent (seriesAccent, else the hub's brandColor,
 *               never white) and its anchor, `/feed#<seriesSlug>`, which
 *               FeedGrid's scrollToHashRow() lands on.
 *   SITE        No collection: the site's featured videos first, then the
 *               newest stories, under a plain "Featured on the HQ" and a link
 *               to /feed. No accent: the section keeps the site's red.
 *
 * Featured chooses first. Its four items are reserved from the hero and other
 * homepage sections, so the newest episode cannot be removed by the hero.
 * Items are feed records, the shape FeaturedHighlights renders.
 */
import { getAllFeedItems } from '../lib/feed-items';
import { accentFor, seriesSlug } from '../lib/feed-rails';
import { pickHomeFeatured } from '../lib/homepage-featured-selection';
export { featuredKey } from '../lib/homepage-featured-selection';
import { resolveEntity, hexToRgbTriple } from '../lib/entity-resolver';
import { getFeaturedBrandsLocal, getEventsLocal, urlFor } from '../lib/local-content';
import { rowArt } from '../lib/row-art';

export interface HomeFeatured {
  kind: 'collection' | 'site';
  /** The collection's name ("Lanterns"); null for the site fallback. */
  title: string | null;
  /** The show's own logo (src/assets/rows/<slug>-logo.*), shown instead of a
      typeset title. The feed's rule: only when its key art exists too. */
  logo: ImageMetadata | null;
  eyebrow: string;
  /** Where "Explore on the feed" goes. */
  href: string;
  /** Brand/IP accent, or null to keep the site's red. */
  accentHex: string | null;
  accentRgb: string | null;
  /** Whole collection size, including stories beyond the four displayed. */
  total: number;
  items: any[];
}

export async function getHomeFeatured(): Promise<HomeFeatured | null> {
  let all: any[] = [];
  try {
    all = await getAllFeedItems();
  } catch (err) {
    console.error('[homepage-featured] feed items unavailable:', err);
    return null;
  }
  const selection = pickHomeFeatured(all);
  if (!selection) return null;
  const { members, items } = selection;
  if (selection.kind === 'collection' && selection.title) {
    const hub = members.reduce<ReturnType<typeof resolveEntity>>(
      (found, i) => found ?? resolveEntity(i, { brands: getFeaturedBrandsLocal(), events: getEventsLocal(), urlFor }),
      null,
    );
    /* The feed's own three rungs, minus the last: where it falls back to the
       site red, this leaves the accent null and the section keeps its red. */
    const rawHub = (hub as any)?.color;
    const hubHex = typeof rawHub === 'string' ? rawHub : rawHub?.hex ?? null;
    const usableHub = hubHex && hubHex.toLowerCase() !== '#ffffff' ? hubHex : null;
    const accentHex = accentFor(members) || usableHub || null;
    const slug = seriesSlug(selection.title);
    return {
      kind: 'collection',
      title: selection.title,
      logo: rowArt(`${slug}-key-art`) ? rowArt(`${slug}-logo`) : null,
      eyebrow: hub ? `Featured series • ${hub.title}` : 'Featured series',
      href: `/feed#${slug}`,
      accentHex,
      accentRgb: accentHex ? hexToRgbTriple(accentHex) : null,
      total: members.length,
      items,
    };
  }

  /* No selected collection: keep the site's featured-content fallback. */
  return {
    kind: 'site',
    title: null,
    logo: null,
    eyebrow: 'Featured on the HQ',
    href: '/feed',
    accentHex: null,
    accentRgb: null,
    total: items.length,
    items,
  };
}
