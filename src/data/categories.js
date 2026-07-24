import movieImg from '../assets/categories/movies.PNG';
import tvImg from '../assets/categories/tv.PNG';
import gamingImg from '../assets/categories/gaming.PNG';
import eventsImg from '../assets/categories/events.PNG';

/**
 * Content pillars surfaced on the homepage. Each links to the Videos page
 * pre-filtered via a URL hash (e.g. /videos#gaming).
 */
export const categories = [
  {
    slug: 'film',
    label: 'Film',
    blurb: 'Reviews, reactions & deep dives',
    image: movieImg,
    action: 'Read Reviews',
  },
  {
    slug: 'tv',
    label: 'TV',
    blurb: 'Episode breakdowns & season verdicts',
    image: tvImg,
    action: 'Binge',
  },
  {
    slug: 'gaming',
    label: 'Gaming',
    blurb: 'Coverage, reviews & culture',
    image: gamingImg,
    action: 'Press Start',
  },
  {
    slug: 'events',
    label: 'Events',
    blurb: 'Premieres & live, on-location coverage',
    image: eventsImg,
    action: 'On Location',
  },
];
