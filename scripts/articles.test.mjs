/**
 * Offline tests for the Substack → local JSON article pipeline.
 *
 * No network, no credentials. The feed is a fixture, so the parse →
 * sanitize → merge path is exercised end to end exactly as it would run
 * against the real thing.
 */
import assert from 'node:assert/strict';
import { parsePostsResponse, planArticleSync } from './sync-articles.mjs';
import {
  demoteHeadings,
  sanitizeArticleHtml,
  mapCategory,
  toSlug,
  looksTruncated,
  toPlainText,
  buildArticleRecord,
  buildPreview,
  mergeSnapshot,
} from '../src/lib/articles-transform.ts';
import { imageFingerprint, optimiseBodyImages, stripCoverImageFromBody } from '../src/lib/article-media.ts';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
    process.exitCode = 1;
  }
}

console.log('articles.test.mjs');

// ── Heading demotion ────────────────────────────────────────────────────────

test('in-body h1 is demoted so the article title stays the only h1', () => {
  assert.equal(demoteHeadings('<h1>Body</h1>'), '<h2>Body</h2>');
});

test('heading demotion shifts the whole hierarchy and closes tags', () => {
  assert.equal(
    demoteHeadings('<h1>A</h1><h2>B</h2><h3>C</h3>'),
    '<h2>A</h2><h3>B</h3><h4>C</h4>',
  );
});

test('heading demotion clamps at h4 rather than running to h5/h6', () => {
  assert.equal(demoteHeadings('<h4>D</h4><h5>E</h5><h6>F</h6>'), '<h4>D</h4><h4>E</h4><h4>F</h4>');
});

test('heading demotion preserves attributes', () => {
  assert.equal(demoteHeadings('<h2 id="x">T</h2>'), '<h3 id="x">T</h3>');
});

// ── Sanitization ────────────────────────────────────────────────────────────

test('scripts are stripped entirely', () => {
  const out = sanitizeArticleHtml('<p>ok</p><script>alert(1)</script>');
  assert.ok(!out.includes('script'), out);
  assert.ok(out.includes('ok'));
});

test('iframes and embeds are stripped', () => {
  const out = sanitizeArticleHtml('<p>a</p><iframe src="https://evil.test"></iframe>');
  assert.ok(!out.includes('iframe'), out);
});

test('inline styles, classes and ids are stripped from body markup', () => {
  const out = sanitizeArticleHtml('<p style="color:red" class="x" id="y">text</p>');
  assert.equal(out, '<p>text</p>');
});

test('event handlers are stripped', () => {
  const out = sanitizeArticleHtml('<p onclick="steal()">text</p>');
  assert.ok(!out.includes('onclick'), out);
});

test('semantic tags survive', () => {
  const html = '<p>a</p><h2>h</h2><ul><li>i</li></ul><blockquote>q</blockquote><strong>s</strong>';
  const out = sanitizeArticleHtml(html);
  for (const tag of ['<p>', '<h3>', '<ul>', '<li>', '<blockquote>', '<strong>']) {
    assert.ok(out.includes(tag), `${tag} missing from ${out}`);
  }
});

test('external anchors are forced to rel="noopener noreferrer"', () => {
  const out = sanitizeArticleHtml('<p><a href="https://example.test">x</a></p>');
  assert.ok(out.includes('rel="noopener noreferrer"'), out);
});

test('javascript: URLs do not survive', () => {
  const out = sanitizeArticleHtml('<p><a href="javascript:alert(1)">x</a></p>');
  assert.ok(!out.includes('javascript:'), out);
});

test('empty paragraphs are dropped but image-bearing ones are kept', () => {
  const out = sanitizeArticleHtml('<p>  </p><p><img src="https://x.test/a.png" alt="a"></p>');
  assert.ok(!out.includes('<p>  </p>'), out);
  assert.ok(out.includes('<img'), out);
});

// ── Category mapping ────────────────────────────────────────────────────────

