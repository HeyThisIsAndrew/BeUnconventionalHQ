/**
 * THE HQ DISPATCH: local renderer for the Kit email template (issue #266).
 *
 * Kit renders email/hq-dispatch/post-template.liquid.html into the
 * message_content slot of email/hq-dispatch/template.html. This does the
 * same thing offline with liquidjs, so the Liquid is exercised by a real
 * engine before it ever reaches Kit, and so the committed mockup is PRODUCED
 * from the two files rather than hand-copied from them (a hand copy is how a
 * mockup and the thing it demonstrates drift apart).
 *
 *   node scripts/hq-dispatch-render.mjs   rewrites email/hq-dispatch/mockup.html
 *
 * The fixture posts are FROZEN here on purpose, in the shape the feed
 * contract in scripts/hq-dispatch.md asks Astro for (image first in
 * content:encoded, content type then section as categories). They are not
 * read from src/data/articles.json, or every article sync would change the
 * mockup and fail scripts/hq-dispatch-email.test.mjs for no reason.
 *
 * Only the two links Kit itself fills (unsubscribe, preferences) are
 * stubbed; message_content is the real rendered post template.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Liquid } from 'liquidjs';
import { DISPATCH_HEADER_IMAGE, NEWSLETTER_LEDE_MAX, wholeSentences } from '../src/lib/dispatch-feed.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DISPATCH_DIR = path.join(ROOT, 'email/hq-dispatch');
export const TEMPLATE_PATH = path.join(DISPATCH_DIR, 'template.html');
export const POST_TEMPLATE_PATH = path.join(DISPATCH_DIR, 'post-template.liquid.html');
export const MOCKUP_PATH = path.join(DISPATCH_DIR, 'mockup.html');

const SITE = 'https://beunconventionalhq.com';

/**
 * One feed item, shaped the way Kit exposes it to the Post Template. Passing
 * `newsletter` gives it the separate fields the site's /dispatch.json adds
 * (subtitle, lede, blurb; see dispatchKitPost() and newsletterCopy() in
 * src/lib/dispatch-feed.ts). An empty blurb is a story whose one-line summary
 * has not been written: the box renders without it.
 */
export function feedPost({ title, url, summary, image, categories, newsletter }) {
  return {
    title,
    url,
    summary,
    // The contract: the 1200x675 lead image is the FIRST element of
    // content:encoded, because Kit has no image variable of its own.
    content: image
      ? `<img src="${image}" width="1200" height="675" alt=""><p>${summary}</p>`
      : `<p>${summary}</p>`,
    categories,
    ...(newsletter ? { newsletter: true, subtitle: '', lede: '', blurb: '', ...newsletter } : {}),
  };
}

/*
  The fixtures use the COMPOSED images the real feed serves (whole picture,
  16:9, see scripts/dispatch-image.mjs), by path relative to the mockup so it
  opens straight from disk. scripts/sync-dispatch-images.mjs never prunes, so
  these files stay. The test checks they exist and are 1200x675.
*/
export const FIXTURE_IMAGE_DIR = '../../public/dispatch/images';
const composed = (file) => `${FIXTURE_IMAGE_DIR}/${file}`;

