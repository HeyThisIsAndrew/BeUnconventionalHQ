import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert';
import Fuse from 'fuse.js';

const indexPath = path.resolve('dist/client/api/search-index.json');
if (!fs.existsSync(indexPath)) {
  console.error("search-index.json not found. Run 'npm run build' first.");
  process.exit(1);
}

const searchData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

const fuse = new Fuse(searchData, {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'tags', weight: 1 },
    { name: 'type', weight: 0.5 }
  ],
  threshold: 0.4,
  ignoreLocation: true,
});

test('Search Relevance', async (t) => {
  const queries = [
    // Branded Hubs (Priority 1 matches)
    { query: 'netflix', expectedTopId: 'netflix', expectedType: 'hub' },
    { query: 'marvel', expectedTopId: 'marvel-comics', expectedType: 'hub' },
    { query: 'star wars', expectedTopId: 'star-wars', expectedType: 'hub' },
    { query: 'disney', expectedTopId: 'disney', expectedType: 'hub' },
    { query: 'xbox', expectedTopId: 'xbox', expectedType: 'hub' },
    { query: 'playstation', expectedTopId: 'playstation', expectedType: 'hub' },
    { query: 'nintendo', expectedTopId: 'nintendo', expectedType: 'hub' },
    { query: 'hbo', expectedTopId: 'hbo-max', expectedType: 'hub' },
    { query: 'warner bros', expectedTopId: 'warner-bros', expectedType: 'hub' },
    { query: 'universal', expectedTopId: 'universal', expectedType: 'hub' },
    { query: 'sony', expectedTopId: 'sony-pictures', expectedType: 'hub' },
    { query: 'dc', expectedTopId: 'dc-comics', expectedType: 'hub' },

    // Core Nav / Pages
    { query: 'intel', expectedTopId: 'intel', expectedType: 'page' },
    { query: 'featured', expectedTopId: 'featured', expectedType: 'page' },
    { query: 'events', expectedType: 'page' },
    { query: 'media kit', expectedTopId: 'media-kit', expectedType: 'page' },

    // Articles/Content Exact Matches
    { query: 'avengers', expectedTopId: 'why-im-actually-hyped-for-avengers' },
    { query: 'lanterns', expectedTopId: 'lanterns-premiere-review-dcs-biggest' },
    { query: 'god of war', expectedTopId: 'god-of-war-was-this-casting-preordained' },
    { query: 'mortal kombat', expectedTopId: 'mortal-kombat-2-review' },
    { query: 'spider-man', expectedTopId: 'spider-man-brand-new-day-review' },
    { query: 'the boys', expectedTopId: 'the-boys-season-5-episode-5-the-chaos' },
  ];

  for (const { query, expectedTopId, expectedType } of queries) {
    await t.test(`Query "${query}"`, () => {
      const results = fuse.search(query);
      assert.ok(results.length > 0, `Query "${query}" returned no results`);
      
      const top = results[0].item;
      if (expectedTopId) {
        assert.strictEqual(
          top.id,
          expectedTopId,
          `Expected top result id to be "${expectedTopId}", but got "${top.id}" (title: "${top.title}")`
        );
      }
      if (expectedType) {
        assert.strictEqual(
          top.type,
          expectedType,
          `Expected top result type to be "${expectedType}", but got "${top.type}" (id: "${top.id}")`
        );
      }
    });
  }
});