test('exact tag match wins and uses the site label Film, not Movies', () => {
  assert.equal(mapCategory(['Film'], ''), 'Film');
  assert.equal(mapCategory(['Movies'], ''), 'Film');
});

test('tag matching is case and punctuation insensitive', () => {
  assert.equal(mapCategory(['comic-con'], ''), 'Events');
  assert.equal(mapCategory(['GAMING'], ''), 'Gaming');
});

test('tags beat body text', () => {
  assert.equal(mapCategory(['Gaming'], 'a movie review about cinema'), 'Gaming');
});

test('falls back to text scan when no tag is usable', () => {
  assert.equal(mapCategory([], 'our review of the new season episode'), 'TV');
});

test('unmappable content lands in General rather than guessing', () => {
  assert.equal(mapCategory([], 'thoughts on nothing in particular'), 'General');
});

// ── Slugs ───────────────────────────────────────────────────────────────────

test('slug is taken from the Substack permalink', () => {
  assert.equal(
    toSlug('https://x.substack.com/p/mortal-kombat-2-review', 'Whatever'),
    'mortal-kombat-2-review',
  );
});

test('slug falls back to the title when the link has no /p/ segment', () => {
  assert.equal(toSlug('', 'The Boys: Season 5!'), 'the-boys-season-5');
});

test('slug strips query strings and fragments', () => {
  assert.equal(toSlug('https://x.substack.com/p/abc?utm=1#top', 'T'), 'abc');
});

// ── Truncation safety net ───────────────────────────────────────────────────

test('a full-length body is not flagged as truncated', () => {
  assert.equal(looksTruncated(`<p>${'word '.repeat(200)}</p>`), false);
});

test('a short teaser is flagged', () => {
  assert.equal(looksTruncated('<p>Just a taste.</p>'), true);
});

test('a paywall marker is flagged even when long', () => {
  const body = `<p>${'word '.repeat(200)} Subscribe to keep reading</p>`;
  assert.equal(looksTruncated(body), true);
});

// ── Record building ─────────────────────────────────────────────────────────

const NOW = new Date('2026-07-26T12:00:00Z');

test('a well-formed item produces a complete record', () => {
  const record = buildArticleRecord(
    {
      title: 'Mortal Kombat 2 Review',
      link: 'https://x.substack.com/p/mortal-kombat-2-review',
      guid: 'guid-1',
      pubDate: 'Tue, 05 May 2026 02:08:53 GMT',
      description: 'A review.',
      contentEncoded: `<h1>Heading</h1><p>${'word '.repeat(200)}</p>`,
      categories: ['Film'],
    },
    NOW,
  );
  assert.equal(record.guid, 'guid-1');
  assert.equal(record.slug, 'mortal-kombat-2-review');
  assert.equal(record.category, 'Film');
  assert.equal(record.hasBody, true);
  assert.ok(record.bodyHtml.startsWith('<h2>'), 'in-body h1 should be demoted');
  /*
    May 4, not May 5. The fixture's post_date is 2026-05-05T02:08:53Z, which
    is 7:08pm Pacific on the 4th — the evening it was actually published.

    This assertion used to read 'May 5' because dates were formatted in UTC,
    so everything posted after ~5pm Pacific was dated a day into the future.
    The expectation was encoding the bug. See src/lib/publish-timezone.js.
  */
  assert.equal(record.date, 'May 4, 2026');
});

// ── The magazine lede (buildPreview) ────────────────────────────────────────
//
// This is what fills the centre feature on /intel. The failure it exists to
// prevent is a one-line preview under a large headline, leaving an obvious
// empty block above the fold — so these tests are mostly about SIZE.

const PARA = (n) =>
  `<p>${'This is a sentence of roughly forty characters. '.repeat(n).trim()}</p>`;

test('the lede is several paragraphs, not one line', () => {
  const preview = buildPreview(PARA(5) + PARA(5) + PARA(5) + PARA(5));
  assert.ok(preview.length >= 2, `expected multiple paragraphs, got ${preview.length}`);
  assert.ok(
    preview.join(' ').length > 600,
    `expected a substantial lede, got ${preview.join(' ').length} chars`,
  );
});

