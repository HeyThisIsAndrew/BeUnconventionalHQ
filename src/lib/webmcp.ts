/**
 * WebMCP — expose a few site actions as tools a visiting AI agent can call.
 *
 * ─── WHAT THIS IS ─────────────────────────────────────────────────────────
 * WebMCP lets a page hand the browser a set of callable tools. An agent
 * operating inside the browser (on the reader's behalf) can then invoke them
 * directly instead of scraping the DOM or guessing at our URLs. It is the
 * in-page half of the agent-discovery work in #192; the `.well-known` files
 * are the out-of-band half, and the two are unrelated at runtime.
 *
 * ─── THE API IS NOT WHAT #192 SAYS ────────────────────────────────────────
 * The ticket asks for `navigator.modelContext.provideContext()`. Both halves
 * of that have since changed, so this file deliberately does not match it:
 *
 *   • `provideContext()` was REMOVED from the spec on 2026-03-05. Tools are
 *     registered one at a time with `registerTool()`.
 *   • `unregisterTool()` was removed in April 2026 in favour of passing an
 *     AbortSignal to `registerTool(tool, { signal })`.
 *   • The object hangs off `document`, not `navigator`.
 *
 * Verified against `@mcp-b/webmcp-types@5.1.0` (published 2026-08-31), which
 * is the reference type package for the API, rather than from a blog post.
 * The types are duplicated below rather than depended on: the package pulls
 * in `@modelcontextprotocol/server`, which is a real dependency to carry for
 * an API that today ships only in Chrome behind a flag. This mirrors how
 * NewsletterForm hand-writes the bit of the Turnstile API it uses.
 *
 * ─── COST WHEN NOBODY IS LOOKING ──────────────────────────────────────────
 * Nearly every visitor is a human on a browser with no `document.modelContext`
 * at all, so this must be free for them. It is: the feature check is the first
 * thing that runs, the tool bodies are closures that never execute, and NOTHING
 * is fetched until an agent actually calls a tool. The search index and Fuse
 * are both pulled in on first use, exactly as CommandPalette does it.
 *
 * ─── READ ONLY, ON PURPOSE ────────────────────────────────────────────────
 * All three tools are reads, and every one is annotated `readOnlyHint`. The
 * obvious fourth candidate is newsletter signup, and it is deliberately absent:
 * see the note above `TOOLS` for why an agent should not be able to submit
 * somebody's email address in one call.
 */
import { getEventStatus } from './events.ts';

/* ─── The slice of the WebMCP surface this file uses ─────────────────────── */

interface WebMcpAnnotations {
  /** The tool does not modify anything. True for all three below. */
  readOnlyHint?: boolean;
  /**
   * The tool returns text this site did not author, so an agent must treat it
   * as data rather than instructions. True here because titles and tags come
   * from YouTube and Substack, which anyone with a keyboard can write into.
   */
  untrustedContentHint?: boolean;
}

interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: WebMcpAnnotations;
  execute: (input: any) => Promise<unknown> | unknown;
}

interface ModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

/* ─── The site's own data, fetched at most once ──────────────────────────── */

/** One row of `/api/search-index.json`. Mirrors `SearchEntry` in that route. */
export interface SearchEntry {
  id: string;
  title: string;
  type: 'video' | 'article' | 'event' | 'hub' | 'page';
  url: string;
  image?: string | null;
  /** Start date for an event; publish date for a video or article. */
  date?: string | null;
  /** Events only. A multi-day event is not over on its first morning. */
  endDate?: string | null;
  /**
   * Events only. The editorial override ('cancelled' / 'postponed') that
   * `getEventStatus` honours ahead of the calendar. Without it a cancelled
   * event whose date is still ahead reads as `upcoming`, and this tool would
   * send a reader to something that is not happening.
   */
  status?: 'scheduled' | 'cancelled' | 'postponed';
  tags?: string[];
  hubCategory?: string;
}

const SEARCH_INDEX_URL = '/api/search-index.json';
const LIVE_STATUS_URL = '/api/live-status.json';

