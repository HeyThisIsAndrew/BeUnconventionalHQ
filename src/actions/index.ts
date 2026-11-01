/**
 * Astro Actions — the server side of the newsletter and contact forms (#203).
 *
 * ─── WHY ACTIONS, AND WHY THE /api ROUTES SURVIVED ────────────────────────
 * These two flows used to be hand-written API routes doing their own body
 * parsing, field validation and error shaping. Actions replace all three with
 * a Zod schema and a typed client call, so `NewsletterForm` no longer carries
 * a bespoke `fetch` wrapper.
 *
 * `src/pages/api/subscribe.ts` and `src/pages/api/contact.ts` were NOT
 * deleted. They are now thin compatibility shims that call these actions, so
 * anything external still POSTing JSON to those URLs keeps working. Nothing
 * on this site posts to them any more.
 *
 * ─── WHY `accept: 'json'` AND NOT `'form'` ────────────────────────────────
 * `accept: 'form'` is the option that buys progressive enhancement: a plain
 * `<form action={actions.subscribe}>` POSTs to `?_astroAction=subscribe` on
 * the CURRENT page, and the page's own render runs the action and reads the
 * result back with `Astro.getActionResult()`.
 *
 * That needs the page to be server-rendered. The newsletter form ships inside
 * the CTA panel on prerendered static pages, so there is no page render to
 * receive that POST. Making every page carrying the form on-demand would undo
 * the static output the whole site is built on.
 *
 * And even with that spent, invisible Turnstile (#190) needs JavaScript to
 * call `turnstile.execute()` at all, so a no-JS submit would arrive with no
 * token and be refused. Two independent blockers, so this stays JSON and the
 * "works without JavaScript" line in #203 is knowingly not met. See the
 * ticket notes rather than assuming this was an oversight.
 *
 * ─── SECRETS ──────────────────────────────────────────────────────────────
 * Read through `cloudflare:workers`, falling back to `import.meta.env` for
 * `astro dev`. `Astro.locals.runtime.env` throws on Astro 6 and later, and
 * `import.meta.env` ALONE is not enough: it is substituted at build time, so
 * a Workers runtime secret reads back `undefined`. The old contact route had
 * exactly that bug — it verified Turnstile with `secret: undefined`, which
 * siteverify answers with `success: false`, so every contact submission
 * failed in production. Both actions now share one reader.
 */
import { ActionError, defineAction } from 'astro:actions';
/* `astro:schema` is deprecated and goes away in Astro 8; `astro/zod` is the
   same Zod 4 instance without the deprecation. */
import { z } from 'astro/zod';
import { TOPICS, parseTopics, formatTopics } from '../lib/dispatch-topics.ts';
import {
  signPrefsToken, verifyPrefsToken, prefsLink, prefsEmail, normalizeEmail, LINK_FROM,
  findKitSubscriber, saveKitTopics, unsubscribeKit, topicsOf, type KitConfig,
} from '../lib/newsletter-prefs.ts';
// @ts-ignore - virtual module provided by @astrojs/cloudflare, absent from
// the type graph during `astro check` but present at build and at runtime.
import { env as workerEnv } from 'cloudflare:workers';

/** Cloudflare bindings and secrets, or `{}` under `astro dev`. */
function runtimeEnv(): Record<string, any> {
  return (workerEnv ?? {}) as Record<string, any>;
}

/**
 * One env value, Workers runtime first and the build-time `.env` second.
 * KV bindings come back as objects, hence `any` rather than `string`.
 */
function readEnv(name: string): any {
  const fromWorker = runtimeEnv()[name];
  if (fromWorker !== undefined && fromWorker !== '') return fromWorker;
  const fromBuild = (import.meta.env as Record<string, any>)[name];
  return fromBuild === '' ? undefined : fromBuild;
}

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Set after a token verifies, so the second form a reader fills in during the
 * same visit does not challenge them again.
 *
 * `secure: true` means this is never set over plain http, so `astro dev` on
 * localhost re-verifies every submit. That is the correct trade: a cookie
 * that skips the bot check must not be settable over a channel that can be
 * written by anything on the network.
 */
const VERIFIED_COOKIE = 'hq_verified';
const VERIFIED_COOKIE_MAX_AGE = 60 * 60 * 24;

