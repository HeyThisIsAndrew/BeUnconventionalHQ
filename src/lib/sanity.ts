import { createClient } from '@sanity/client';

export const sanityClient = createClient({
  projectId: '38nhxsib',
  dataset: 'production',
  useCdn: true,
  apiVersion: '2024-03-01',
});
