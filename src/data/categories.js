/**
 * Content pillars surfaced on the homepage. Each links to the Videos page
 * pre-filtered via a URL hash (e.g. /videos#gaming).
 */
export const categories = [
  {
    slug: 'film',
    label: 'Film',
    blurb: 'Reviews, reactions & deep dives',
    image: '/movies.PNG',
    action: 'Read Reviews',
  },
  {
    slug: 'tv',
    label: 'TV',
    blurb: 'Episode breakdowns & season verdicts',
    image: '/tv.PNG',
    action: 'Binge',
  },
  {
    slug: 'gaming',
    label: 'Gaming',
    blurb: 'Coverage, reviews & culture',
    image: '/gaming.PNG',
    action: 'Press Start',
  },
  {
    slug: 'events',
    label: 'Events',
    blurb: 'Premieres & live, on-location coverage',
    image: '/events.PNG',
    action: 'On Location',
  },
];