let indexPromise: Promise<SearchEntry[]> | null = null;

/**
 * The search index, fetched on first use and reused after.
 *
 * A failed fetch nulls the promise so a later call retries rather than
 * caching the failure for the life of the page.
 */
function loadIndex(): Promise<SearchEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`search index responded ${res.status}`);
        return res.json();
      })
      .then((data) => (Array.isArray(data) ? (data as SearchEntry[]) : []))
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

/** An absolute URL, so an agent can follow a result without guessing the host. */
function absolute(url: string): string {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

/** Clamp an agent-supplied limit into something sane. Exported for the test. */
export function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Events that have not finished, soonest first.
 *
 * Exported and pure so `scripts/webmcp-tools.test.mjs` can pin it against
 * fixed dates. The live content store usually holds no upcoming events at all
 * (both entries today are months past), so an end-to-end assertion on it
 * passes against an empty array and proves nothing.
 *
 * Status comes from src/lib/events.ts, never from `new Date(startDate)`.
 * Parsing "YYYY-MM-DD" as a Date reads it as UTC midnight, which is the
 * previous day anywhere west of Greenwich, so an event would drop off this
 * list a day early for the audience it is aimed at. Hard rule 1 in CLAUDE.md.
 */
export function selectUpcomingEvents(
  entries: SearchEntry[],
  now: Date = new Date(),
  limit = 10,
) {
  return entries
    .filter((e) => e.type === 'event' && typeof e.date === 'string')
    .map((e) => ({
      entry: e,
      status: getEventStatus(
        { startDate: e.date, endDate: e.endDate ?? undefined, status: e.status },
        now,
      ),
    }))
    .filter(({ status }) => status !== 'completed' && status !== 'cancelled')
    .sort((a, b) => String(a.entry.date).localeCompare(String(b.entry.date)))
    .slice(0, limit)
    .map(({ entry, status }) => ({
      title: entry.title,
      status,
      startDate: entry.date,
      endDate: entry.endDate ?? undefined,
      url: entry.url,
    }));
}

/**
 * MCP's result envelope: a list of content blocks. JSON inside a text block is
 * the shape agents handle most reliably, and it keeps the payload legible in a
 * transcript.
 */
function textResult(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/* ─── The tools ─────────────────────────────────────────────────────────── */

/*
  WHY THERE IS NO `subscribe_to_newsletter` TOOL.

  It is the obvious fourth tool and it is left out on purpose. Subscribing
  writes a stranger's email address into our KV store, which is a consequential
  action taken on a third party, and it is not something to do on one tool call
  with no human in the loop. The failure mode is not an agent misreading a
  result, it is a real person receiving mail they never asked for, from us.

  There is a mechanical problem too, and it points the same way: the action is
  Turnstile-gated (src/actions/index.ts), and an agent invoking a tool has no
  challenge token. Making that work would mean driving the invisible widget
  from a tool handler, which is a bot check being satisfied by a bot.

  The right shape is the agent pointing its user at the form, which the search
  tool already supports: /links and the CTA panel are both in the index. If
  this is ever reconsidered, it needs a confirmation step, not just a schema.
*/
const TOOLS: WebMcpTool[] = [
  {
    name: 'search_beunconventionalhq',
    title: 'Search Be Unconventional HQ',
    description:
      'Search everything published on Be Unconventional HQ: videos, articles, ' +
      'events and brand hubs. Returns titles with absolute URLs. Use this to ' +
      'answer questions about what the site covers, or to find the page for a ' +
      'specific topic, show, film, game or event.',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for. Free text, matched fuzzily against titles and tags.',
        },
        type: {
          type: 'string',
          enum: ['video', 'article', 'event', 'hub', 'page'],
          description: 'Optional. Restrict results to one kind of content.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum results to return. Defaults to 10, capped at 50.',
        },
      },
      required: ['query'],
    },
    async execute(input: { query?: string; type?: string; limit?: number }) {
      const query = typeof input?.query === 'string' ? input.query.trim() : '';
      if (!query) return textResult({ error: 'A non-empty `query` is required.', results: [] });

      const entries = await loadIndex();
      const pool = input?.type ? entries.filter((e) => e.type === input.type) : entries;

      /*
        The same Fuse configuration the command palette uses, loaded the same
        lazy way. An agent and a reader typing the same words should get the
        same ranking; two relevance implementations would drift apart.
      */
      const { default: Fuse } = await import('fuse.js');
      const fuse = new Fuse(pool, {
        keys: [
          { name: 'title', weight: 2 },
          { name: 'tags', weight: 1 },
          { name: 'type', weight: 0.5 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      });

      const results = fuse
        .search(query)
        .slice(0, clampLimit(input?.limit, 10, 50))
        .map(({ item }) => ({
          title: item.title,
          type: item.type,
          url: absolute(item.url),
          date: item.date ?? undefined,
          tags: item.tags?.length ? item.tags : undefined,
        }));

      return textResult({ query, count: results.length, results });
    },
  },

  {
    name: 'get_upcoming_events',
    title: 'Upcoming events',
    description:
      'List the events Be Unconventional HQ is covering that have not finished ' +
      'yet, soonest first, with their dates and status. Use this for questions ' +
      'about where the channel will be, or what is coming up.',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum events to return. Defaults to 10, capped at 50.',
        },
      },
    },
    async execute(input: { limit?: number }) {
      const entries = await loadIndex();
      const events = selectUpcomingEvents(
        entries,
        new Date(),
        clampLimit(input?.limit, 10, 50),
      ).map((e) => ({ ...e, url: absolute(e.url) }));

      return textResult({ count: events.length, events });
    },
  },

  {
    name: 'get_live_status',
    title: 'Live right now?',
    description:
      'Check whether Be Unconventional HQ is streaming live at this moment, and ' +
      'on which platform. This is the only tool here whose answer changes minute ' +
      'to minute, so prefer it over anything cached when the question is about now.',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      /*
        This endpoint is quota-gated: YouTube's search.list costs 100 units of a
        10,000/day budget, and the CDN cache in front of it is what keeps the
        origin under roughly 96 calls a day. Agent traffic lands on that same
        cache, so it cannot spend the quota faster than readers can. Do not add
        a cache-buster here.
      */
      try {
        const res = await fetch(LIVE_STATUS_URL);
        if (!res.ok) throw new Error(`live status responded ${res.status}`);
        const data = await res.json();
        return textResult({
          isLive: Boolean(data?.isLive),
          streams: Array.isArray(data?.streams)
            ? data.streams.map((s: any) => ({ platform: s?.platform, title: s?.title, url: s?.url }))
            : [],
        });
      } catch (error) {
        /* Dormant is the honest answer when we cannot tell, and it matches what
           the on-page billboard shows in the same situation. */
        return textResult({
          isLive: false,
          streams: [],
          note: 'Live status is unavailable right now.',
        });
      }
    },
  },
];

/**
 * Register the tools, once per document.
 *
 * ClientRouter swaps the body on navigation but the document — and therefore
 * `document.modelContext` — survives, so unlike the Turnstile widgets these
 * must NOT be re-registered on `astro:page-load`. Doing so would either throw
 * on the duplicate name or leave an agent looking at three copies of each tool.
 */
export function initWebMcp(): void {
  if (typeof document === 'undefined') return;

  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return;

  const w = window as any;
  if (w.__hqWebMcpRegistered) return;
  w.__hqWebMcpRegistered = true;

  for (const tool of TOOLS) {
    /* Registration is per tool and can reject on its own (a duplicate name, a
       schema the browser rejects). One bad tool must not take the others with
       it, so each is caught separately.

       The warning is a dev-time aid only: the build drops every `console.*`
       call, so this is silent in production. Catching still matters there —
       it is what stops one rejected registration becoming an unhandled
       rejection and taking the other two tools with it. */
    Promise.resolve(modelContext.registerTool(tool)).catch((error) => {
      console.warn(`[webmcp] could not register "${tool.name}":`, error);
    });
  }
}
