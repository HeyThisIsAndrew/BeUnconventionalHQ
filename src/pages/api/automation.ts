import type { APIRoute } from 'astro';
// @ts-ignore
import { env } from 'cloudflare:workers';
import { handleAutomationRequest } from '../../lib/automation-gateway.ts';

export const prerender = false;
export const POST: APIRoute = ({ request }) => handleAutomationRequest(request, env as Record<string, string | undefined>);
