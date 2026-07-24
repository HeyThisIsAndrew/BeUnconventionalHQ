export interface Env {
  YOUTUBE_API_KEY: string;
  YOUTUBE_CHANNEL_ID: string;
  RAPIDAPI_KEY: string;
  META_ACCESS_TOKEN: string;
  SANITY_WRITE_TOKEN: string;
  // Hardcoded as these are public/static for the project
  SANITY_PROJECT_ID: string;
  SANITY_DATASET: string;
}

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const SANITY_PROJECT_ID = env.SANITY_PROJECT_ID || '38nhxsib';
    const SANITY_DATASET = env.SANITY_DATASET || 'production';

    let youtubeStats = { followerCount: 0, viewCount: 0, videoCount: 0 };
    let tiktokStats = { followerCount: 0, heartCount: 0, videoCount: 0 };
    let instagramStats = { followerCount: 0, mediaCount: 0 };

    // 1. YouTube Fetch
    try {
      const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${env.YOUTUBE_CHANNEL_ID}&key=${env.YOUTUBE_API_KEY}`);
      if (ytRes.ok) {
        const ytData = await ytRes.json() as any;
        const stats = ytData.items?.[0]?.statistics;
        if (stats) {
          youtubeStats = {
            followerCount: parseInt(stats.subscriberCount || '0', 10),
            viewCount: parseInt(stats.viewCount || '0', 10),
            videoCount: parseInt(stats.videoCount || '0', 10),
          };
        }
      } else {
        console.error('YouTube fetch failed:', ytRes.status);
      }
    } catch (e) {
      console.error('YouTube error:', e);
    }

    // 2. TikTok Fetch
    try {
      const tikRes = await fetch('https://tiktok-scraper7.p.rapidapi.com/user/info?unique_id=beunconventionalhq', {
        headers: {
          'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com',
          'x-rapidapi-key': env.RAPIDAPI_KEY,
        }
      });
      if (tikRes.ok) {
        const tikData = await tikRes.json() as any;
        const stats = tikData.data?.stats;
        if (stats) {
          tiktokStats = {
            followerCount: stats.followerCount || 0,
            heartCount: stats.heartCount || 0,
            videoCount: stats.videoCount || 0,
          };
        }
      } else {
        console.error('TikTok fetch failed:', tikRes.status);
      }
    } catch (e) {
      console.error('TikTok error:', e);
    }

    // 3. Instagram Fetch
    try {
      const fbRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=instagram_business_account{followers_count,media_count}&access_token=${env.META_ACCESS_TOKEN}`);
      if (fbRes.ok) {
        const fbData = await fbRes.json() as any;
        // Typically the first connected page holds the instagram account
        const igAccount = fbData.data?.[0]?.instagram_business_account;
        if (igAccount) {
          instagramStats = {
            followerCount: igAccount.followers_count || 0,
            mediaCount: igAccount.media_count || 0,
          };
        }
      } else {
        console.error('Instagram fetch failed:', fbRes.status);
      }
    } catch (e) {
      console.error('Instagram error:', e);
    }

    // 4. Update Sanity
    try {
      const mutations = [
        {
          createIfNotExists: {
            _id: 'mediaKitStats',
            _type: 'mediaKitStats',
            youtube: youtubeStats,
            tiktok: tiktokStats,
            instagram: instagramStats,
            lastSyncedAt: new Date().toISOString(),
          }
        },
        {
          patch: {
            id: 'mediaKitStats',
            set: {
              youtube: youtubeStats,
              tiktok: tiktokStats,
              instagram: instagramStats,
              lastSyncedAt: new Date().toISOString(),
            }
          }
        }
      ];

      const sanityUrl = `https://${SANITY_PROJECT_ID}.api.sanity.io/v2024-03-01/data/mutate/${SANITY_DATASET}`;
      const sanityRes = await fetch(sanityUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.SANITY_WRITE_TOKEN}`,
        },
        body: JSON.stringify({ mutations }),
      });

      if (!sanityRes.ok) {
        console.error('Sanity patch failed:', sanityRes.status, await sanityRes.text());
      } else {
        console.log('Successfully synced Media Kit stats to Sanity.');
      }
    } catch (e) {
      console.error('Sanity patch error:', e);
    }
  }
}
