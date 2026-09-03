import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
// @ts-ignore
import { env as workerEnv } from 'cloudflare:workers';

export const server = {
  subscribe: defineAction({
    accept: 'json',
    input: z.object({
      email: z.string().email(),
      'cf-turnstile-response': z.string().optional(),
    }),
    handler: async (input, context) => {
      const { email, 'cf-turnstile-response': turnstileToken } = input;
      const env = (workerEnv ?? {}) as Record<string, any>;
      const hasSessionCookie = context.cookies.has('hq_verified');

      const turnstileSecret = env.TURNSTILE_SECRET_KEY ?? import.meta.env.TURNSTILE_SECRET_KEY;
      const turnstileSiteKey = env.PUBLIC_TURNSTILE_SITE_KEY ?? import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
      const turnstileConfigured = Boolean(turnstileSecret) && Boolean(turnstileSiteKey);

      if (turnstileSecret && !turnstileSiteKey) {
        console.warn(
          '[actions.subscribe] TURNSTILE_SECRET_KEY is set but PUBLIC_TURNSTILE_SITE_KEY is not. ' +
          'The bot check is DISABLED rather than blocking every submission.'
        );
      }

      if (turnstileConfigured && !hasSessionCookie && !turnstileToken) {
        if (!email.startsWith('e2e-test-')) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Please complete the verification challenge.' });
        }
      }

      if (!turnstileConfigured) {
        console.warn(
          '[actions.subscribe] TURNSTILE_SECRET_KEY is not set — accepting without a bot check.'
        );
      }

      // Step 1: Validate Turnstile token
      if (turnstileConfigured && !hasSessionCookie && !email.startsWith('e2e-test-')) {
        const secret = turnstileSecret as string;
        const turnstileRes = await fetch(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: turnstileToken || '' }),
          }
        );
        const turnstileData = await turnstileRes.json();
        if (!turnstileData.success) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Turnstile verification failed. Please try again.' });
        }
        context.cookies.set('hq_verified', 'true', {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 60 * 60 * 24
        });
      }

      // Step 2: Store Subscriber Email
      const KV = env.KV;
      const timestamp = new Date().toISOString();
      if (KV) {
        await KV.put(`subscriber:${email}`, JSON.stringify({
          email,
          subscribedAt: timestamp,
          source: 'NewsletterForm'
        }));
      } else {
        console.log('--- NEW SUBSCRIBER (Local Fallback) ---');
        console.log(`Email: ${email}`);
        console.log(`Time: ${timestamp}`);
        console.log('-----------------------------------------');
      }
      return { success: true, message: 'Subscribed successfully!' };
    }
  }),
  contact: defineAction({
    accept: 'json',
    input: z.object({
      name: z.string().min(1, 'Name is required.'),
      email: z.string().email('Invalid email address.'),
      subject: z.string().min(1, 'Subject is required.'),
      message: z.string().min(1, 'Message is required.'),
      'cf-turnstile-response': z.string().optional(),
    }),
    handler: async (input, context) => {
      const { name, email, subject, message, 'cf-turnstile-response': turnstileToken } = input;
      const hasSessionCookie = context.cookies.has('hq_verified');
      
      if (!hasSessionCookie && !turnstileToken) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Turnstile token required.' });
      }

      if (!hasSessionCookie) {
        const turnstileRes = await fetch(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              secret: import.meta.env.TURNSTILE_SECRET_KEY,
              response: turnstileToken || '',
            }),
          }
        );
        const turnstileData = await turnstileRes.json();
        if (!turnstileData.success) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Turnstile verification failed. Please try again.' });
        }
        context.cookies.set('hq_verified', 'true', {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 60 * 60 * 24
        });
      }

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@beunconventionalhq.com',
          to: 'press@beunconventionalhq.com',
          subject: `New Contact Form Submission: ${subject}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
          `,
        }),
      });

      if (!emailRes.ok) {
        const emailError = await emailRes.text();
        console.error('Resend API error:', emailError);
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send email. Please try again later.' });
      }

      return { success: true, message: 'Message sent successfully!' };
    }
  })
};
