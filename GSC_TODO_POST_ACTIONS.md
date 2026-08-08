# Google Search Console Post-Remediation To-Do List

These manual actions must be completed inside the Google Search Console UI to finalize the remediation process.

- [ ] **1. Trigger Sitemap Reprocessing**
  - Navigate to **Sitemaps** in the left sidebar of Google Search Console.
  - Locate `https://beunconventionalhq.com/sitemap-index.xml`.
  - Delete the sitemap and re-submit it, OR click into it and see if you can trigger a recrawl. (Re-submitting is the fastest way to force Google to read the newly cleaned sitemap).

- [ ] **2. Validate "Page with redirect" Fix**
  - Navigate to **Pages** > **Page with redirect**.
  - Click the **"Validate Fix"** button. Google will begin a new validation cycle (this can take 1-2 weeks). Since the redirects are no longer in the sitemap, the validation should pass.

- [ ] **3. Ignore "Alternate page with proper canonical tag"**
  - Navigate to **Pages** > **Alternate page with proper canonical tag**.
  - **No action needed.** This is an informational report confirming that your canonical tags are working correctly and preventing duplicate content penalties.

- [ ] **4. Inspect the "Crawled - currently not indexed" URL**
  - Navigate to **Pages** > **Crawled - currently not indexed**.
  - Click on the row to view the specific URL that was flagged.
  - Hover over the URL and click the **magnifying glass icon** (Inspect URL).
  - Click **"Request Indexing"**. This forces Googlebot to re-evaluate the page and prioritize it for the index.
