/**
 * THE HQ DISPATCH by topic: one FEATURED story for everyone, then four slots
 * filled from the reader's topics (Film, TV, Games, Events).
 *
 *   - A reader who chose nothing (or everything) gets one story per topic.
 *   - A reader who chose fewer topics gets the four slots filled from those
 *     alone, in turns: Film and TV gives Film, TV, Film, TV.
 *   - A topic that runs out hands its turn to the next one, so the four
 *     slots stay full while any chosen topic has stories.
 *   - Events with no story this week fall back to the NEXT UPCOMING EVENT
 *     from the events calendar, as a card linking to its page on the site.
 *
 * The slot rule lives here, once (fillSlots), and the Kit Worker either runs
 * it (one issue for everyone) or writes it out as Kit Liquid so Kit runs it
 * per reader (dispatch-kit-worker/kit-draft.mjs, PERSONALIZE).
 *
 * Plain module: no JSON imports, so scripts and tests run it under node.
 */
import { createImageUrlBuilder } from '@sanity/image-url';
import { SANITY_PROJECT } from './sanity-project.ts';
import { formatEventDateRange, formatLocation, getEventStatus } from './events.ts';

export const TOPICS = ['film', 'tv', 'games', 'events'] as const;
export type Topic = (typeof TOPICS)[number];
export const TOPIC_LABELS: Record<Topic, string> = { film: 'Film', tv: 'TV', games: 'Games', events: 'Events' };

/** Slots under FEATURED. */
export const TOPIC_SLOTS = 4;

/**
 * A story's topic is its SECTION, the second category the feed carries
 * ("Review", "TV" is TV). A story with no section has no topic: it can be
 * FEATURED but never fills a topic slot.
 */
export function topicOf(categories: readonly string[] | undefined): Topic | null {
  const section = String(categories?.[1] ?? '').trim().toLowerCase();
  return (TOPICS as readonly string[]).includes(section) ? (section as Topic) : null;
}

/**
 * A reader's topics from whatever was stored ("film,tv", ["TV"], "" ...).
 * Unknown words are dropped. Nothing (or nothing valid) means ALL topics:
 * a reader who never chose gets the whole newsletter.
 */
export function parseTopics(value: unknown): Topic[] {
  const words = Array.isArray(value) ? value : String(value ?? '').split(/[\s,]+/);
  const picked = TOPICS.filter((t) => words.some((w) => String(w).trim().toLowerCase() === t));
  return picked.length ? picked : [...TOPICS];
}

/** The stored form: canonical order, comma-separated ("film,tv"). */
export const formatTopics = (topics: readonly Topic[]) => TOPICS.filter((t) => topics.includes(t)).join(',');

/**
 * THE slot rule. `byTopic` holds each topic's candidates, best first. Takes
 * turns across `topics` until `slots` are filled or every chosen topic is
 * empty. Returns what was picked, in order.
 */
export function fillSlots<T>(byTopic: Partial<Record<Topic, readonly T[]>>, topics: readonly Topic[], slots = TOPIC_SLOTS): T[] {
  const picked: T[] = [];
  for (let round = 0; picked.length < slots; round++) {
    let any = false;
    for (const topic of TOPICS) {
      if (!topics.includes(topic)) continue;
      const item = byTopic[topic]?.[round];
      if (item === undefined) continue;
      any = true;
      if (picked.length < slots) picked.push(item);
    }
    if (!any) break;
  }
  return picked;
}

// ─── the next upcoming event ──────────────────────────────────────────────

interface EventDoc {
  _type?: string;
  title?: string;
  slug?: { current?: string };
  startDate?: string;
  endDate?: string;
  status?: string;
  location?: unknown;
  heroImage?: unknown;
  hidden?: boolean;
  isRecurringTemplate?: boolean;
}

/**
 * The soonest event still ahead (same status rules as the events pages,
 * calendar dates compared as strings, hard rule 1). Templates, hidden and
 * cancelled events never qualify. Null when the calendar has nothing ahead.
 */
export function selectUpcomingEvent(docs: readonly EventDoc[], now: Date = new Date()): EventDoc | null {
  const ahead = docs.filter((d) =>
    d?._type === 'event' && d.isRecurringTemplate !== true && d.hidden !== true &&
    d.title && d.slug?.current && typeof d.startDate === 'string' &&
    getEventStatus(d as any, now) === 'upcoming');
  ahead.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.title).localeCompare(String(b.title)));
  return ahead[0] ?? null;
}

const builder = createImageUrlBuilder(SANITY_PROJECT);

/** The event's key art, as the source URL the dispatch image sync composes from. */
export function eventImageSource(event: EventDoc): string | null {
  const ref = typeof event.heroImage === 'string' ? event.heroImage : (event.heroImage as any)?.asset?._ref;
  if (!ref) return null;
  return builder.image({ asset: { _ref: ref } }).width(1600).url();
}

/**
 * The line under an upcoming event's headline, from the calendar's own facts:
 * "Nov 13 – 15, 2026 | San Diego Convention Center, San Diego, CA". Nothing
 * is written that the event document does not say.
 */
export function eventFactsLine(event: EventDoc): string {
  const when = formatEventDateRange(event.startDate, event.endDate);
  const where = formatLocation(event.location as any, { includeVenue: true });
  return [when, where].filter(Boolean).join(' | ');
}
