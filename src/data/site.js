export const site = {
  name: 'Be Unconventional HQ',
  short: 'Unconventional HQ',
  tagline: 'Where nerd culture gets cinematic',
  description:
    'A cinematic creator hub for film, TV, gaming, and live events: reviews, reactions, and deep dives from Be Unconventional HQ.',
  url: 'https://beunconventionalhq.com/',
  image: 'https://beunconventionalhq.com/og-image.png',
  ga4: 'G-CF16HJW04T',

  /**
   * Primary navigation — the single source for BOTH the navbar and the footer.
   *
   * These two used to hardcode their own copies of this list, which is why
   * adding a section meant editing two files and hoping you found both.
   *
   * `href` is the path WITHOUT a leading slash; the navbar adds it and uses
   * the bare value for active-state matching.
   *
   * Order is deliberate: Feed and Intel are the two content surfaces (watch
   * and read) and sit together at the front; Events and Featured are the
   * editorial hubs; About closes.
   */
  nav: [
    { label: 'Feed', href: 'feed' },
    { label: 'Intel', href: 'intel' },
    { label: 'Events', href: 'events' },
    { label: 'Featured', href: 'featured' },
    { label: 'About', href: 'about' },
  ],

  socials: {
    youtube: 'https://www.youtube.com/@BeUnconventionalHQ',
    instagram: 'https://www.instagram.com/beunconventionalhq',
    tiktok: 'https://www.tiktok.com/@beunconventionalhq',
    threads: 'https://www.threads.com/@beunconventionalhq',
    facebook: 'https://www.facebook.com/profile.php?id=61557980693320',
    substack: 'https://beunconventionalhq.substack.com/',
    twitter: 'https://x.com/beunconhq',
    letterboxd: 'https://letterboxd.com/beunconhq/',
    amazon: 'https://www.amazon.com/shop/influencer-0931c541',
  },
};
