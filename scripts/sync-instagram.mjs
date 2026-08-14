/**
 * Instagram → Local JSON ingestion sync
 *
 * Pulls the linked Instagram Professional account's media from the Meta Graph API
 * and saves it to src/data/instagram.json for build-time generation.
 *
 * Dry-run by default; pass --execute to write src/data/instagram.json.
 */
import fs from 'node:fs/promises';

/*
  ─── WHY THIS DOWNLOADS THE MEDIA INSTEAD OF STORING ITS URL ────────────────

  Instagram's CDN URLs are SIGNED AND TIME-LIMITED. The `oe=` query parameter
  is a hex expiry timestamp, typically two to three days out. This script used
  to write those URLs straight into src/data/instagram.json, which meant the
  entire feed went dead a few days after every sync, no matter what any code
  did with it.

  That is not a hypothetical. It was reported from production with a
  screenshot of the rail showing nothing but broken images, and measured on
  the spot: 188 of 188 stored URLs had already expired, the last of them
  earlier the same morning. Nothing in the site was broken — the data had
  simply rotted on schedule, as it always would.

  So the media is fetched ONCE, here, and written to public/instagram/. Those
  files never expire, are served from our own origin, and remove the
  /api/proxy round trip on every tile.

  ADDITIVE ON PURPOSE. Each item keeps its original `displayUrl` and gains a
  `localImage` only when the download succeeded. The components prefer
  `localImage` and fall back to `displayUrl`, so a sync that partially fails —
  or a checkout where this has never been run — behaves exactly as before
  rather than rendering nothing.
*/
const MEDIA_DIR = new URL('../public/instagram/', import.meta.url);
const MEDIA_PUBLIC_PATH = '/instagram';

/** Extension from the response's content-type, since IG URLs carry no suffix. */
function extensionFor(contentType) {
  if (!contentType) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  return '.jpg';
}

/**
 * Download one media URL into public/instagram/.
 * Returns the public path, or null if anything went wrong — callers keep the
 * remote URL in that case rather than losing the item.
 */
async function downloadMedia(url, id) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      console.warn(`[instagram]   ! ${id}: media fetch returned ${res.status}, keeping remote URL`);
      return null;
    }
    const ext = extensionFor(res.headers.get('content-type'));
    /* The Graph API id is opaque and unique, so it is a safe filename. */
    const filename = `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      console.warn(`[instagram]   ! ${id}: empty body, keeping remote URL`);
      return null;
    }
    await fs.writeFile(new URL(filename, MEDIA_DIR), buffer);
    return `${MEDIA_PUBLIC_PATH}/${filename}`;
  } catch (err) {
    console.warn(`[instagram]   ! ${id}: download failed (${err.message}), keeping remote URL`);
    return null;
  }
}

/**
 * Fetch every item's display image to disk and attach `localImage`.
 * Sequential on purpose: 50 items is small, and hammering the CDN in parallel
 * is a good way to get rate-limited mid-sync and end up with a half-downloaded
 * feed.
 */
async function localiseMedia(items) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  let ok = 0;
  for (const item of items) {
    const local = await downloadMedia(item.displayUrl, item.id);
    if (local) {
      item.localImage = local;
      ok++;
    }
  }
  console.log(`[instagram] Downloaded ${ok}/${items.length} images to public/instagram/`);
  if (ok < items.length) {
    console.warn(
      `[instagram] ${items.length - ok} item(s) kept their expiring remote URL and ` +
        `will break when it lapses. Re-run the sync to retry them.`
    );
  }
  return items;
}

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
      /* Download BEFORE writing the JSON: the file should never claim a
         `localImage` that is not on disk. */
      await localiseMedia(media);
      await fs.writeFile(outPath, JSON.stringify(media, null, 2));
      console.log(`[instagram] ✓ Wrote to src/data/instagram.json`);
      console.log(`[instagram]   Remember to commit public/instagram/ along with it.`);
    } else {
      console.log(
        `[dry-run] Nothing written and nothing downloaded. Pass --execute to write ` +
          `src/data/instagram.json and populate public/instagram/.`
      );
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
