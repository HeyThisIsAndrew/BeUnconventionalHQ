import { createClient } from '@sanity/client';

const client = createClient({
  projectId: '38nhxsib',
  dataset: 'production',
  apiVersion: '2023-05-03',
  useCdn: false
});

async function run() {
  const query = `*[_type == "event"]`;
  const events = await client.fetch(query);
  console.log(JSON.stringify(events, null, 2));
}

run();
