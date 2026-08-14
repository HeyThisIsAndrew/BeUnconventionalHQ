import instagramData from '../data/instagram.json';
import { postQualifiesForTopic } from './instagram-topic';

export interface InstagramMediaChild {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl: string;
  /**
   * This slide's own copy of `thumbnailUrl`, downloaded to public/instagram/
   * by scripts/sync-instagram.mjs. Optional because it exists only after a
   * sync has run with --execute, and because one slide's download can fail
   * without taking the rest of the album with it.
   *
   * Per-slide by necessity: the flattener spreads the parent post into every
   * child tile, so a child without its own local file would otherwise inherit
   * the PARENT's `localImage` and the whole album would render as identical
   * tiles.
   */
  localThumbnail?: string;
}

export interface InstagramPost {
  id: string;
  caption: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  displayUrl: string;
  videoUrl?: string;
  permalink: string;
  timestamp: string;
  children: InstagramMediaChild[];
}

/**
 * Returns the cached Instagram feed from the build-time sync.
 */
export function getInstagramFeed(): InstagramPost[] {
  // @ts-ignore - Asserting structure from JSON
  return Array.isArray(instagramData) ? (instagramData as InstagramPost[]) : [];
}

/**
 * Flattens the Instagram feed to just a list of images/videos,
 * perfect for a continuous cinematic gallery.
 * Carousels are unpacked into individual slides, deduplicated by media URL.
 *
 * `topicKeywords` restricts the feed to posts that qualify for a hub — see
 * `postQualifiesForTopic` in ./instagram-topic for the matching rule and for
 * why this is no longer a `caption.includes(pageTitle)` substring test.
 * Omit it (the homepage) to get the whole feed; passing an EMPTY array
 * qualifies nothing, so a hub with no keywords configured shows no carousel
 * rather than the global feed.
 *
 * Note that one carousel post yields many tiles, so a caller counting tiles is
 * counting media, not posts.
 */
export function getFlattenedGallery(topicKeywords?: readonly string[]) {
  const feed = getInstagramFeed();
  const gallery = [];
  const seen = new Set<string>();

  const qualify = topicKeywords !== undefined;

  for (const post of feed) {
    if (!post || !post.displayUrl || !post.mediaType) continue; // Skip corrupt top-level posts

    if (qualify && !postQualifiesForTopic(post, topicKeywords)) continue;

    if (post.mediaType === 'CAROUSEL_ALBUM') {
      if (!Array.isArray(post.children)) continue; // Defend against string iteration bug

      for (const child of post.children) {
        if (!child || !child.thumbnailUrl || !child.mediaType) continue; // Skip corrupt children
        if (seen.has(child.thumbnailUrl)) continue;
        seen.add(child.thumbnailUrl);

        gallery.push({
          ...post, // keep caption and permalink for the overlay
          displayUrl: child.thumbnailUrl,
          /*
            `localImage` MUST be overridden, not inherited.

            The spread above copies every field of the parent, and once the
            sync started downloading media that included the parent's
            `localImage`. The gallery prefers `localImage` over `displayUrl`,
            so each slide of an album rendered the PARENT's picture and a
            five-image carousel became five identical tiles. Reported from
            production the first time the sync ran for real, on the Scary
            Movie 6 album.

            `child.localThumbnail` is the child's own downloaded file. When it
            is absent — the sync has not run, or that one download failed —
            this resolves to `undefined`, which is exactly right: the tile
            falls back to `displayUrl`, which was already overridden to the
            child's own thumbnail. It must never fall back to the parent's.
          */
          localImage: child.localThumbnail,
          mediaType: child.mediaType,
          videoUrl: child.mediaType === 'VIDEO' ? child.url : undefined,
        });
      }
    } else {
      if (seen.has(post.displayUrl)) continue;
      seen.add(post.displayUrl);
      gallery.push(post);
    }
  }
  return gallery;
}
