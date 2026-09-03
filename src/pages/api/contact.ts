export const prerender = false;

import type { APIRoute } from 'astro';
import { actions } from 'astro:actions';

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    
    let result;
    if (typeof context.callAction === 'function') {
      result = await context.callAction(actions.contact, body);
    } else if (actions.contact.safe) {
      result = await actions.contact.safe(body);
    } else {
      result = await actions.contact(body);
    }

    const { data, error } = result || result;
    
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Contact API error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'An unexpected error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