test('the lede stops at the character budget rather than dumping the article', () => {
  const preview = buildPreview(PARA(4).repeat(40));
  assert.ok(preview.join(' ').length < 1600, 'lede should not run past its budget');
});

test('the paragraph cap is respected even with very short paragraphs', () => {
  const short = `<p>${'A short but usable paragraph of text here. '.repeat(2).trim()}</p>`;
  assert.ok(buildPreview(short.repeat(20)).length <= 5);
});

test('headings, lists and figures are not treated as lede paragraphs', () => {
  const preview = buildPreview(`<h2>What Works</h2><ul><li>Direction</li></ul>${PARA(5)}`);
  assert.equal(preview.length, 1);
  assert.ok(!preview[0].includes('What Works'));
  assert.ok(!preview[0].includes('Direction'));
});

test('one-line furniture paragraphs are skipped', () => {
  // "Score: 8/10" style sign-offs read as noise at the top of a feature.
  const preview = buildPreview(`<p>Score: 8/10</p>${PARA(5)}`);
  assert.equal(preview.length, 1);
  assert.ok(!preview[0].startsWith('Score'));
});

test('a body with no paragraphs falls back to the supplied text', () => {
  assert.deepEqual(buildPreview('<h2>Only a heading</h2>', 'The fallback.'), ['The fallback.']);
});

test('a body with nothing usable and no fallback yields an empty lede, not a crash', () => {
  assert.deepEqual(buildPreview('', ''), []);
});

test('markup never survives into the lede', () => {
  const preview = buildPreview(`<p><strong>Bold</strong> ${'text here and more of it. '.repeat(4)}</p>`);
  assert.ok(!preview[0].includes('<'), 'lede must be plain text — it is rendered via textContent');
});

test('a single over-long paragraph is trimmed at a sentence boundary', () => {
  const giant = `<p>${'Sentence number one is here. '.repeat(120)}</p>`;
  const preview = buildPreview(giant);
  assert.equal(preview.length, 1);
  assert.ok(preview[0].length < 1600, `expected a trim, got ${preview[0].length} chars`);
  assert.ok(/[.…]$/.test(preview[0]), 'trimmed lede should end cleanly');
});

test('every built record carries a lede', () => {
  const record = buildArticleRecord(
    {
      title: 'Review',
      link: 'https://x.substack.com/p/review',
      guid: 'g',
      pubDate: 'Tue, 05 May 2026 02:08:53 GMT',
      contentEncoded: PARA(6) + PARA(6),
      categories: ['Film'],
    },
    NOW,
  );
  assert.ok(Array.isArray(record.preview) && record.preview.length >= 1);
});

test('an item with no title is rejected rather than half-imported', () => {
  assert.equal(buildArticleRecord({ link: 'https://x.test/p/a' }, NOW), null);
});

test('an item with no guid or link is rejected', () => {
  assert.equal(buildArticleRecord({ title: 'Orphan' }, NOW), null);
});

test('an unparseable pubDate does not throw and does not produce Invalid Date', () => {
  const record = buildArticleRecord(
    { title: 'T', link: 'https://x.test/p/t', pubDate: 'not-a-date' },
    NOW,
  );
  assert.equal(record.isoDate, NOW.toISOString());
  assert.ok(!record.date.includes('Invalid'));
});

test('a truncated body yields hasBody:false so no local page is generated', () => {
  const record = buildArticleRecord(
    { title: 'T', link: 'https://x.test/p/t', contentEncoded: '<p>teaser</p>' },
    NOW,
  );
  assert.equal(record.hasBody, false);
});

// ── Merge semantics (the archive-safety contract) ───────────────────────────

const older = {
  guid: 'a',
  slug: 'a',
  title: 'Old post',
  link: 'l',
  date: 'May 1, 2026',
  isoDate: '2026-05-01T00:00:00.000Z',
  excerpt: '',
  image: '',
  category: 'Film',
  tags: [],
  bodyHtml: '<p>full</p>',
  hasBody: true,
  firstSeen: '2026-05-01T00:00:00.000Z',
  lastUpdated: '2026-05-01T00:00:00.000Z',
};

