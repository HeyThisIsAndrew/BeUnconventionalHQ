/**
 * Be Unconventional HQ - Central Taxonomy Constants
 * 
 * This file serves as the single source of truth for category labels
 * and provides a normalization layer between different content sources.
 */

export const CATEGORIES = {
  FILM: 'Film',         // Canonical UI Label
  MOVIES: 'Movies',     // Legacy/Ingestion Alias (used by Substack)
  TV: 'TV',
  TELEVISION: 'Television',
  GAMING: 'Gaming',
  EVENTS: 'Events',
};

/**
 * Normalization Map: Maps legacy aliases to canonical UI labels.
 * Used to resolve drift between "Movies" (Substack) and "Film" (HQ UI).
 */
export const CATEGORY_NORMALIZATION = {
  [CATEGORIES.MOVIES]: CATEGORIES.FILM,
};
