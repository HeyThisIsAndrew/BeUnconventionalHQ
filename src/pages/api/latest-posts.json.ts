import type { APIRoute } from 'astro';
import { buildLatestPosts } from '../../lib/latest-posts.ts';

export const prerender = true;

/**
 * GET /api/latest-posts.json
 *
 * Lightweight, public endpoint consumed by external portfolio and hub sites
 * (such as heythisisandrew.com) to display the latest published content without
 * scraping or manual updates.
 *
 * Emits exactly the 2 newest pieces (the latest Article and the latest Video),
 * sorted chronologically descending by publishedAt.
 */
export const GET: APIRoute = async (context) => {
  const siteUrl = context.site?.toString() ?? 'https://beunconventionalhq.com';
  const payload = await buildLatestPosts({ siteUrl });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
};
