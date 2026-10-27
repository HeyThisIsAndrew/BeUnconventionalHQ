# Homepage Featured

In the running local site, open `/local-cms` and choose **Site Settings >
Homepage Featured**.

- **Feature a series:** choose or enter a series name. The Series field or a
  matching YouTube/article tag establishes membership. Its newest four videos
  appear first, with matching articles filling any remaining spaces. New uploads
  automatically take the lead after syncing. Existing editorial ordering
  overrides still apply.
- **Feature a mix:** individual Featured items take priority, newest first;
  recent videos and articles fill any remaining spaces, up to four. A show's
  Featured Series flag never overrides this mode. The saved series name is kept
  so switching back is easy.

For videos, set **Featured** under **Status & Curation**. For articles, use the
article editor's **Featured** checkbox. The separate **Featured Series** control
on a video still manages series shelves on the Feed, independently of this
homepage setting.

Use the save button, then preview the homepage locally. As with other Local CMS
edits, the saved content must be committed and deployed to update production.
The setting lives in `src/data/videos.json` as the singleton
`homepage-featured-settings`; YouTube sync preserves non-YouTube documents.
Lanterns remains explicitly selected for the current run.

If a selected series has no matching content (or its name is blank), the homepage
shows the mixed selection rather than silently choosing another show. Without
settings, mixed mode is the default. Displayed stories remain excluded from the
homepage hero and other reserved sections. No content is deleted when it leaves
the four displayed items.

Regression coverage: `node scripts/homepage-featured.test.mjs` and
`node scripts/e2e-featured-highlights.test.mjs` after a production build.