test('a record that has aged out of the feed window is NEVER deleted', () => {
  const incoming = [{ ...older, guid: 'b', isoDate: '2026-06-01T00:00:00.000Z' }];
  const { merged } = mergeSnapshot([older], incoming);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((r) => r.guid === 'a'), 'aged-out record was dropped');
});

test('an empty feed leaves the entire archive intact', () => {
  const { merged, added, updated } = mergeSnapshot([older], []);
  assert.equal(merged.length, 1);
  assert.equal(added, 0);
  assert.equal(updated, 0);
});

test('an existing GUID is updated in place, not duplicated', () => {
  const { merged, added, updated } = mergeSnapshot(
    [older],
    [{ ...older, title: 'Retitled' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Retitled');
  assert.equal(added, 0);
  assert.equal(updated, 1);
});

test('firstSeen survives an update', () => {
  const { merged } = mergeSnapshot(
    [older],
    [{ ...older, firstSeen: '2026-07-26T00:00:00.000Z' }],
  );
  assert.equal(merged[0].firstSeen, '2026-05-01T00:00:00.000Z');
});

test('a feed that stops returning bodies does not blank an archived body', () => {
  const { merged } = mergeSnapshot([older], [{ ...older, bodyHtml: '', hasBody: false }]);
  assert.equal(merged[0].bodyHtml, '<p>full</p>');
  assert.equal(merged[0].hasBody, true);
});

test('merged output is sorted newest first', () => {
  const newer = { ...older, guid: 'b', isoDate: '2026-06-01T00:00:00.000Z' };
  const { merged } = mergeSnapshot([older], [newer]);
  assert.equal(merged[0].guid, 'b');
});

// ── Posts API parsing, against a fixture ────────────────────────────────────

const FIXTURE = [
  {
    id: 196494656,
    title: 'Mortal Kombat 2 Review',
    slug: 'mortal-kombat-2-review',
    canonical_url: 'https://beunconventionalhq.substack.com/p/mortal-kombat-2-review',
    post_date: '2026-05-05T02:08:53.000Z',
    subtitle: 'A spoiler-free review.',
    postTags: [{ id: 1, name: 'Film', slug: 'film' }],
    body_html: `<h1>The Verdict</h1><p style="color:red">${'word '.repeat(200)}</p><script>bad()</script>`,
    cover_image: 'https://substackcdn.com/image/fetch/cover.jpg',
  },
  {
    // No id, slug, or canonical_url — nothing to build a guid/link from.
    title: 'Broken Post',
    post_date: 'garbage',
    body_html: '<p>short</p>',
  },
];

test('fixture response parses into raw items', () => {
  const items = parsePostsResponse(FIXTURE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Mortal Kombat 2 Review');
  assert.equal(items[0].guid, '196494656');
  assert.deepEqual(items[0].categories, ['Film']);
  assert.ok(items[0].contentEncoded.includes('<h1>'));
});

test('a bare-string postTags entry is tolerated', () => {
  const items = parsePostsResponse([{ ...FIXTURE[0], postTags: ['Film'] }]);
  assert.deepEqual(items[0].categories, ['Film']);
});

test('link falls back to publication/p/slug when canonical_url is missing', () => {
  const items = parsePostsResponse([{ id: 1, title: 'x', slug: 'x-slug' }]);
  assert.equal(items[0].link, 'https://beunconventionalhq.substack.com/p/x-slug');
});

test('a single-post response still parses as an array', () => {
  assert.equal(parsePostsResponse(FIXTURE[0]).length, 1);
});

test('a malformed item is skipped with a reason and the rest still import', () => {
  const { merged, skipped, parsed } = planArticleSync(parsePostsResponse(FIXTURE), [], NOW);
  assert.equal(parsed, 1, 'only the well-formed item should parse');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /guid|title/);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].slug, 'mortal-kombat-2-review');
});

test('end-to-end: fixture import sanitizes, demotes and categorises', () => {
  const { merged } = planArticleSync(parsePostsResponse(FIXTURE), [], NOW);
  const record = merged[0];
  assert.equal(record.category, 'Film');
  assert.equal(record.hasBody, true);
  assert.ok(!record.bodyHtml.includes('script'), 'script survived sanitization');
  assert.ok(!record.bodyHtml.includes('style='), 'inline style survived sanitization');
  assert.ok(record.bodyHtml.includes('<h2>The Verdict</h2>'), record.bodyHtml.slice(0, 120));
});

test('re-running the same response is idempotent', () => {
  const first = planArticleSync(parsePostsResponse(FIXTURE), [], NOW);
  const second = planArticleSync(parsePostsResponse(FIXTURE), first.merged, NOW);
  assert.equal(second.merged.length, first.merged.length);
  assert.equal(second.added, 0);
});


// ── Plain-text extraction across block boundaries ───────────────────────────

test('paragraph boundaries do not weld words together', () => {
  // The reported symptom: "(kind of)So yeah" with no space.
  const text = toPlainText('<p>Seth Rogen… RIP (kind of)</p><p>So yeah… he died.</p>');
  assert.equal(text, 'Seth Rogen… RIP (kind of) So yeah… he died.');
});

test('a figure caption does not run into the next sentence', () => {
  const text = toPlainText(
    '<p>Low expectations.</p><figure><img src="x.jpg"><figcaption>Johnny Cage Fight</figcaption></figure><p>I saw it early.</p>',
  );
  assert.equal(text, 'Low expectations. Johnny Cage Fight I saw it early.');
});

test('<br> is a word boundary too', () => {
  assert.equal(toPlainText('<p>one<br>two</p>'), 'one two');
});

// ── Cover-image de-duplication ──────────────────────────────────────────────

const MK_UPLOAD =
  'https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa5e65013-c01a-4445-b2cc-e706293c9e3e_2048x1152.jpeg';
const MK_COVER = `https://substackcdn.com/image/fetch/$s_!qfD6!,f_auto,q_auto:good,fl_progressive:steep/${MK_UPLOAD}`;
const MK_IN_BODY = `https://substackcdn.com/image/fetch/$s_!qfD6!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/${MK_UPLOAD}`;

test('the same asset fingerprints identically through different CDN transforms', () => {
  assert.equal(imageFingerprint(MK_COVER), imageFingerprint(MK_IN_BODY));
  assert.match(imageFingerprint(MK_COVER), /^image:a5e65013/);
});

test('a YouTube thumbnail fingerprints to its video id', () => {
  assert.equal(
    imageFingerprint('https://substackcdn.com/image/youtube/w_728,c_limit/oUT7clLVxhw'),
    'youtube:oUT7clLVxhw',
  );
});

test('different assets do not collide', () => {
  assert.notEqual(imageFingerprint(MK_COVER), imageFingerprint('.../public/images/other_100x100.jpeg'));
});

test('the duplicated cover figure is removed, caption and all', () => {
  const body = `<p>Intro.</p><figure><a href="${MK_COVER}"><img src="${MK_IN_BODY}" alt="Johnny Cage Fight"></a><figcaption>Johnny Cage Fight</figcaption></figure><p>Body.</p>`;
  const out = stripCoverImageFromBody(body, MK_COVER);
  assert.equal(out, '<p>Intro.</p><p>Body.</p>');
  assert.ok(!out.includes('figcaption'), 'caption was stranded');
});

test('only the first occurrence is removed', () => {
  const fig = `<figure><img src="${MK_IN_BODY}"></figure>`;
  const out = stripCoverImageFromBody(`${fig}<p>x</p>${fig}`, MK_COVER);
  assert.equal(out, `<p>x</p>${fig}`);
});

test('a body that does not repeat the cover is untouched', () => {
  // The Boys case: cover is a YouTube thumb, body's embed was sanitized away.
  const body = '<p>Seth Rogen… RIP</p><h3>Why it worked</h3><p>More.</p>';
  assert.equal(
    stripCoverImageFromBody(body, 'https://substackcdn.com/image/youtube/w_728,c_limit/oUT7clLVxhw'),
    body,
  );
});

test('a bare img with no figure wrapper is still removed', () => {
  const out = stripCoverImageFromBody(`<p>a</p><img src="${MK_IN_BODY}"><p>b</p>`, MK_COVER);
  assert.equal(out, '<p>a</p><p>b</p>');
});

test('no cover image means the body is returned unchanged', () => {
  const body = `<figure><img src="${MK_IN_BODY}"></figure>`;
  assert.equal(stripCoverImageFromBody(body, ''), body);
});

/*
  ─── BODY IMAGES: REWRITTEN, BUT NOTHING ELSE TOUCHED ───────────────────────

  Substack embeds body images at upload size. One review on /intel carried
  nine, several 3840x2160, in a ~720px column — megabytes the page cannot use,
  and invisible to the components because the body arrives as a string.

  This is a transform on SOMEONE ELSE'S markup, so the risk is not that it
  fails to optimise — it is that it silently drops or mangles content. Hence
  the count/order assertions.
*/
const fakeSources = (url) => ({
  src: `https://cdn.example/r?u=${encodeURIComponent(url)}&w=600`,
  srcset: `https://cdn.example/r?u=${encodeURIComponent(url)}&w=400 400w`,
});

test('body images are rewritten to renditions and lazy-loaded', () => {
  const html = '<figure><img src="https://sub.example/a_3840x2160.jpeg" alt="x"></figure>';
  const out = optimiseBodyImages(html, fakeSources);
  assert.ok(out.includes('cdn.example/r?u='), 'src should be a rendition');
  assert.ok(!out.includes('src="https://sub.example'), 'the original src must be gone');
  assert.ok(out.includes('loading="lazy"'), 'body images are below the fold');
  assert.ok(out.includes('srcset='), 'a srcset lets a phone take a smaller one');
});

test('a relative or data src is left completely alone', () => {
  for (const html of ['<img src="/local/a.png">', '<img src="data:image/png;base64,AA">']) {
    assert.equal(optimiseBodyImages(html, fakeSources), html);
  }
});

test('existing loading/srcset attributes are never overwritten', () => {
  const html = '<img src="https://sub.example/a.jpg" loading="eager" srcset="already 1w">';
  const out = optimiseBodyImages(html, fakeSources);
  assert.ok(out.includes('loading="eager"'), 'an explicit loading must survive');
  assert.ok(out.includes('srcset="already 1w"'), 'an explicit srcset must survive');
  assert.ok(!out.includes('400w'), 'and must not be joined by a second one');
});

test('image COUNT and order are preserved', () => {
  const html = '<img src="https://s/1.jpg"><p>a</p><img src="/rel.png"><p>b</p><img src="https://s/2.jpg">';
  const out = optimiseBodyImages(html, fakeSources);
  assert.equal((out.match(/<img/g) || []).length, 3, 'no image may be dropped');
  assert.ok(out.indexOf('1.jpg') < out.indexOf('rel.png'), 'order must be preserved');
  assert.equal((out.match(/<p>/g) || []).length, 2, 'surrounding markup is untouched');
});

test('a throwing or empty source helper leaves the tag verbatim', () => {
  const html = '<img src="https://sub.example/a.jpg">';
  assert.equal(optimiseBodyImages(html, () => { throw new Error('boom'); }), html);
  assert.equal(optimiseBodyImages(html, () => ({ src: '', srcset: '' })), html);
});

test('empty or missing body html is handled', () => {
  assert.equal(optimiseBodyImages('', fakeSources), '');
  assert.equal(optimiseBodyImages(null, fakeSources), '');
});

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED, ${passed} passed.`);
} else {
  console.log(`All ${passed} tests passed.`);
}
