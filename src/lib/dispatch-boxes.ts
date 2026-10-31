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

export function createBoxRenderer(template: string) {
  const engine = new Liquid();
  let heading: Promise<string> | null = null;
  return {
    async boxes(post: KitPost): Promise<DispatchBoxes> {
      return {
        featuredHtml: await rendersAt(engine, template, post, 1),
        latestHtml: await rendersAt(engine, template, post, 3),
      };
    },
    /** The LATEST FROM THE HQ heading, as position 2 renders it in front of a box. */
    latestHeading(): Promise<string> {
      heading ??= (async () => {
        const second = await rendersAt(engine, template, PLACEHOLDER, 2);
        const box = await rendersAt(engine, template, PLACEHOLDER, 3);
        // The two share everything from the box onwards. Position 3 differs
        // only by the blank lines its skipped {% if %} leaves, which is
        // whitespace between tables and renders as nothing.
        let shared = 0;
        while (shared < box.length && second[second.length - 1 - shared] === box[box.length - 1 - shared]) shared++;
        if (box.slice(0, box.length - shared).trim()) {
          throw new Error('dispatch boxes: position 2 is no longer heading + box');
        }
        return second.slice(0, second.length - shared);
      })();
      return heading;
    },
  };
}
