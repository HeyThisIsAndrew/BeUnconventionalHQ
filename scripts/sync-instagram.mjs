/**
 * Instagram → Local JSON ingestion sync
 *
 * Pulls the linked Instagram Professional account's media from the Meta Graph API
 * and saves it to src/data/instagram.json for build-time generation.
 *
 * Dry-run by default; pass --execute to write src/data/instagram.json.
 */
import fs from 'node:fs/promises';

async function fetchInstagramMedia() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error('META_ACCESS_TOKEN is required in .env');
  }

  // 1. Get the Facebook Page linked to this account
  const pageRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`);
  if (!pageRes.ok) throw new Error(`Failed to fetch pages: ${pageRes.statusText}`);
  const pageData = await pageRes.json();
  
  if (!pageData.data || pageData.data.length === 0) {
    throw new Error('No Facebook Pages found for this Meta token.');
  }
  
  const page = pageData.data[0];
  const pageToken = page.access_token;
  console.log(`[instagram] Found Page: ${page.name}`);

  // 2. Get the linked Instagram Business Account
  const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${pageToken}`);
  if (!igRes.ok) throw new Error(`Failed to fetch Instagram account: ${igRes.statusText}`);
  const igData = await igRes.json();
  
  if (!igData.instagram_business_account) {
    throw new Error('No Instagram Business Account linked to this Facebook Page.');
  }
  const igId = igData.instagram_business_account.id;
  console.log(`[instagram] Found linked IG Account: ${igId}`);

  // 3. Fetch the latest media (Limit 50 to keep build fast and payload small)
  const mediaRes = await fetch(
    `https://graph.facebook.com/v19.0/${igId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}&limit=50&access_token=${pageToken}`
  );
  if (!mediaRes.ok) throw new Error(`Failed to fetch media: ${mediaRes.statusText}`);
  const mediaData = await mediaRes.json();

  if (!Array.isArray(mediaData.data)) return [];

  return mediaData.data.reduce((acc, item) => {
    if (!item || (!item.media_url && !item.thumbnail_url)) return acc;

    // Normalization: Ensure we always have a display URL.
    // Video items return thumbnail_url, Images return media_url.
    const displayUrl = item.thumbnail_url || item.media_url;
    
    // Process Carousel Children safely
    const children = Array.isArray(item.children?.data) 
      ? item.children.data.reduce((childAcc, child) => {
          if (!child || (!child.media_url && !child.thumbnail_url)) return childAcc;
          childAcc.push({
            id: child.id,
            mediaType: child.media_type,
            url: child.media_url,
            thumbnailUrl: child.thumbnail_url || child.media_url,
          });
          return childAcc;
        }, [])
      : [];

    acc.push({
      id: item.id,
      caption: item.caption || '',
      mediaType: item.media_type,
      displayUrl,
      videoUrl: item.media_type === 'VIDEO' ? item.media_url : undefined,
      permalink: item.permalink,
      timestamp: item.timestamp,
      children,
    });
    return acc;
  }, []);
}

async function run() {
  const isExecute = process.argv.includes('--execute');
  const outPath = new URL('../src/data/instagram.json', import.meta.url);

  try {
    const media = await fetchInstagramMedia();
    console.log(`[instagram] Fetched ${media.length} media items.`);

    if (isExecute) {
      await fs.writeFile(outPath, JSON.stringify(media, null, 2));
      console.log(`[instagram] ✓ Wrote to src/data/instagram.json`);
    } else {
      console.log(`[dry-run] Nothing written. Pass --execute to write src/data/instagram.json.`);
    }
  } catch (err) {
    console.error('[instagram] ❌ Sync failed:', err.message);
    process.exit(1);
  }
}

// Support running directly via Node
if (import.meta.url.startsWith('file:') && process.argv[1] === new URL(import.meta.url).pathname) {
  run();
}
