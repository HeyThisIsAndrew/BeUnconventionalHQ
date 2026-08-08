# Google Search Console (GSC) Coverage Remediation Report

## 1. Executive Summary
An exhaustive audit was conducted on the codebase based on the provided Google Search Console coverage reports (`Critical issues.csv`, `Non-critical issues.csv`, `Metadata.csv`, `Chart.csv` or similar exports). The findings indicate that the site is structurally sound, and the reported "issues" are largely normal behaviors for a modern web application correctly enforcing canonical URLs and redirecting legacy paths. Adjustments were made to the automated sitemap generation to ensure absolute cleanliness of submitted URLs.

## 2. Diagnostic Analysis of Reported Issues

### 2.1. "Page with redirect" (3 Pages)
**Diagnosis:** Google crawled URLs that responded with a 301/302 redirect. These are the legacy routing paths defined in `astro.config.mjs`:
- `/articles` -> `/feed/articles`
- `/videos` -> `/feed/videos`
- `/events-new` -> `/events`
- `/press-kit` -> `/collaborations`

**Root Cause:** Google discovered these either from old indexed versions of the site, external backlinks, or because they were previously submitted in the `sitemap.xml`. Having redirects is **healthy** and ensures link equity is passed to the new URLs.

**Remediation:** We updated the `sitemap()` filter logic in `astro.config.mjs` to strictly parse pathnames and exclude these legacy routes. This guarantees that we never submit redirected URLs to Google via the sitemap, which is the only scenario where "Page with redirect" is considered an error in GSC.

### 2.2. "Alternate page with proper canonical tag" (2 Pages)
**Diagnosis:** Google found alternative URLs for existing pages (e.g., URLs with trailing slashes like `/events/` instead of `/events`, or URLs with tracking parameters like `?utm_source=...`) and correctly respected the `rel="canonical"` tag pointing to the clean URL.

**Root Cause:** This is the intended behavior of the canonical tag. Cloudflare Pages routing handles the `drop-trailing-slash` behavior correctly, and the `Layout.astro` correctly generates `rel="canonical"` tags without trailing slashes. 

**Remediation:** No further codebase action is required. The canonical structure is functioning flawlessly.

### 2.3. "Crawled - currently not indexed" (1 Page)
**Diagnosis:** Google's bot successfully crawled a page but chose not to index it immediately. This typically happens for paginated feed endpoints, tag archives, or if Google's crawl budget prioritized other pages.

**Remediation:** The site's internal linking structure was verified (no trailing slash misconfigurations, no orphaned links to legacy URLs). As the site builds authority, Google will naturally index these secondary pages.

### 2.4. "Excluded by 'noindex' tag" (3 Pages)
**Diagnosis:** GSC reports 3 pages intentionally excluded from indexing.
- `/links`
- `/media-kit`
- `/collaborations/press-kit` (legacy direct share)

**Remediation:** These components correctly have the `noindex = true` prop passed into `Layout.astro`. This is working as intended.

## 3. Codebase Changes Implemented
- **Sitemap Cleanliness:** Updated `astro.config.mjs` to use a strict path-matching filter that explicitly excludes `/articles`, `/videos`, `/events-new`, and `/press-kit` to ensure no redirected paths ever enter the sitemap.
- **Astro Hints Fixed:** Addressed the `ts(6133)` unused variable warnings in `scripts/sync-articles.mjs` (`existingLinks`) and `src/components/Hero.astro` (`shouldArmLocation`) to keep the main branch fully clean.

## 4. Troubleshooting Future GSC Warnings
If similar warnings appear in the future:
1. **Check the Sitemap:** Ensure the URL in question is not being dynamically added to `sitemap-index.xml`. If it is a redirected or `noindex` page, add it to the `excludedPaths` array in `astro.config.mjs`.
2. **Check Internal Links:** Ensure no `<a href="...">` tags in the Astro components point to the legacy URLs. 
3. **Validate in GSC:** Use the "URL Inspection" tool in Google Search Console to see exactly how Googlebot is discovering the URL (look at the "Referring page" section).
