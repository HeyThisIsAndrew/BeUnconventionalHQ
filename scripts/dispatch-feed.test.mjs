/**
 * /dispatch.xml, the newsletter feed Kit reads (issue #266), and the images
 * it points at. Offline: no network, no build.
 *
 * ─── WHAT THIS IS GUARDING ──────────────────────────────────────────────────
 *   1. NO IMAGE IS EVER CUT OFF (the owner's rule). The composer is handed a
 *      wide picture with a one-colour frame round its very edge, and every
 *      side of that frame has to survive into the 16:9 output.
 *   2. THE FEATURED BOX ALWAYS OPENS ON AN IMAGE. A story with no built art
 *      gets the branded fallback, never no image and never the raw original
 *      (which could be any shape, and the email's box would crop it).
 *   3. The item shape Kit's Post Template depends on: the image FIRST in
 *      content:encoded (Kit has no image variable), categories as
 *      [type, section], Video for a video, absolute slash-free links.
 *   4. The selection: articles and long-form videos together, newest first,
 *      capped, shorts and live streams out.
 *   5. The committed manifest only lists 1200x675 files that exist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import {
  selectDispatchEntries,
  isDispatchVideoDoc,
  dispatchImageUrl,
  dispatchContentHtml,
  dispatchJsonItem,
  dispatchKitPost,
  newsletterCopy,
  wholeSentences,
  articleEntry,
  videoEntry,
  DISPATCH_FEED_LIMIT,
  DISPATCH_FALLBACK_IMAGE,
} from '../src/lib/dispatch-feed.ts';
import { composeDispatchImage, WIDTH, HEIGHT } from './dispatch-image.mjs';
import { createBoxRenderer } from '../src/lib/dispatch-boxes.ts';
import { joinBoxes } from '../dispatch-kit-worker/kit-draft.mjs';
import { renderPosts, FIXTURE_POSTS, POST_TEMPLATE_PATH, DISPATCH_DIR } from './hq-dispatch-render.mjs';
import { Liquid } from 'liquidjs';

const SITE = 'https://beunconventionalhq.com/';
const article = (over = {}) => ({
  slug: 'a-story',
  title: 'A Story',
  isoDate: '2026-09-10T12:00:00.000Z',
  excerpt: 'The standfirst.',
  image: 'https://example.com/a.jpg',
  category: 'TV',
  contentType: 'Review',
  ...over,
});
const video = (over = {}) => ({
  title: 'A Video',
  link: 'https://www.youtube.com/watch?v=abcdefghijk',
  youtubeId: 'abcdefghijk',
  publishedAt: '2026-09-12T12:00:00.000Z',
  description: 'What it covers.',
  thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',
  category: 'Film',
  ...over,
});

test('an article: absolute slash-free link, [type, section], its own summary', () => {
  const e = articleEntry(article(), SITE);
  assert.equal(e.link, 'https://beunconventionalhq.com/intel/a-story');
  assert.deepEqual(e.categories, ['Review', 'TV']);
  assert.equal(e.summary, 'The standfirst.');
  // No type falls back to Story; a "General" section says nothing, so it goes.
  assert.deepEqual(articleEntry(article({ contentType: '', category: 'General' }), SITE).categories, ['Story']);
});

test('a video: Video first (the Watch now button), then its section', () => {
  const e = videoEntry(video());
  assert.deepEqual(e.categories, ['Video', 'Film']);
  assert.equal(e.link, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(videoEntry(video({ isShort: true })), null);
  assert.equal(videoEntry(video({ isLive: true })), null);
});

test('selection: newest first across both kinds, capped, bad dates dropped', () => {
  const articles = Array.from({ length: 15 }, (_, i) =>
    article({ slug: `a${i}`, title: `A${i}`, isoDate: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  const videos = Array.from({ length: 15 }, (_, i) =>
    video({ title: `V${i}`, publishedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  const picked = selectDispatchEntries([...articles, article({ isoDate: 'not a date' })], videos, SITE);
  assert.equal(picked.length, DISPATCH_FEED_LIMIT);
  assert.equal(picked[0].title, 'V14');
  for (let i = 1; i < picked.length; i++) assert.ok(picked[i - 1].pubDate >= picked[i].pubDate);
});

test('the raw-doc predicate matches getVideosUnified plus the long-form rule', () => {
  const doc = { _type: 'video', youtubeId: 'abcdefghijk', title: 'T', contentStatus: 'published' };
  assert.equal(isDispatchVideoDoc(doc), true);
  assert.equal(isDispatchVideoDoc({ ...doc, contentStatus: undefined }), true);
  assert.equal(isDispatchVideoDoc({ ...doc, contentStatus: 'draft' }), false);
  assert.equal(isDispatchVideoDoc({ ...doc, _type: 'short' }), false);
  assert.equal(isDispatchVideoDoc({ ...doc, manualTypeOverride: 'live' }), false);
  assert.equal(isDispatchVideoDoc({ ...doc, isShort: true }), false);
});

test('image: the composed file when built, else the branded fallback, never the raw source', () => {
  const e = articleEntry(article(), SITE);
  const built = { 'https://example.com/a.jpg': { src: '/dispatch/images/abc.jpg', width: 1200, height: 675 } };
  assert.equal(dispatchImageUrl(e, built, SITE), 'https://beunconventionalhq.com/dispatch/images/abc.jpg');
  assert.equal(dispatchImageUrl(e, {}, SITE), `https://beunconventionalhq.com${DISPATCH_FALLBACK_IMAGE}`);
  // A manifest entry of the wrong size is not trusted.
  const wrong = { 'https://example.com/a.jpg': { src: '/x.jpg', width: 1200, height: 630 } };
  assert.equal(dispatchImageUrl(e, wrong, SITE), `https://beunconventionalhq.com${DISPATCH_FALLBACK_IMAGE}`);
  assert.equal(dispatchImageUrl(articleEntry(article({ image: '' }), SITE), built, SITE).endsWith(DISPATCH_FALLBACK_IMAGE), true);
});

test('content:encoded starts with the 1200x675 image, then the escaped summary', () => {
  const e = articleEntry(article({ excerpt: 'Tom & Jerry say "hi" > 3' }), SITE);
  const html = dispatchContentHtml(e, 'https://beunconventionalhq.com/dispatch/images/abc.jpg');
  assert.match(html, /^<img src="https:\/\/beunconventionalhq\.com\/dispatch\/images\/abc\.jpg" width="1200" height="675" alt="">/);
  assert.match(html, /<p>Tom &amp; Jerry say &quot;hi&quot; &gt; 3<\/p>$/);
});

test('/dispatch.json items: the RSS fields, ISO date, link as guid', () => {
  const e = articleEntry(article(), SITE);
  const item = dispatchJsonItem(e, 'https://beunconventionalhq.com/dispatch/images/abc.jpg');
  assert.deepEqual(item, {
    guid: 'https://beunconventionalhq.com/intel/a-story',
    kind: 'article',
    title: 'A Story',
    link: 'https://beunconventionalhq.com/intel/a-story',
    summary: 'The standfirst.',
    pubDate: '2026-09-10T12:00:00.000Z',
    categories: ['Review', 'TV'],
    imageUrl: 'https://beunconventionalhq.com/dispatch/images/abc.jpg',
    newsletter: { subtitle: 'The standfirst.', lede: null, blurb: 'The standfirst.', missing: [] },
  });
  // JSON-safe: survives a round trip unchanged (no Date objects).
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.equal(dispatchJsonItem(videoEntry(video()), 'x').kind, 'video');
});

test('pre-rendered boxes joined in order are EXACTLY the Kit template rendering the same posts', async () => {
  const renderer = createBoxRenderer(readFileSync(POST_TEMPLATE_PATH, 'utf8'));
  const heading = await renderer.latestHeading();
  assert.match(heading, /Latest from the/);
  for (let n = 1; n <= FIXTURE_POSTS.length; n++) {
    const posts = FIXTURE_POSTS.slice(0, n);
    const boxes = await Promise.all(posts.map((p) => renderer.boxes(p)));
    const joined = joinBoxes(boxes[0].featuredHtml, heading, boxes.slice(1).map((b) => b.latestHtml));
    // Whitespace between tags is the only freedom allowed: it renders as nothing.
    const squash = (html) => html.replace(/>\s+</g, '><').trim();
    assert.equal(squash(joined), squash(await renderPosts(posts)), `${n} posts`);
  }
  // A box carries its own story and no section heading.
  const { featuredHtml, latestHtml } = await renderer.boxes(FIXTURE_POSTS[1]);
  assert.match(featuredHtml, /Watch now/);
  assert.doesNotMatch(latestHtml, /Latest from the/);
});

test('the Kit post shape escapes the text the template prints raw', () => {
  const e = articleEntry(article({ title: 'Tom & <Jerry>', excerpt: 'a "b"' }), SITE);
  const post = dispatchKitPost(e, 'https://beunconventionalhq.com/dispatch/images/abc.jpg');
  assert.equal(post.title, 'Tom &amp; &lt;Jerry&gt;');
  assert.equal(post.summary, 'a &quot;b&quot;');
  assert.match(post.content, /^<img src="https:\/\/beunconventionalhq\.com\/dispatch\/images\/abc\.jpg"/);
  assert.deepEqual(post.categories, ['Review', 'TV']);
});

// ─── the newsletter's own fields (owner's rules, 2026-10-31) ───────────────

const ANDREW_SUBTITLE = "Who's gonna win Game of the Year? GTA VI, cutting it close with a November 19 launch, one day before the cutoff.";
const GAME_AWARDS_LEDE = 'The gaming industry takes over the Peacock Theater on December 10, with live performances, first-look trailers, and direct access to the developers building the games we love. Here is why a ticket is worth the trip to Los Angeles.';

test("FEATURED: the author's subtitle exactly as written, and the lede as a SEPARATE field", () => {
  const copy = newsletterCopy(article({ excerpt: ANDREW_SUBTITLE, preview: [GAME_AWARDS_LEDE, 'Second paragraph.'] }), 'article');
  assert.equal(copy.subtitle, ANDREW_SUBTITLE, 'never rewritten');
  assert.equal(copy.lede, GAME_AWARDS_LEDE, 'the opening paragraph, whole');
  assert.notEqual(copy.subtitle, copy.lede);
  // A CMS editorial excerpt is the author's too, and wins.
  assert.equal(newsletterCopy(article({ editorial: { excerpt: 'Typed in the CMS.' } }), 'article').subtitle, 'Typed in the CMS.');
});

test('the same sentence is never shown twice: a lede sentence that repeats the subtitle is dropped', () => {
  const copy = newsletterCopy(article({
    excerpt: 'The gaming industry takes over the Peacock Theater on December 10.',
    preview: ['The gaming industry takes over the Peacock Theater on December 10! Here is why a ticket is worth the trip.'],
  }), 'article');
  assert.equal(copy.lede, 'Here is why a ticket is worth the trip.');
  // Nothing left after the repeat: no lede at all.
  assert.equal(newsletterCopy(article({ excerpt: 'Same words.', preview: ['Same words.'] }), 'article').lede, null);
});

test('the lede is whole sentences only, never cut mid-thought', () => {
  const long = `${'A sentence that runs on for quite a while to fill space. '.repeat(8)}`;
  const lede = wholeSentences(long, 320);
  assert.ok(lede.length <= 320);
  assert.match(lede, /space\.$/);
  // One sentence longer than the limit: no lede, rather than half a sentence.
  assert.equal(wholeSentences(`${'word '.repeat(100)}end.`, 320), null);
});

test('blurb: written newsletter summary first, else a one-line subtitle, else MISSING (never invented)', () => {
  assert.equal(newsletterCopy(article({ editorial: { newsletterBlurb: 'Written for the newsletter.' } }), 'article').blurb, 'Written for the newsletter.');
  assert.equal(newsletterCopy(article({ excerpt: 'A one-line subtitle.' }), 'article').blurb, 'A one-line subtitle.');
  // Too long to be one line, or already cut by a machine: flagged, not trimmed.
  const tooLong = newsletterCopy(article({ excerpt: `${'Long '.repeat(60)}end.` }), 'article');
  assert.equal(tooLong.blurb, null);
  assert.deepEqual(tooLong.missing, ['blurb']);
  assert.equal(newsletterCopy(article({ excerpt: 'It was cut off…' }), 'article').blurb, null);
  // A video never borrows its YouTube description, and never the body's first sentence.
  const v = newsletterCopy(video({ description: 'I just attended the premiere and had to share my first thoughts.' }), 'video');
  assert.equal(v.blurb, null);
  assert.deepEqual(v.missing, ['subtitle', 'blurb']);
  assert.equal(newsletterCopy(article({ excerpt: '', preview: ['Body first sentence.'] }), 'article').blurb, null);
  assert.equal(newsletterCopy(video({ editorial: { newsletterBlurb: 'One line.' } }), 'video').blurb, 'One line.');
});

test('the Kit post carries the separate fields; the boxes print them whole', async () => {
  const e = articleEntry(article({ excerpt: ANDREW_SUBTITLE, preview: [GAME_AWARDS_LEDE] }), SITE);
  const post = dispatchKitPost(e, 'https://beunconventionalhq.com/dispatch/images/abc.jpg');
  assert.equal(post.newsletter, true);
  const renderer = createBoxRenderer(readFileSync(POST_TEMPLATE_PATH, 'utf8'));
  const { featuredHtml, latestHtml } = await renderer.boxes(post);
  assert.ok(featuredHtml.includes("Who&#39;s gonna win Game of the Year? GTA VI, cutting it close with a November 19 launch, one day before the cutoff.") ||
    featuredHtml.includes(post.subtitle), 'subtitle whole');
  assert.ok(featuredHtml.includes('Peacock Theater on December 10'), 'lede present');
  assert.equal(featuredHtml.split('November 19 launch').length - 1, 1, 'subtitle once');
  assert.equal(featuredHtml.split('Peacock Theater').length - 1, 1, 'lede once');
  // LATEST shows the blurb, whole, and no lede.
  assert.ok(latestHtml.includes(post.blurb));
  assert.ok(!latestHtml.includes('Peacock Theater'));
  // A story with no blurb renders without the line, not with a stand-in.
  const bare = { ...post, blurb: '' };
  const { latestHtml: noBlurb } = await renderer.boxes(bare);
  assert.ok(!/class="dx-body"/.test(noBlurb));
});

test('no template truncates text any more', () => {
  for (const f of ['post-template.liquid.html', 'also-this-week.liquid.html']) {
    assert.ok(!/truncate/.test(readFileSync(`${DISPATCH_DIR}/${f}`, 'utf8')), f);
  }
});

test('ALSO THIS WEEK rows, the issue line and the editor note are pre-rendered with placeholders', async () => {
  const read = (f) => readFileSync(`${DISPATCH_DIR}/${f}`, 'utf8');
  const renderer = createBoxRenderer({
    post: read('post-template.liquid.html'), also: read('also-this-week.liquid.html'),
    issueMarker: read('issue-marker.liquid.html'), editorNote: read('editor-note.liquid.html'),
  });
  const heading = await renderer.alsoHeading();
  assert.match(heading, /Also this week/);
  const { alsoHtml } = await renderer.boxes(FIXTURE_POSTS[1]);
  assert.ok(alsoHtml.includes(FIXTURE_POSTS[1].title));
  assert.doesNotMatch(alsoHtml, /Also this week/);
  // Heading + rows equals the template rendering the same posts.
  const squash = (html) => html.replace(/>\s+</g, '><').trim();
  const rows = await Promise.all(FIXTURE_POSTS.slice(0, 3).map(async (p) => (await renderer.boxes(p)).alsoHtml));
  const direct = await new Liquid().parseAndRender(read('also-this-week.liquid.html'), { posts: FIXTURE_POSTS.slice(0, 3) });
  assert.equal(squash(heading + rows.join('')), squash(direct));
  const { issueMarkerHtml, editorNoteHtml } = await renderer.issuePieces();
  assert.ok(issueMarkerHtml.includes('%%HQ_ISSUE_MARKER%%'));
  assert.ok(editorNoteHtml.includes('%%HQ_EDITOR_NOTE%%'));
  assert.match(editorNoteHtml, /From the editor/);
});

test('labels clear 6.5:1 on the story box (owner: red labels read faint)', () => {
  const L = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
  const post = readFileSync(POST_TEMPLATE_PATH, 'utf8');
  const labels = [...post.matchAll(/class="dx-red"[^>]*color:(#[0-9a-f]{6})/gi)].map((m) => m[1]);
  assert.ok(labels.length >= 4);
  for (const c of labels) assert.ok(ratio(c, '#111111') >= 6.5, `${c} is ${ratio(c, '#111111').toFixed(2)}:1`);
});

test('the fallback art is committed and 16:9', async () => {
  const file = new URL(`../public${DISPATCH_FALLBACK_IMAGE}`, import.meta.url);
  assert.ok(existsSync(file));
  const meta = await sharp(file.pathname).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 675]);
});

test('the committed manifest lists only 1200x675 files that exist', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/data/dispatch-images.json', import.meta.url), 'utf8'));
  for (const [source, entry] of Object.entries(manifest)) {
    assert.deepEqual([entry.width, entry.height], [1200, 675], source);
    const file = new URL(`../public${entry.src}`, import.meta.url);
    assert.ok(existsSync(file), `missing ${entry.src}`);
    const meta = await sharp(file.pathname).metadata();
    assert.deepEqual([meta.width, meta.height], [1200, 675], entry.src);
  }
});

/** A w x h image, mid grey, with a `border`px pure green frame at its very edge. */
async function framed(w, h, border = 6) {
  const inner = await sharp({ create: { width: w - 2 * border, height: h - 2 * border, channels: 3, background: '#808080' } })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: '#00ff00' } })
    .composite([{ input: inner, left: border, top: border }])
    .png()
    .toBuffer();
}

