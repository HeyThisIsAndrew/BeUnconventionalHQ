export const eventType = {
  name: 'event',
  title: 'Event',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: 'title',
        maxLength: 96,
      },
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'startDate',
      title: 'Start Date',
      type: 'datetime',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'endDate',
      title: 'End Date',
      type: 'datetime',
    },
    {
      name: 'location',
      title: 'Location (City, State)',
      type: 'string',
    },
    {
      name: 'description',
      title: 'Short Description',
      description:
        'A brief blurb shown beneath the hero. Long text collapses behind a "Read more" toggle.',
      type: 'text',
      rows: 4,
    },
    {
      name: 'logo',
      title: 'Event Logo',
      type: 'image',
      options: { hotspot: true },
    },
    {
      name: 'heroImage',
      title: 'Hero Background Image',
      type: 'image',
      options: { hotspot: true },
    },
    {
      name: 'brandColor',
      title: 'Brand Color (Hex Code)',
      type: 'string',
      description: 'e.g. #FF0000',
      validation: (Rule: any) => Rule.regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, {
        name: 'hex color', // Error message is "Does not match hex color-pattern"
        invert: false,
      }),
    },
    {
      name: 'signUpLink',
      title: 'Sign Up / RSVP Link',
      type: 'url',
    },
    {
      name: 'trailerUrl',
      title: 'Trailer Video URL',
      description: 'A YouTube URL to embed as the event trailer in the hero banner',
      type: 'url',
    },
    {
      name: 'videoIds',
      title: 'Related YouTube Video IDs',
      description: 'Array of YouTube Video IDs (e.g., dQw4w9WgXcQ)',
      type: 'array',
      of: [{ type: 'string' }],
      initialValue: [],
    },
    {
      name: 'articleUrls',
      title: 'Related Substack Article URLs',
      description: 'Array of full Substack URLs',
      type: 'array',
      of: [{ 
        type: 'url',
        validation: (Rule: any) => Rule.uri({
          scheme: ['http', 'https']
        }).custom((url: string) => {
          if (typeof url === 'undefined') return true;
          return url.includes('substack.com') ? true : 'URL must be a valid Substack link';
        })
      }],
      initialValue: [],
    },
    {
      name: 'tags',
      title: 'Content Matching Tags',
      description: 'Exact string tags to match against YouTube and Substack titles/descriptions (e.g., "#SDCC 2026").',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        layout: 'tags'
      },
      initialValue: [],
    },
  ],
};
