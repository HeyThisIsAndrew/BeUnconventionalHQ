/**
 * The homepage's Featured section: WHAT it features, and where it links.
 *
 * The editor chooses a series or a mixed selection in Local CMS > Homepage
 * Featured. This setting is independent of the Feed's collection flags and
 * automatic fallback, so selecting a mix cannot silently promote a series.
 * Series mode supplies its logo and accent; mixed mode uses the site styling.
 *
 * Featured chooses first. Its four items are reserved from the hero and other
 * homepage sections, so the newest episode cannot be removed by the hero.
 * Items are feed records, the shape FeaturedHighlights renders.
 */
import { getAllFeedItems } from '../lib/feed-items';
import { accentFor, seriesSlug, selectCollections } from '../lib/feed-rails';
import { pickHomeFeatured, readHomeFeaturedSettings } from '../lib/homepage-featured-selection';
export { featuredKey } from '../lib/homepage-featured-selection';
import { resolveEntity, hexToRgbTriple } from '../lib/entity-resolver';
import { getFeaturedBrandsLocal, getEventsLocal, urlFor } from '../lib/local-content';
import { rowArt } from '../lib/row-art';
import localContent from './videos.json';

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
  const selection = pickHomeFeatured(all, readHomeFeaturedSettings(localContent));
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
      href: selectCollections(all).some((collection) => seriesSlug(collection.name) === slug)
        ? `/feed#${slug}` : '/feed',
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