export const FIXTURE_POSTS = [
  feedPost({
    title: 'Lanterns | The Grounded Blueprint for James Gunn’s DCU',
    url: `${SITE}/intel/lanterns-the-grounded-blueprint-for`,
    summary:
      'Halfway through its first season, this detective-driven series proves that restrained power scaling and character-focused storytelling are exactly what the new cinematic universe needs.',
    image: composed('cb581c5717543027.jpg'),
    categories: ['Review', 'TV'],
    newsletter: {
      subtitle:
        'Halfway through its first season, this detective-driven series proves that restrained power scaling and character-focused storytelling are exactly what the new cinematic universe needs.',
      // The article's opening paragraph, whole sentences only.
      lede: wholeSentences(
        'I can’t believe we’re already at the halfway point of Lanterns. The season kicked off with a bang and has somehow gotten better every week. This series has done an incredible job of introducing us to the Green Lantern mythos. And, it fits perfectly into James Gunn’s new DCU while maintaining its own distinct identity.',
        NEWSLETTER_LEDE_MAX,
      ),
    },
  }),
  feedPost({
    title: 'Coyote vs. Acme Review | Why Warner Bros. Made a $70 Million Mistake',
    url: 'https://www.youtube.com/watch?v=geyEkOlupA0',
    summary:
      'Ketchup Entertainment stepped in to purchase the distribution rights, completely saving it from the void. Now that we finally get to see it, the biggest question is whether it lands.',
    image: composed('b2aef0f4552a8184.jpg'),
    categories: ['Video', 'Film'],
    // A video with no one-line summary written yet: the box has no blurb.
    newsletter: {},
  }),
  feedPost({
    title: "How Resident Evil Makes Being in the Theater Feel Like You're Actually Holding a Controller",
    url: `${SITE}/intel/how-resident-evil-makes-being-in`,
    summary:
      "The internet's already convinced this movie will fail, but Zach Cregger just built the one adaptation that actually respects the franchise.",
    image: composed('4cc10652cc02260e.jpg'),
    categories: ['Review', 'Film'],
    newsletter: { blurb: "The internet's already convinced this movie will fail, but Zach Cregger just built the one adaptation that actually respects the franchise." },
  }),
  feedPost({
    title: 'A Generational Leap: Did Rockstar and Netflix Just Set a New Industry Standard?',
    url: `${SITE}/intel/a-generational-leap-did-rockstar`,
    summary:
      'By leveraging Netflix to broadcast their first true look at Vice City, Rockstar engineered a massive cultural moment for interactive entertainment.',
    image: composed('641eefafeff17b02.jpg'),
    categories: ['Analysis', 'Games'],
    newsletter: { blurb: 'By leveraging Netflix to broadcast their first true look at Vice City, Rockstar engineered a massive cultural moment for interactive entertainment.' },
  }),
  feedPost({
    title: 'L.A. Comic Con 2026',
    url: `${SITE}/intel/la-comic-con-2026`,
    summary: 'Why Downtown Los Angeles Holds the Blueprint for Convention Culture',
    image: composed('b44f0f578562fe39.jpg'),
    categories: ['Analysis', 'Events'],
    newsletter: { blurb: 'Why Downtown Los Angeles Holds the Blueprint for Convention Culture' },
  }),
];

const engine = new Liquid();

/** Render the Kit Post Template for a list of posts (what Kit puts in message_content). */
export async function renderPosts(posts) {
  const tpl = fs.readFileSync(POST_TEMPLATE_PATH, 'utf8');
  return engine.parseAndRender(tpl, { posts });
}

/** Render a whole email: the shell with the post template dropped in. */
export async function renderEmail(posts) {
  const shell = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const body = await renderPosts(posts);
  // Kit fills the two links itself. The mockup stubs them so it opens anywhere.
  return shell
    .replace('{{ message_content }}', () => body)
    .replace('{{ unsubscribe_url }}', '#unsubscribe')
    .replace('{{ subscriber.email_address | url_encode }}', 'reader%40example.com')
    .replace('{{ subscriber_preferences_url }}', '#preferences');
}

export async function renderMockup() {
  const html = await renderEmail(FIXTURE_POSTS);
  return html
    /* The live header URL only answers once the site is deployed; the mockup
       reads the same committed file from disk. */
    .replace(`https://beunconventionalhq.com${DISPATCH_HEADER_IMAGE}`, `../../public${DISPATCH_HEADER_IMAGE}`)
    .replace(
    '<title>THE HQ DISPATCH</title>',
    '<title>THE HQ DISPATCH (mockup)</title>\n<!-- GENERATED by scripts/hq-dispatch-render.mjs from template.html and post-template.liquid.html. Do not edit by hand, and do not paste this into Kit: paste template.html. -->',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.writeFileSync(MOCKUP_PATH, await renderMockup());
  console.log(`wrote ${path.relative(ROOT, MOCKUP_PATH)}`);
}
