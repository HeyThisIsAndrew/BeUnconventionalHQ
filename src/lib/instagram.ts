import instagramData from '../data/instagram.json';

export interface InstagramMediaChild {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl: string;
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
 * Carousels are unpacked into individual slides.
 */
/**
 * Flattens the Instagram feed to just a list of images/videos,
 * perfect for a continuous cinematic gallery.
 * Carousels are unpacked into individual slides.
 * If a keyword is provided, it only returns items where the original post's caption contains the keyword.
 */
export function getFlattenedGallery(keyword?: string) {
  const feed = getInstagramFeed();
  const gallery = [];
  
  const search = keyword ? keyword.toLowerCase() : null;

  for (const post of feed) {
    if (!post || !post.displayUrl || !post.mediaType) continue; // Skip corrupt top-level posts
    
    // Filter by keyword in caption if one is provided
    if (search && (!post.caption || !post.caption.toLowerCase().includes(search))) {
      continue;
    }
    
    if (post.mediaType === 'CAROUSEL_ALBUM') {
      if (!Array.isArray(post.children)) continue; // Defend against string iteration bug
      
      for (const child of post.children) {
        if (!child || !child.thumbnailUrl || !child.mediaType) continue; // Skip corrupt children
        
        gallery.push({
          ...post, // keep caption and permalink for the overlay
          displayUrl: child.thumbnailUrl,
          mediaType: child.mediaType,
          videoUrl: child.mediaType === 'VIDEO' ? child.url : undefined,
        });
      }
    } else {
      gallery.push(post);
    }
  }
  return gallery;
}