/**
 * Turnstile is "configured" only when BOTH keys are present.
 *
 * The secret is what the server needs to VERIFY a token; the public site key
 * is what the browser needs to PRODUCE one. With only the secret set, these
 * handlers would demand a token no form on the site could generate — every
 * submission failing with "Please complete the verification challenge" and no
 * challenge anywhere to complete. That is not a bot check, it is an outage.
 *
 * So a half-configured environment degrades to "no bot check" (warned, every
 * request) instead of "nobody can subscribe". With both present the token is
 * mandatory and fully verified.
 */
/*
  THERE IS NO `e2e-test-` BYPASS ANY MORE, AND IT MUST NOT COME BACK.

  These handlers used to skip the bot check outright for any address starting
  `e2e-test-`, so `e2e-test-anything@spam.example` walked past Turnstile in
  production. It existed because the e2e suite submits a real address against
  a real build and cannot solve a challenge.

  It is not needed. CI hands the build Cloudflare's always-passes TEST keys
  (`.github/workflows/ci.yml`, "Use Cloudflare's always-passes Turnstile test
  key"): the test site key renders on any domain and issues a token, and the
  test secret verifies whatever it is given. The suite gets a genuine token
  through the genuine code path, which is more than the bypass ever proved.
  Run local e2e the same way — see `.env.example`.
*/
function turnstileConfig(label: string): { secret?: string; configured: boolean } {
  const secret = readEnv('TURNSTILE_SECRET_KEY');
  const siteKey = readEnv('PUBLIC_TURNSTILE_SITE_KEY');

  if (secret && !siteKey) {
    console.warn(
      `[actions.${label}] TURNSTILE_SECRET_KEY is set but PUBLIC_TURNSTILE_SITE_KEY ` +
        'is not. The browser cannot render a widget without the public key, so the ' +
        'bot check is DISABLED rather than blocking every submission. Set the ' +
        'public key to turn it back on.',
    );
  }

  return { secret, configured: Boolean(secret) && Boolean(siteKey) };
}

/**
 * Throw unless this request is from a human.
 *
 * Returns quietly when Turnstile is not configured, or when this visitor
 * already cleared a challenge earlier in the visit.
 */
async function requireHuman(
  context: { cookies: any; request: Request },
  token: string | undefined,
  label: string,
): Promise<void> {
  const { secret, configured } = turnstileConfig(label);

  if (!configured) {
    console.warn(
      `[actions.${label}] Turnstile is not configured — accepting without a bot ` +
        'check. Set both keys in production or the form is unprotected.',
    );
    return;
  }

  if (context.cookies.has(VERIFIED_COOKIE)) return;

  if (!token) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: 'Please complete the verification challenge.',
    });
  }

  const body = new URLSearchParams({ secret: secret as string, response: token });

  /* Cloudflare's own header, so siteverify can score the client's address.
     Absent under `astro dev`, which siteverify accepts. */
  const remoteIp = context.request.headers.get('CF-Connecting-IP');
  if (remoteIp) body.set('remoteip', remoteIp);

  let outcome: any;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    outcome = await response.json();
  } catch (error) {
    /* siteverify itself was unreachable. That is our outage, not the
       reader's failed challenge, so it must not read as "you failed". */
    console.error(`[actions.${label}] siteverify unreachable:`, error);
    throw new ActionError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'We could not reach the verification service. Please try again.',
    });
  }

  if (!outcome?.success) {
    /* `error-codes` is the only way to tell an expired token from a bad
       secret. It is the first thing anyone debugging this will want. */
    console.warn(
      `[actions.${label}] siteverify rejected the token:`,
      outcome?.['error-codes'] ?? outcome,
    );
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: 'Turnstile verification failed. Please try again.',
    });
  }

  context.cookies.set(VERIFIED_COOKIE, 'true', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: VERIFIED_COOKIE_MAX_AGE,
  });
}

/**
 * Escape a submitted value before it goes into the HTML email body.
 *
 * Resend is handed an HTML string, so an unescaped `message` lets a submitter
 * write markup straight into the owner's inbox — a link with one label and a
 * different href is the cheap version. Interpolating raw form input into HTML
 * is the bug regardless of who reads it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Kit settings for the newsletter actions, or null while Kit is not configured. */
function readKitConfig(): KitConfig | null {
  const apiKey = readEnv('KIT_API_KEY');
  if (!apiKey) return null;
  return { apiKey, field: readEnv('KIT_TOPICS_FIELD') || 'hq_topics', formId: readEnv('KIT_FORM_ID') || undefined };
}

