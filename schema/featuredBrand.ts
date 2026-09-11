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
      name: 'youtubeSyncKeywords',
      title: 'YouTube Sync Keywords (Tier 2)',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description:
        'YouTube tags that auto-assign a video to this brand hub (case/punctuation-insensitive exact match), e.g. "marvel". Set once — epic #34.',
    }),

    defineField({
      name: 'coverageTags',
      title: 'Coverage Tags',
      type: 'array',
      fieldset: 'details',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description:
        'Article and video tags that count as coverage of this hub, e.g. "Marvel Studios". Read ONLY by the site (src/lib/hub-coverage.ts) — the YouTube sync never sees these, so unlike YouTube Sync Keywords they can be written broadly without pulling videos into the hub.',
    }),

    defineField({
      name: 'excludeCoverage',
      title: 'Exclude From Coverage',
      type: 'array',
      fieldset: 'details',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description:
        'Article slugs, article guids, YouTube ids or document _ids to drop from this hub no matter what the tags say. The override for a retrospective: a post about SDCC published in 2027 might be about either edition, and nothing in the data says which, so the edition comes from the tag and anything a loose tag wrongly pulls in gets named here.',
    }),

    defineField({
      name: 'pinnedCoverage',
      title: 'Pin To This Hub',
      type: 'array',
      fieldset: 'details',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description:
        'Article slugs, article guids, YouTube ids or document _ids this hub owns whatever the tags say. A pin beats tag matching outright, so it both adds the item to this hub\u2019s coverage and makes an article page show THIS hub on its card. Use it when the tags point somewhere defensible but wrong, e.g. a GTA piece that mentions Netflix in passing. An item named in Exclude From Coverage stays excluded even if it is pinned.',
    }),

  ],
});
