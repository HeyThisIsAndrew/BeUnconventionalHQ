/**
 * Pre-rendered THE HQ DISPATCH story boxes for /dispatch.json (issue #273).
 *
 * The Kit draft Worker (dispatch-kit-worker/, issue #272) must never build
 * email HTML itself. It concatenates boxes the site rendered at build time
 * from the ONE markup source, email/hq-dispatch/post-template.liquid.html,
 * with the same engine (liquidjs) that renders the committed mockup.
 *
 * ─── HOW ONE TEMPLATE BECOMES THREE PIECES ────────────────────────────────
 * The template is a loop: post 1 renders as FEATURED, post 2 opens the
 * LATEST FROM THE HQ heading and then its box, posts 3+ render a box alone.
 * A box's markup depends only on the post and on which of those three
 * positions it sits in. So each piece is rendered by putting the story at
 * that position behind placeholder posts and keeping only what it added:
 *
 *   featuredHtml   the story at position 1
 *   latestHtml     the story at position 3+ (a box, no heading)
 *   latestHeading  what position 2 adds in front of a box (story-independent)
 *
 * A digest is featuredHtml(A) + latestHeading + latestHtml(B) + latestHtml(C)
 * ... (joinBoxes() in dispatch-kit-worker/kit-draft.mjs, the one place that
 * joins them), and scripts/dispatch-feed.test.mjs proves that equals the template
 * rendering [A, B, C, ...] directly (whitespace between tags aside, which
 * renders as nothing), so the two can never drift.
 *
 * The same technique renders ALSO THIS WEEK lines (also-this-week.liquid.html)
 * and its heading. The issue line and the editor's note are rendered once
 * each around a placeholder the Worker fills with the issue's own words.
 *
 * Plain module (no JSON or ?raw imports): callers hand it the template text.
 */
import { Liquid } from 'liquidjs';

/** One post in the shape Kit's RSS Liquid exposes (see hq-dispatch-render.mjs). */
export interface KitPost {
  title: string;
  url: string;
  summary: string;
  content: string;
  categories: string[];
}

export interface DispatchBoxes {
  featuredHtml: string;
  latestHtml: string;
}

const PLACEHOLDER: KitPost = { title: 'x', url: 'https://example.invalid/', summary: 'x', content: '', categories: ['x'] };

/** Kit's own render: one leading and one trailing newline around the loop. */
async function loopBody(engine: Liquid, template: string, posts: KitPost[]): Promise<string> {
  const out = await engine.parseAndRender(template, { posts });
  return out.slice(1, -1);
}

/** What `post` adds when it sits at 1-based `position`. */
async function rendersAt(engine: Liquid, template: string, post: KitPost, position: number): Promise<string> {
  const before = Array.from({ length: position - 1 }, () => PLACEHOLDER);
  const prefix = await loopBody(engine, template, before);
  const whole = await loopBody(engine, template, [...before, post]);
  if (!whole.startsWith(prefix)) throw new Error('dispatch boxes: the post template is not a plain loop any more');
  return whole.slice(prefix.length);
}

/**
 * Placeholders the Kit draft Worker swaps for the issue's own text. The site
 * renders the markup; the Worker only ever drops escaped words into it.
 */
export const ISSUE_MARKER_TOKEN = '%%HQ_ISSUE_MARKER%%';
export const EDITOR_NOTE_TOKEN = '%%HQ_EDITOR_NOTE%%';

/** The heading a loop template's first item opens: position 1 minus the row it then renders. */
async function headingOf(engine: Liquid, template: string, firstRowPosition: number): Promise<string> {
  const first = await rendersAt(engine, template, PLACEHOLDER, firstRowPosition);
  const row = await rendersAt(engine, template, PLACEHOLDER, firstRowPosition + 1);
  // The two share everything from the row onwards. The later position differs
  // only by the blank lines its skipped {% if %} leaves, which is
  // whitespace between tables and renders as nothing.
  let shared = 0;
  while (shared < row.length && first[first.length - 1 - shared] === row[row.length - 1 - shared]) shared++;
  if (row.slice(0, row.length - shared).trim()) {
    throw new Error('dispatch boxes: a heading is no longer "heading + row"');
  }
  return first.slice(0, first.length - shared);
}

export interface DispatchTemplates {
  /** email/hq-dispatch/post-template.liquid.html */
  post: string;
  /** email/hq-dispatch/also-this-week.liquid.html */
  also?: string;
  /** email/hq-dispatch/issue-marker.liquid.html */
  issueMarker?: string;
  /** email/hq-dispatch/editor-note.liquid.html */
  editorNote?: string;
}

export function createBoxRenderer(templates: string | DispatchTemplates) {
  const t: DispatchTemplates = typeof templates === 'string' ? { post: templates } : templates;
  const engine = new Liquid();
  let heading: Promise<string> | null = null;
  let alsoHeading: Promise<string> | null = null;
  const render = async (source: string | undefined, vars: object) =>
    source ? (await engine.parseAndRender(source, vars)).trim() : '';
  return {
    async boxes(post: KitPost): Promise<DispatchBoxes & { alsoHtml?: string }> {
      return {
        featuredHtml: await rendersAt(engine, t.post, post, 1),
        latestHtml: await rendersAt(engine, t.post, post, 3),
        ...(t.also ? { alsoHtml: await rendersAt(engine, t.also, post, 2) } : {}),
      };
    },
    /** The LATEST FROM THE HQ heading, as position 2 renders it in front of a box. */
    latestHeading(): Promise<string> {
      heading ??= headingOf(engine, t.post, 2);
      return heading;
    },
    /** The ALSO THIS WEEK heading, as the first line renders it. */
    alsoHeading(): Promise<string> {
      alsoHeading ??= t.also ? headingOf(engine, t.also, 1) : Promise.resolve('');
      return alsoHeading;
    },
    /** The issue line and the editor's note, each holding its placeholder. */
    async issuePieces(): Promise<{ issueMarkerHtml: string; editorNoteHtml: string }> {
      return {
        issueMarkerHtml: await render(t.issueMarker, { issue_marker: ISSUE_MARKER_TOKEN }),
        editorNoteHtml: await render(t.editorNote, { editor_note: EDITOR_NOTE_TOKEN }),
      };
    },
  };
}
