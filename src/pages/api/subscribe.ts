import type { APIRoute } from 'astro';
// @ts-ignore - virtual module provided by @astrojs/cloudflare.
// This is the official way to access bindings and secrets in Astro on Cloudflare.
// AI-NOTE: This static import replaces a dynamic import() inside a try/catch
// block. This resolves a `astro check` error and aligns with the pattern
// used in other API routes like `live-status.json.ts`.
import { env as workerEnv } from 'cloudflare:workers';

// POST-only endpoint, not a page - same on-demand convention as
// live-status.json.ts. Without this the static prerenderer tries (and
// fails) to prerender a GET response for a route with no GET handler.
export const prerender = false;

// AI-NOTE: The unused `locals` parameter was removed from the function signature.
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Parse the incoming JSON body
    const body = await request.json();
    const { email, 'cf-turnstile-response': turnstileToken } = body;

    // AI-NOTE: This `env` object provides a unified way to access Cloudflare
    // bindings and environment variables.
    // - In production, `workerEnv` is injected by the Cloudflare adapter.
    // - In local dev (`astro dev`), `workerEnv` is undefined, so we default to an
    //   empty object. Secrets are then accessed via `import.meta.env`.
    // - The `as any` cast is necessary because KV bindings are objects, not just strings.
    const env = (workerEnv ?? {}) as Record<string, any>;
    const hasSessionCookie = cookies.has('hq_verified');

    // Basic field validation
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email address is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    /*
      Turnstile gate.

      The bot check only applies when Turnstile is actually CONFIGURED. If no
      secret key is present — local `astro dev`, or a preview deploy without
      the binding — requiring a token would make the form impossible to submit
      with no way for the user to resolve it, which is exactly the dead end
      this used to produce.

      When the secret IS set, the token remains mandatory: skipping validation
      because a client forgot to send one would defeat the whole point.
    */
    const turnstileSecret =
      env.TURNSTILE_SECRET_KEY ?? import.meta.env.TURNSTILE_SECRET_KEY;

    /*
      BOTH keys, not just the secret.

      The secret alone is what the server needs to VERIFY a token. The public
      site key is what the browser needs to PRODUCE one. With only the secret
      set, this endpoint demanded a token that no form on the site could
      possibly generate — every subscribe attempt failed with "Please complete
      the verification challenge" and there was no challenge on the page to
      complete. That is not a bot check, it is an outage.

      Requiring both means a half-configured environment degrades to "no bot
      check" (loudly warned below) instead of "nobody can subscribe". When
      both are present the token stays mandatory and is fully verified.
    */
    const turnstileSiteKey =
      env.PUBLIC_TURNSTILE_SITE_KEY ?? import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
    const turnstileConfigured = Boolean(turnstileSecret) && Boolean(turnstileSiteKey);

    if (turnstileSecret && !turnstileSiteKey) {
      console.warn(
        '[subscribe] TURNSTILE_SECRET_KEY is set but PUBLIC_TURNSTILE_SITE_KEY is not. ' +
          'The browser cannot render a widget without the public key, so the bot check ' +
          'is DISABLED rather than blocking every submission. Set the public key to ' +
          'turn it back on.'
      );
    }

    if (turnstileConfigured && !hasSessionCookie && !turnstileToken) {
      return new Response(
        JSON.stringify({ error: 'Please complete the verification challenge.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!turnstileConfigured) {
      console.warn(
        '[subscribe] TURNSTILE_SECRET_KEY is not set — accepting without a bot check. ' +
          'Set it in production or the form is unprotected.'
      );
    }

    // ── Step 1: Validate Turnstile token (only when configured) ──────
    if (turnstileConfigured && !hasSessionCookie) {
      // AI-NOTE: This safely retrieves the Turnstile secret. It prioritizes the
      // Cloudflare environment (`env.TURNSTILE_SECRET_KEY`) but falls back to the
      // local `.env` file (`import.meta.env.TURNSTILE_SECRET_KEY`) for `astro dev`.
      const secret = turnstileSecret as string;

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
    // AI-NOTE: This directly accesses the `SUBSCRIBERS` KV namespace binding from
    // the unified `env` object.
    // In local dev, if the binding is not emulated, `KV` will be `undefined`,
    // and the code will gracefully use the console.log fallback below.
    const KV = env.KV;
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
