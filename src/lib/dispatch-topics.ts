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
 * THE slot rule (owner's question, 2026-11-01: "what if I pick three?").
 *   1. Fair share first: each chosen topic gets floor(slots / topics) picks,
 *      taken in turns. One topic: 4. Two: 2 and 2. Four: 1 each.
 *   2. Whatever is left (the fourth slot with three topics, or the share of
 *      a topic with too few stories this week) goes to the NEWEST unused
 *      story among the chosen topics. So Film, TV and Games gives one of
 *      each plus whichever of them published most recently, and that
 *      changes week to week. It used to go to Film every time, because the
 *      turns ran in a fixed order.
 * `byTopic` holds each topic's candidates, newest first. An item without a
 * pubDate (the upcoming-event card) never wins a leftover slot.
 */
export function fillSlots<T extends { pubDate?: string }>(byTopic: Partial<Record<Topic, readonly T[]>>, topics: readonly Topic[], slots = TOPIC_SLOTS): T[] {
  const chosen = TOPICS.filter((t) => topics.includes(t) && (byTopic[t]?.length ?? 0) > 0);
  if (chosen.length === 0) return [];
  const used: Record<string, number> = Object.fromEntries(chosen.map((t) => [t, 0]));
  const picked: T[] = [];
  const next = (topic: Topic): T | undefined => byTopic[topic]?.[used[topic]];
  const share = Math.floor(slots / chosen.length);
  for (let round = 0; round < share; round++) {
    for (const topic of chosen) {
      if (next(topic) === undefined || picked.length >= slots) continue;
      picked.push(next(topic)!);
      used[topic]++;
    }
  }
  while (picked.length < slots) {
    let best: Topic | null = null;
    for (const topic of chosen) {
      if (next(topic) === undefined) continue;
      const time = Date.parse(next(topic)!.pubDate ?? '');
      const bestTime = best === null ? NaN : Date.parse(next(best)!.pubDate ?? '');
      // Newer wins; a dated story beats an undated card; ties keep topic order.
      if (best === null || (Number.isFinite(time) && (Number.isNaN(bestTime) || time > bestTime))) best = topic;
    }
    if (best === null) break;
    picked.push(next(best)!);
    used[best]++;
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
