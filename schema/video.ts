import { defineType, defineField } from 'sanity';

/**
 * Video — a YouTube video ingested into Sanity by scripts/sync-youtube.mjs.
 *
 * FACTUAL vs EDITORIAL separation (the core rule of the pipeline):
 *   • YouTube fieldset  — synced from the YouTube Data API every run. Marked
 *     readOnly so editors don't hand-edit values the sync will overwrite.
 *     (readOnly only affects the Studio UI; the sync writes via a token and is
 *     unaffected.)
 *   • Editorial fieldset — curated by humans. The sync NEVER writes these after
 *     a document is first created; it only seeds a couple of defaults on
 *     creation. This is what makes Sanity the editorial source of truth.
 *
 * See scripts/youtube-sync.md for the full pipeline contract.
 */
export default defineType({
  name: 'video',
  title: 'Video',
  type: 'document',
  fieldsets: [
    { name: 'youtube', title: 'YouTube (synced — do not edit)', options: { collapsible: true } },
    { name: 'editorial', title: 'Editorial (curated by you)', options: { collapsible: true, collapsed: false } },
  ],
  orderings: [
    {
      title: 'Published Date, Newest First',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }],
    },
    {
      title: 'Published Date, Oldest First',
      name: 'publishedAtAsc',
      by: [{ field: 'publishedAt', direction: 'asc' }],
    },
  ],
  fields: [
    // ── Synced from YouTube (overwritten every sync; read-only in Studio) ──
    defineField({
      name: 'youtubeId',
      title: 'YouTube Video ID',
      type: 'string',
      fieldset: 'youtube',
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({ name: 'title', title: 'Title', type: 'string', fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 4, fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'thumbnailUrl', title: 'Thumbnail URL', type: 'url', fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'durationSeconds', title: 'Duration (seconds)', type: 'number', fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'isShort', title: 'Is Short (≤ 60s)', type: 'boolean', fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'viewCount', title: 'View Count', type: 'number', fieldset: 'youtube', readOnly: true }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime', fieldset: 'youtube', readOnly: true }),
    defineField({
      name: 'youtubeTags',
      title: 'YouTube Tags',
      type: 'array',
      of: [{ type: 'string' }],
      fieldset: 'youtube',
      readOnly: true,
      description: "YouTube's own tags — factual. Use the editorial fields below for site organization.",
    }),
    defineField({ name: 'platform', title: 'Platform', type: 'string', fieldset: 'youtube', readOnly: true, initialValue: 'youtube' }),
    defineField({ name: 'lastSyncedAt', title: 'Last Synced At', type: 'datetime', fieldset: 'youtube', readOnly: true }),

    // ── Editorial (never overwritten by the sync) ──
    defineField({
      name: 'contentStatus',
      title: 'Content Status',
      type: 'string',
      fieldset: 'editorial',
      options: {
        list: [
          { title: 'Needs Review', value: 'needs-review' },
          { title: 'Published', value: 'published' },
          { title: 'Archived', value: 'archived' },
        ],
        layout: 'radio',
      },
      initialValue: 'needs-review',
      description:
        'Newly synced videos start as "Needs Review" and should not appear on the site until set to "Published". The sync sets this only on first creation and never changes it afterward.',
    }),
    defineField({ name: 'featured', title: 'Featured', type: 'boolean', fieldset: 'editorial', initialValue: false }),
    defineField({
      name: 'franchises',
      title: 'Franchises',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      fieldset: 'editorial',
      description: 'e.g. DC, Marvel, Star Wars — powers "all DC coverage" style queries.',
    }),
    defineField({
      name: 'characters',
      title: 'Characters',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      fieldset: 'editorial',
      description: 'e.g. Superman, Deadpool.',
    }),
    defineField({
      name: 'topics',
      title: 'Topics',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      fieldset: 'editorial',
    }),
    defineField({
      name: 'coverageType',
      title: 'Coverage Type',
      type: 'string',
      fieldset: 'editorial',
      options: {
        list: [
          { title: 'Review', value: 'review' },
          { title: 'Reaction', value: 'reaction' },
          { title: 'Trailer', value: 'trailer' },
          { title: 'Breakdown', value: 'breakdown' },
          { title: 'Vlog', value: 'vlog' },
          { title: 'Interview', value: 'interview' },
          { title: 'News', value: 'news' },
          { title: 'Other', value: 'other' },
        ],
      },
    }),
    defineField({ name: 'series', title: 'Series', type: 'string', fieldset: 'editorial', description: 'Editorial series this video belongs to.' }),
    defineField({
      name: 'relatedMedia',
      title: 'Related Media',
      type: 'array',
      fieldset: 'editorial',
      description: 'Films, shows, games, etc. this video covers. Broader than "related films" to support future expansion.',
      of: [
        {
          type: 'object',
          name: 'relatedMediaItem',
          fields: [
            { name: 'title', title: 'Title', type: 'string' },
            {
              name: 'mediaType',
              title: 'Type',
              type: 'string',
              options: {
                list: [
                  { title: 'Film', value: 'film' },
                  { title: 'Show', value: 'show' },
                  { title: 'Game', value: 'game' },
                  { title: 'Comic', value: 'comic' },
                  { title: 'Other', value: 'other' },
                ],
              },
            },
          ],
          preview: { select: { title: 'title', subtitle: 'mediaType' } },
        },
      ],
    }),
    defineField({
      name: 'hubs',
      title: 'Hubs',
      type: 'array',
      fieldset: 'editorial',
      // Additive: events joined featuredBrand as valid hub targets (Phase C1,
      // epic #25) so event pages can query coverage via references(). Existing
      // brand references are unaffected.
      of: [{ type: 'reference', to: [{ type: 'featuredBrand' }, { type: 'event' }] }],
      description:
        'Assign this video to hubs (Featured Brands and/or Events). Hub pages pull their coverage from these references.',
    }),
    defineField({ name: 'editorialNotes', title: 'Editorial Notes', type: 'text', rows: 3, fieldset: 'editorial' }),
  ],
  preview: {
    select: { title: 'title', status: 'contentStatus', youtubeId: 'youtubeId' },
    prepare({ title, status, youtubeId }: any) {
      return { title: title || youtubeId || 'Untitled video', subtitle: status ? `● ${status}` : undefined };
    },
  },
});
