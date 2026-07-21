import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Parse the incoming JSON body
    const body = await request.json();
    const { name, email, subject, message, 'cf-turnstile-response': turnstileToken } = body;

    const hasSessionCookie = cookies.has('hq_verified');

    // Basic field validation
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'All fields are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!hasSessionCookie && !turnstileToken) {
      return new Response(
        JSON.stringify({ error: 'Turnstile token required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Step 1: Validate Turnstile token (if no session cookie) ──────
    if (!hasSessionCookie) {
      const turnstileRes = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: import.meta.env.TURNSTILE_SECRET_KEY,
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

    // ── Step 2: Send the email via Resend ──────────────────────────
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@beunconventionalhq.com', // must be a verified sender in Resend
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
      return new Response(
        JSON.stringify({ error: 'Failed to send email. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Success ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ success: true, message: 'Message sent successfully!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Contact API error:', err);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
