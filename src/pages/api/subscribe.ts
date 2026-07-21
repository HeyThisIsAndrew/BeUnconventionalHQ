import type { APIRoute } from 'astro';
// @ts-ignore - virtual module provided by @astrojs/cloudflare.
// This is the official way to access bindings and secrets in Astro on Cloudflare.
import { env as workerEnv } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Parse the incoming JSON body
    const body = await request.json();
    const { email, 'cf-turnstile-response': turnstileToken } = body;

    const env = (workerEnv ?? {}) as Record<string, any>;
    const hasSessionCookie = cookies.has('hq_verified');

    // Basic field validation
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email address is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!hasSessionCookie && !turnstileToken) {
      return new Response(
        JSON.stringify({ error: 'Turnstile verification token required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Step 1: Validate Turnstile token (if no session cookie) ──────
    if (!hasSessionCookie) {
      const secret = env.TURNSTILE_SECRET_KEY ?? import.meta.env.TURNSTILE_SECRET_KEY;

      if (!secret) {
        console.error('TURNSTILE_SECRET_KEY is not set.');
        return new Response(
          JSON.stringify({ error: 'Service is not configured correctly.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const turnstileRes = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret,
            response: turnstileToken,
          }),
        }
      );

      const turnstileData = await turnstileRes.json();

      if (!turnstileData.success) {
        return new Response(
          JSON.stringify({ error: 'Turnstile verification failed. Please try again.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Set secure cookie so future requests in this session bypass Turnstile
      cookies.set('hq_verified', 'true', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 // 24 hours
      });
    }

    // ── Step 2: Store Subscriber Email ──────────────────────────
    const KV = env.SUBSCRIBERS;
    const timestamp = new Date().toISOString();
    if (KV) {
      // Store in KV with email as key, timestamp as value (or a JSON object)
      await KV.put(`subscriber:${email}`, JSON.stringify({
        email,
        subscribedAt: timestamp,
        source: 'SubscribeBox'
      }));
    } else {
      // Fallback for local development if KV binding isn't set up yet
      console.log('--- NEW SUBSCRIBER (Local Fallback) ---');
      console.log(`Email: ${email}`);
      console.log(`Time: ${timestamp}`);
      console.log('-----------------------------------------');
    }

    // ── Success ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ success: true, message: 'Subscribed successfully!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Subscribe API error:', err);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