/** On the list, by the site's own record or by Kit's. */
async function isSubscriber(email: string): Promise<boolean> {
  const KV = readEnv('KV');
  if (KV && (await KV.get(`subscriber:${email}`))) return true;
  const kitConfig = readKitConfig();
  if (!kitConfig) return false;
  try {
    const subscriber = await findKitSubscriber(kitConfig, email);
    return Boolean(subscriber && subscriber.state !== 'cancelled');
  } catch {
    return false;
  }
}

export const server = {
  /**
   * Newsletter signup. Stores `subscriber:<email>` in the `KV` binding.
   */
  subscribe: defineAction({
    accept: 'json',
    input: z.object({
      email: z.email('Please enter a valid email address.'),
      /* Optional in the SCHEMA, not in the policy: `requireHuman` is what
         decides whether a missing token is allowed. Marking it required here
         would reject the unconfigured-Turnstile case before that runs. */
      'cf-turnstile-response': z.string().optional(),
      /* THE HQ DISPATCH topics from the form's toggles. Absent or empty means
         all four (src/lib/dispatch-topics.ts parseTopics). */
      topics: z.array(z.enum(TOPICS)).max(TOPICS.length).optional(),
    }),
    handler: async (input, context) => {
      const { email, 'cf-turnstile-response': turnstileToken } = input;
      const topics = formatTopics(parseTopics(input.topics ?? []));

      await requireHuman(context, turnstileToken, 'subscribe');

      /*
        Every subscriber is a `subscriber:<email>` key inside the one `KV`
        namespace declared in wrangler.jsonc. There is no separate
        "SUBSCRIBERS" namespace, despite what older comments claimed.

        Under `astro dev` the binding is not emulated, so `KV` is undefined
        and the address goes to the console instead of being lost silently.
      */
      const KV = readEnv('KV');
      const timestamp = new Date().toISOString();

      if (KV) {
        await KV.put(
          `subscriber:${email}`,
          JSON.stringify({
            email,
            subscribedAt: timestamp,
            /* Provenance, not a component reference. Nothing reads it back;
               it exists so a future second form is tellable apart in a KV
               dump. */
            source: 'NewsletterForm',
            topics,
          }),
        );
      } else {
        console.log('--- NEW SUBSCRIBER (Local Fallback) ---');
        console.log(`Email: ${email}`);
        console.log(`Time: ${timestamp}`);
        console.log('-----------------------------------------');
      }

      /* Kit is where the newsletter is sent from. Until KIT_SYNC_SIGNUPS is
         "true" (and KIT_API_KEY set) the KV record above is the only copy,
         exactly as before. A Kit failure never fails the signup: the address
         is already saved, and the owner's backfill can carry it later. */
      const kitConfig = readKitConfig();
      if (kitConfig && readEnv('KIT_SYNC_SIGNUPS') === 'true') {
        try {
          await saveKitTopics(kitConfig, email, parseTopics(topics), { addToForm: true });
        } catch (error) {
          console.error('[actions.subscribe] Kit sync failed:', error instanceof Error ? error.message : error);
        }
      }

      return { success: true, message: 'Subscribed successfully!' };
    },
  }),

  /**
   * Preference page, step 1: email the reader a signed link to /newsletter.
   * The answer is the same whether or not the address is on the list, so the
   * form cannot be used to find out who subscribes.
   */
  newsletterLink: defineAction({
    accept: 'json',
    input: z.object({
      email: z.email('Please enter a valid email address.'),
      'cf-turnstile-response': z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireHuman(context, input['cf-turnstile-response'], 'newsletterLink');
      const email = normalizeEmail(input.email);
      const secret = readEnv('NEWSLETTER_LINK_SECRET');
      const resendKey = readEnv('RESEND_API_KEY');
      if (!secret || !resendKey) {
        console.error('[actions.newsletterLink] NEWSLETTER_LINK_SECRET or RESEND_API_KEY is not set.');
        throw new ActionError({ code: 'SERVICE_UNAVAILABLE', message: 'This page is not available right now. Please try again later.' });
      }
      /* One link per address per 10 minutes, whatever the form is fed: the
         answer below is the same either way, so a script cannot use this
         to flood someone's inbox. */
      const KV = readEnv('KV');
      const cooling = KV ? await KV.get(`prefslink:${email}`) : null;
      if (!cooling && (await isSubscriber(email))) {
        if (KV) await KV.put(`prefslink:${email}`, '1', { expirationTtl: 600 });
        // The site the request came to, so a link sent from a preview copy opens
        // that preview, and one from production opens production.
        const link = prefsLink(new URL(context.request.url).origin, await signPrefsToken(secret, email));
        const message = prefsEmail(link);
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: LINK_FROM, to: email, ...message }),
        });
        if (!res.ok) console.error(`[actions.newsletterLink] Resend answered HTTP ${res.status}`);
      }
      return { success: true, message: 'If that address is on the list, a link is on its way. Check your inbox.' };
    },
  }),

  /**
   * Preference page, step 2: read or change a reader's topics, or
   * unsubscribe them, with the signed token from their link.
   */
  newsletterPrefs: defineAction({
    accept: 'json',
    input: z.object({
      token: z.string().max(600),
      op: z.enum(['get', 'save', 'unsubscribe']),
      topics: z.array(z.enum(TOPICS)).max(TOPICS.length).optional(),
    }),
    handler: async (input) => {
      const email = await verifyPrefsToken(readEnv('NEWSLETTER_LINK_SECRET') ?? '', input.token);
      if (!email) {
        throw new ActionError({ code: 'UNAUTHORIZED', message: 'This link has expired or is not valid. Ask for a new one with the form above.' });
      }
      const KV = readEnv('KV');
      const kitConfig = readKitConfig();
      const record: any = KV ? await KV.get(`subscriber:${email}`, 'json') : null;

      if (input.op === 'get') {
        let topics = parseTopics((record as any)?.topics);
        if (kitConfig) {
          try {
            const subscriber = await findKitSubscriber(kitConfig, email);
            if (subscriber) topics = topicsOf(subscriber, kitConfig.field);
          } catch (error) {
            console.error('[actions.newsletterPrefs] Kit read failed:', error instanceof Error ? error.message : error);
          }
        }
        return { email, topics, unsubscribed: Boolean((record as any)?.unsubscribedAt) };
      }

      if (input.op === 'save') {
        const topics = parseTopics(input.topics ?? []);
        if (KV) await KV.put(`subscriber:${email}`, JSON.stringify({ ...(record ?? { email }), topics: formatTopics(topics), topicsUpdatedAt: new Date().toISOString(), unsubscribedAt: undefined }));
        // A reader Kit does not know yet comes in through the form, confirmation and all.
        if (kitConfig) await saveKitTopics(kitConfig, email, topics, { addToForm: true });
        return { email, topics, unsubscribed: false };
      }

      // unsubscribe
      if (KV && record) await KV.put(`subscriber:${email}`, JSON.stringify({ ...record, unsubscribedAt: new Date().toISOString() }));
      if (kitConfig) await unsubscribeKit(kitConfig, email);
      return { email, topics: [], unsubscribed: true };
    },
  }),

  /**
   * Contact form. Relays to press@ through Resend.
   */
  contact: defineAction({
    accept: 'json',
    input: z.object({
      name: z.string().trim().min(1, 'Name is required.'),
      email: z.email('Please enter a valid email address.'),
      subject: z.string().trim().min(1, 'Subject is required.'),
      message: z.string().trim().min(1, 'Message is required.'),
      'cf-turnstile-response': z.string().optional(),
    }),
    handler: async (input, context) => {
      const { name, email, subject, message, 'cf-turnstile-response': turnstileToken } =
        input;

      await requireHuman(context, turnstileToken, 'contact');

      const resendKey = readEnv('RESEND_API_KEY');
      if (!resendKey) {
        /* Loud on the server, generic to the sender: a missing key is an
           operator problem, and naming it back to a stranger tells them
           which credential to probe for. */
        console.error('[actions.contact] RESEND_API_KEY is not set — cannot send mail.');
        throw new ActionError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Our mail service is unavailable right now. Please try again later.',
        });
      }

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@beunconventionalhq.com', // must be a verified Resend sender
          to: 'press@beunconventionalhq.com',
          /* `reply_to`, not `from`: spoofing the sender's address in `from`
             fails SPF/DKIM for our domain and lands the mail in spam. */
          reply_to: email,
          subject: `New Contact Form Submission: ${subject}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
            <p><strong>Message:</strong></p>
            <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
          `,
        }),
      });

      if (!emailRes.ok) {
        console.error('[actions.contact] Resend API error:', await emailRes.text());
        throw new ActionError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send email. Please try again later.',
        });
      }

      return { success: true, message: 'Message sent successfully!' };
    },
  }),
};