async function pixel(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const isGreen = ([r, g, b]) => g > 180 && r < 90 && b < 90;

test('composer: a wide image keeps all four edges (nothing cut off)', async () => {
  // 2.4:1, wider than 16:9: cover would cut the left and right edges off.
  const out = await composeDispatchImage(await framed(1440, 600));
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [WIDTH, HEIGHT]);
  // Fitted to 1200x500, centred: rows 87..587. Sample just inside each edge.
  assert.ok(isGreen(await pixel(out, 2, 337)), 'left edge');
  assert.ok(isGreen(await pixel(out, 1197, 337)), 'right edge');
  assert.ok(isGreen(await pixel(out, 600, 90)), 'top edge');
  assert.ok(isGreen(await pixel(out, 600, 584)), 'bottom edge');
});

test('composer: a tall image keeps all four edges too', async () => {
  const out = await composeDispatchImage(await framed(800, 800));
  // Fitted to 675x675, centred: columns 262..937.
  assert.ok(isGreen(await pixel(out, 265, 337)), 'left edge');
  assert.ok(isGreen(await pixel(out, 934, 337)), 'right edge');
  assert.ok(isGreen(await pixel(out, 600, 2)), 'top edge');
  assert.ok(isGreen(await pixel(out, 600, 672)), 'bottom edge');
});

test("composer: a YouTube 4:3 rendition loses its baked-in bars and nothing else", async () => {
  // hqdefault shape: 480x360, a 480x270 frame with 45px black bars.
  const frame = await framed(480, 270, 4);
  const hq = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#000000' } })
    .composite([{ input: frame, left: 0, top: 45 }])
    .png()
    .toBuffer();
  const out = await composeDispatchImage(hq, { sourceUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' });
  // The frame now fills the whole 16:9 output: its edge is at the image edge.
  assert.ok(isGreen(await pixel(out, 600, 3)), 'top edge at the top');
  assert.ok(isGreen(await pixel(out, 600, 671)), 'bottom edge at the bottom');
  assert.ok(isGreen(await pixel(out, 3, 337)), 'left edge');
  // The same picture from anywhere else is treated as real 4:3 art: fitted, not trimmed.
  const other = await composeDispatchImage(hq, { sourceUrl: 'https://example.com/hq.jpg' });
  assert.ok(!isGreen(await pixel(other, 600, 3)));
});
