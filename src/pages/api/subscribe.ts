export const prerender = false;

import type { APIRoute } from 'astro';
import { actions } from 'astro:actions';

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    
    // In Astro 5+, we can call actions on the server directly using safe() or just call it.
    // Astro 4 uses Astro.callAction, Astro 5/6/7 use Astro.callAction or actions.subscribe.safe(body)
    let result;
    if (typeof context.callAction === 'function') {
      result = await context.callAction(actions.subscribe, body);
    } else if (actions.subscribe.safe) {
      result = await actions.subscribe.safe(body);
    } else {
      result = await actions.subscribe(body);
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
    console.error('Subscribe API error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'An unexpected error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
