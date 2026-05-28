import { CATEGORIES } from './constants.js';

export const categories = [
  {
    title: CATEGORIES.MOVIES,
    description: 'Reviews, analysis, and deep dives',
    icon: `<img src="/BeUnconventionalHQ/movies.PNG" alt="Movies category icon" />`,
    href: 'category/movies',
    label: CATEGORIES.FILM,
    action: 'Read Reviews',
  },
  {
    title: CATEGORIES.TV,
    description: 'Episode breakdowns and season reviews',
    icon: `<img src="/BeUnconventionalHQ/tv.PNG" alt="TV category icon" />`,
    href: 'category/tv',
    label: CATEGORIES.TELEVISION,
    action: 'Binge',
  },
  {
    title: CATEGORIES.GAMING,
    description: 'Reviews, coverage, and culture',
    icon: `<img src="/BeUnconventionalHQ/gaming.PNG" alt="Gaming category icon" />`,
    href: 'category/gaming',
    label: CATEGORIES.GAMING,
    action: 'Press Start',
  },
  {
    title: CATEGORIES.EVENTS,
    description: 'Live coverage, premiere events',
    icon: `<img src="/BeUnconventionalHQ/events.PNG" alt="Events category icon" />`,
    href: 'events',
    label: CATEGORIES.EVENTS,
    action: 'On Location',
  },
];
