import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'featuredBrand',
  title: 'Featured Brand',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Brand / Feature Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: 'title',
        maxLength: 96,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      description: 'A short description of this brand or topic to appear on the Featured Index card.',
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image (Cinematic)',
      type: 'image',
      options: {
        hotspot: true,
      },
      description: 'Used for the background of the hub and the index card. Must be high resolution (1920x1080).',
    }),
    defineField({
      name: 'logo',
      title: 'Brand Logo',
      type: 'image',
      options: {
        hotspot: true,
      },
      description: 'A transparent PNG logo to overlay on the cinematic header.',
    }),
    defineField({
      name: 'trailerUrl',
      title: 'YouTube Trailer URL',
      type: 'url',
      description: 'A YouTube video link to loop quietly in the background of the cinematic header.',
    }),
    defineField({
      name: 'tags',
      title: 'Aggregation Tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Add tags here (e.g., "Marvel", "Deadpool"). The hub will automatically pull any videos or articles whose titles/descriptions contain these tags.',
    }),
  ],
});
