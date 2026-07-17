import { defineType, defineField } from 'sanity';

/**
 * Event — the master document that powers every coverage hub at
 * /events-new/[slug] (soon /events/[slug]). One template, many events.
 *
 * Two modelling decisions worth remembering:
 *
 *  1. Dates are `date`, NOT `datetime`. A convention "happens on July 22",
 *     it is not an instant in time. Storing a time-of-day + timezone on a
 *     calendar date is what caused the one-day-shift bug. As plain
 *     "YYYY-MM-DD" strings they also sort chronologically by string
 *     comparison, so the render layer needs no Date objects at all.
 *
 *  2. `status` only stores the EDITORIAL states (cancelled / postponed).
 *     upcoming / live / completed are DERIVED from the dates at render time
 *     (see the getEventStatus helper added in the lifecycle milestone), so
 *     nobody has to hand-flip an event from "upcoming" to "live" as time
 *     passes. Store what you can't compute; compute the rest.
 */
export default defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  // Fieldsets only group fields in the Studio UI — they have no effect on the
  // stored document shape or on GROQ queries.
  fieldsets: [
    { name: 'core', title: 'Core' },
    { name: 'details', title: 'Details & Links', options: { collapsible: true } },
    { name: 'media', title: 'Media', options: { collapsible: true } },
    { name: 'lifecycle', title: 'Lifecycle', options: { collapsible: true } },
  ],
  fields: [
    // ── Core ────────────────────────────────────────────────────────────
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      fieldset: 'core',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      fieldset: 'core',
      options: { source: 'title', maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'eventType',
      title: 'Event Type',
      type: 'string',
      fieldset: 'core',
      options: {
        list: [
          { title: 'Convention', value: 'convention' },
          { title: 'Premiere', value: 'premiere' },
          { title: 'Screening', value: 'screening' },
          { title: 'Festival', value: 'festival' },
          { title: 'Expo', value: 'expo' },
          { title: 'Other', value: 'other' },
        ],
        layout: 'dropdown',
      },
    }),
    defineField({
      name: 'organizer',
      title: 'Organizer',
      type: 'string',
      fieldset: 'core',
      description: 'e.g. San Diego Comic Convention',
    }),
    defineField({
      name: 'startDate',
      title: 'Start Date',
      type: 'date',
      fieldset: 'core',
      options: { dateFormat: 'YYYY-MM-DD' },
      description: 'Calendar date only — no time, no timezone. Stored as YYYY-MM-DD.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'endDate',
      title: 'End Date',
      type: 'date',
      fieldset: 'core',
      options: { dateFormat: 'YYYY-MM-DD' },
      description: 'Leave empty for single-day events.',
      // Cross-field validation: because both are "YYYY-MM-DD" strings, a plain
      // string comparison is a correct chronological comparison.
      validation: (rule) =>
        rule.custom((endDate: string | undefined, context: any) => {
          const start = context?.document?.startDate;
          if (!endDate || !start) return true;
          return endDate >= start ? true : 'End date must be on or after the start date';
        }),
    }),

    // ── Details & Links ─────────────────────────────────────────────────
    defineField({
      name: 'description',
      title: 'Short Description',
      type: 'text',
      rows: 4,
      fieldset: 'details',
      description:
        'A brief blurb shown beneath the hero. Long text collapses behind a "Read more" toggle.',
    }),
    defineField({
      name: 'location',
      title: 'Location',
      type: 'object',
      fieldset: 'details',
      options: { collapsible: false },
      fields: [
        defineField({ name: 'venue', title: 'Venue', type: 'string' }),
        defineField({ name: 'city', title: 'City', type: 'string' }),
        defineField({ name: 'region', title: 'State / Region', type: 'string' }),
        defineField({ name: 'country', title: 'Country', type: 'string' }),
      ],
    }),
    defineField({
      name: 'officialWebsite',
      title: 'Official Website',
      type: 'url',
      fieldset: 'details',
      description: "The event's own homepage.",
    }),
    defineField({
      name: 'signUpLink',
      title: 'Sign Up / RSVP / Tickets Link',
      type: 'url',
      fieldset: 'details',
      description: 'Where attendees register or buy tickets (distinct from the official website).',
    }),
    defineField({
      name: 'brandColor',
      title: 'Brand Color (Hex Code)',
      type: 'string',
      fieldset: 'details',
      description: 'e.g. #FF0000',
      validation: (rule) =>
        rule.regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, {
          name: 'hex color',
          invert: false,
        }),
    }),
    defineField({
      name: 'socialLinks',
      title: 'Social Links',
      type: 'array',
      fieldset: 'details',
      description: 'Official social accounts for this event.',
      of: [
        {
          type: 'object',
          name: 'socialLink',
          fields: [
            {
              name: 'platform',
              title: 'Platform',
              type: 'string',
              options: {
                list: [
                  { title: 'Instagram', value: 'instagram' },
                  { title: 'X / Twitter', value: 'x' },
                  { title: 'TikTok', value: 'tiktok' },
                  { title: 'YouTube', value: 'youtube' },
                  { title: 'Facebook', value: 'facebook' },
                  { title: 'Website', value: 'website' },
                ],
              },
            },
            { name: 'url', title: 'URL', type: 'url' },
          ],
          preview: { select: { title: 'platform', subtitle: 'url' } },
        },
      ],
    }),

    // ── Media ───────────────────────────────────────────────────────────
    defineField({
      name: 'heroImage',
      title: 'Hero Background Image',
      type: 'image',
      fieldset: 'media',
      options: { hotspot: true },
    }),
    defineField({
      name: 'logo',
      title: 'Event Logo',
      type: 'image',
      fieldset: 'media',
      options: { hotspot: true },
      description: 'Transparent PNG. Becomes the visible identity element in the hero.',
    }),
    defineField({
      name: 'trailerUrl',
      title: 'Hero Trailer URL',
      type: 'url',
      fieldset: 'media',
      description: 'A YouTube URL embedded as the trailer in the hero banner.',
    }),
    defineField({
      name: 'videoAssets',
      title: 'Additional Videos',
      type: 'array',
      fieldset: 'media',
      description: 'Supplementary trailers or clips beyond the hero trailer.',
      of: [
        {
          type: 'object',
          name: 'videoAsset',
          fields: [
            { name: 'title', title: 'Title', type: 'string' },
            { name: 'url', title: 'YouTube URL', type: 'url' },
          ],
          preview: { select: { title: 'title', subtitle: 'url' } },
        },
      ],
    }),
    defineField({
      name: 'gallery',
      title: 'Image Gallery',
      type: 'array',
      fieldset: 'media',
      of: [
        {
          type: 'image',
          options: { hotspot: true },
          fields: [{ name: 'alt', title: 'Alt text', type: 'string' }],
        },
      ],
    }),
    defineField({
      name: 'sponsors',
      title: 'Sponsor Logos',
      type: 'array',
      fieldset: 'media',
      of: [
        {
          type: 'object',
          name: 'sponsor',
          fields: [
            { name: 'name', title: 'Name', type: 'string' },
            { name: 'logo', title: 'Logo', type: 'image', options: { hotspot: true } },
            { name: 'url', title: 'Website', type: 'url' },
          ],
          preview: { select: { title: 'name', media: 'logo' } },
        },
      ],
    }),
    defineField({
      name: 'pressAssets',
      title: 'Downloadable Press Assets',
      type: 'array',
      fieldset: 'media',
      description: 'One-sheets, logo packs, fact sheets — anything a partner can download.',
      of: [
        {
          type: 'object',
          name: 'pressAsset',
          fields: [
            { name: 'label', title: 'Label', type: 'string' },
            { name: 'file', title: 'File', type: 'file' },
          ],
          preview: { select: { title: 'label' } },
        },
      ],
    }),

    // ── Lifecycle ───────────────────────────────────────────────────────
    defineField({
      name: 'status',
      title: 'Status Override',
      type: 'string',
      fieldset: 'lifecycle',
      description:
        'Upcoming / Live / Completed are derived automatically from the dates — leave this on "Scheduled". Only change it to Cancelled or Postponed to override.',
      options: {
        list: [
          { title: 'Scheduled (auto by date)', value: 'scheduled' },
          { title: 'Cancelled', value: 'cancelled' },
          { title: 'Postponed', value: 'postponed' },
        ],
        layout: 'radio',
      },
      initialValue: 'scheduled',
      validation: (rule) => rule.required(),
    }),

    // ── Content matching ────────────────────────────────────────────────
    defineField({
      name: 'tags',
      title: 'Content Matching Tags',
      type: 'array',
      fieldset: 'details',
      description:
        'Exact string tags matched against YouTube and Substack titles/descriptions (e.g., "#SDCC 2026").',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      initialValue: [],
    }),
    // Legacy fields — retained so existing documents aren't orphaned. Content is
    // now pulled via `tags` matching against the global feed, so these are no
    // longer the primary mechanism. Safe to remove once no document uses them.
    defineField({
      name: 'videoIds',
      title: 'Related YouTube Video IDs (legacy)',
      type: 'array',
      fieldset: 'details',
      of: [{ type: 'string' }],
      initialValue: [],
    }),
    defineField({
      name: 'articleUrls',
      title: 'Related Substack URLs (legacy)',
      type: 'array',
      fieldset: 'details',
      of: [{ type: 'url' }],
      initialValue: [],
    }),
  ],
  preview: {
    select: { title: 'title', media: 'logo', start: 'startDate' },
    prepare({ title, media, start }: any) {
      return { title, subtitle: start || 'No date set', media };
    },
  },
});
