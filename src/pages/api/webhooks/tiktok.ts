import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Webhook receiver for TikTok automation.
 * Expects a payload containing the TikTok video URL and metadata.
 * 
 * Pipeline:
 * 1. Validate incoming webhook secret.
 * 2. Hit RapidAPI (tiktok-video-no-watermark2) to get raw .mp4 URL.
 * 3. Fetch/download .mp4 to memory or pass URL to destination APIs.
 * 4. Syndicate to YouTube Shorts and Instagram Reels.
 */
export const POST: APIRoute = async ({ request }) => {
  // 1. Validate Secret
  const authHeader = request.headers.get('Authorization');
  const expectedSecret = import.meta.env.TIKTOK_WEBHOOK_SECRET;
  
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const payload = await request.json();
    const tiktokUrl = payload.videoUrl;

    if (!tiktokUrl) {
      return new Response(JSON.stringify({ error: 'Missing videoUrl' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Placeholder for RapidAPI fetch
    // const rapidApiResponse = await fetch('https://tiktok-video-no-watermark2.p.rapidapi.com/...', { ... });
    
    // 3. Placeholder for YouTube API upload
    // 4. Placeholder for Instagram API upload

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'TikTok webhook received and enqueued for syndication.' 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
