import { config } from 'dotenv';
import { createClient } from '@sanity/client';
config();

const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID || '38nhxsib',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2024-03-01',
  useCdn: false,
});

async function run() {
  const docs = await sanity.fetch(`*[_type == "video" && contentStatus == "published" && !(_id in path("shorts.*")) && !(_id in path("live.*")) && "film" in topics[]->slug.current] | order(publishedAt desc) {title, publishedAt}[0...10]`);
  console.log(JSON.stringify(docs, null, 2));
}

run().catch(console.error);
