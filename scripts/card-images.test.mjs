/*
  Card thumbnail sizing (src/lib/card-images.ts).

  These rewrites shipped inline in ContentCard.astro with no coverage, and two
  of the four branches were dead on real data: the Substack width replace
  missed the 6 of 11 URLs in src/data/articles.json that carry no `w_` at all,
  and the companion height replace matched none of them. A card image that
  quietly keeps loading a 2048x1152 original looks completely fine in review —
  which is exactly why it needs a test rather than an eyeball.

  Offline and pure: plain `node scripts/card-images.test.mjs`.
*/
import assert from 'node:assert/strict';
import {
  getCardImageSources,
  CARD_IMAGE_SIZES,
  youtubeFallbackSrc,
} from '../src/lib/card-images.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

/*
  Parse a srcset into [{url, descriptor}].

  Deliberately NOT `srcset.split(',')`. Substack's Cloudinary transform list is
  itself comma-separated, so every candidate URL contains commas and a naive
  split shreds four candidates into twenty-four fragments.

  Browsers do not have that problem: the HTML srcset grammar collects a URL as
  a run of NON-WHITESPACE characters, so an embedded comma is part of the URL
  and only ", " acts as the candidate separator. Verified in Chromium against
  these exact URL shapes — with a sentinel `src` to distinguish selection from
  fallback, it selected the intended candidate and requested the URL with its
  commas intact.

  So the separator to split on is a comma followed by whitespace and the start
  of the next URL, which is what browsers effectively do.
*/
function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(/,\s+(?=https?:\/\/)/)
    .map((entry) => {
      const [url, descriptor] = entry.trim().split(/\s+/);
      return { url, descriptor };
    });
}

console.log('YouTube renditions:');

const MAXRES = 'https://i.ytimg.com/vi/zGA4XXAkE_s/maxresdefault.jpg';

test('maxresdefault downgrades its src to hqdefault', () => {
  const { src } = getCardImageSources(MAXRES);
  assert.equal(src, 'https://i.ytimg.com/vi/zGA4XXAkE_s/hqdefault.jpg');
});

test('maxresdefault offers both renditions with true intrinsic widths', () => {
  const entries = parseSrcset(getCardImageSources(MAXRES).srcset);
  assert.deepEqual(entries, [
    { url: 'https://i.ytimg.com/vi/zGA4XXAkE_s/hqdefault.jpg', descriptor: '480w' },
    { url: 'https://i.ytimg.com/vi/zGA4XXAkE_s/maxresdefault.jpg', descriptor: '1280w' },
  ]);
});

test('the video id is preserved verbatim', () => {
  // A greedy rewrite could eat the id segment; ids can contain '-' and '_'.
  const { src, srcset } = getCardImageSources(
    'https://i.ytimg.com/vi/a-B_c1D2e3F/maxresdefault.jpg',
  );
  assert.ok(src.includes('/vi/a-B_c1D2e3F/'), src);
  for (const { url } of parseSrcset(srcset)) {
    assert.ok(url.includes('/vi/a-B_c1D2e3F/'), url);
  }
});

test('hqdefault is left alone and never upgraded', () => {
  /*
    maxresdefault only exists for uploads at 720p+. Synthesising it from a
    lower rendition returns YouTube's grey 120x90 placeholder, so a URL that
    did not already name maxresdefault must pass through untouched.
  */
  const url = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg';
  const { src, srcset } = getCardImageSources(url);
  assert.equal(src, url);
  assert.equal(srcset, '');
});

test('mqdefault and sddefault are likewise untouched', () => {
  for (const rendition of ['mqdefault', 'sddefault', 'default']) {
    const url = `https://i.ytimg.com/vi/abc123/${rendition}.jpg`;
    const { src, srcset } = getCardImageSources(url);
    assert.equal(src, url, rendition);
    assert.equal(srcset, '', rendition);
  }
});

test('an unrecognised ytimg path is passed through', () => {
  const url = 'https://i.ytimg.com/vi/abc123/oardefault.jpg';
  assert.deepEqual(getCardImageSources(url), { src: url, srcset: '' });
});

console.log('\nSubstack renditions:');

// Both shapes are real, taken from src/data/articles.json.
const SUBSTACK_NO_WIDTH =
  'https://substackcdn.com/image/fetch/$s_!qfD6!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa5e65013_2048x1152.jpeg';
const SUBSTACK_WITH_WIDTH =
  'https://substackcdn.com/image/fetch/$s_!COgv!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa5e65013_2048x1152.jpeg';

test('a width is INSERTED when the URL carries none', () => {
  // The regression: 6 of 11 real URLs have no w_, and a replace-only rewrite
  // left every one of them serving the full-size original.
  const { src } = getCardImageSources(SUBSTACK_NO_WIDTH);
  assert.ok(src.includes('w_600'), src);
  assert.ok(src.includes('c_limit'), src);
});

test('an existing width is replaced, not duplicated', () => {
  const { src } = getCardImageSources(SUBSTACK_WITH_WIDTH);
  assert.ok(src.includes('w_600'), src);
  assert.ok(!src.includes('w_1456'), src);
  assert.equal(src.match(/w_\d+/g).length, 1, 'exactly one width param');
});

test('c_limit appears exactly once even when already present', () => {
  const { src } = getCardImageSources(SUBSTACK_WITH_WIDTH);
  assert.equal(src.match(/c_limit/g).length, 1, src);
});

test('the encoded original URL is never rewritten', () => {
  /*
    The original is percent-encoded and its filename ends `_2048x1152.jpeg`.
    A whole-string regex would happily rewrite digits in there and produce a
    404. Both real shapes must come through with the original byte-identical.
  */
  for (const input of [SUBSTACK_NO_WIDTH, SUBSTACK_WITH_WIDTH]) {
    const original = input.slice(input.indexOf('/https%3A'));
    const { src, srcset } = getCardImageSources(input);
    assert.ok(src.endsWith(original), src);
    for (const { url } of parseSrcset(srcset)) {
      assert.ok(url.endsWith(original), url);
    }
  }
});

test('the other transforms are preserved in order', () => {
  const { src } = getCardImageSources(SUBSTACK_NO_WIDTH);
  const transforms = src.slice(
    src.indexOf('image/fetch/') + 'image/fetch/'.length,
    src.indexOf('/https%3A'),
  );
  for (const part of ['$s_!qfD6!', 'f_auto', 'q_auto:good', 'fl_progressive:steep']) {
    assert.ok(transforms.split(',').includes(part), `${part} missing from ${transforms}`);
  }
});

test('no height is pinned', () => {
  // The old h_338 forced a 16:9 box onto sources of any ratio. The card
  // already fixes aspect via CSS + object-fit, so height must stay absent.
  const { src, srcset } = getCardImageSources(SUBSTACK_NO_WIDTH);
  assert.ok(!/[,/]h_\d+/.test(src), src);
  assert.ok(!/[,/]h_\d+/.test(srcset), srcset);
});

test('srcset ascends and descriptors match their widths', () => {
  const entries = parseSrcset(getCardImageSources(SUBSTACK_NO_WIDTH).srcset);
  assert.equal(entries.length, 4);

  let previous = 0;
  for (const { url, descriptor } of entries) {
    const width = Number(descriptor.replace('w', ''));
    assert.ok(width > previous, `descriptors must ascend, got ${descriptor} after ${previous}w`);
    // The descriptor is a promise about the file; it has to match the request.
    assert.ok(url.includes(`w_${width}`), `${url} does not request ${width}px`);
    previous = width;
  }
});

console.log('\nPass-through and edge cases:');

test('a non-YouTube, non-Substack URL is proxied through wsrv.nl', () => {
  const url = 'https://cdn.sanity.io/images/abc/production/def-1920x1080.jpg';
  const sources = getCardImageSources(url);
  assert.ok(sources.src.includes('wsrv.nl/?url=cdn.sanity.io'), sources.src);
  assert.ok(sources.srcset.includes('wsrv.nl/?url=cdn.sanity.io'), sources.srcset);
  assert.ok(sources.srcset.includes('400w'));
  assert.ok(sources.srcset.includes('1200w'));
});

test('empty, whitespace, null and undefined all yield no image', () => {
  for (const input of ['', '   ', '\n\t ', null, undefined]) {
    assert.deepEqual(
      getCardImageSources(input),
      { src: '', srcset: '' },
      `input: ${JSON.stringify(input)}`,
    );
  }
});

test('surrounding whitespace is trimmed', () => {
  // ContentCard guarded this before the rewrite existed: an untrimmed
  // whitespace value still reaches <img src> and paints a broken box.
  const { src } = getCardImageSources(`  ${MAXRES}\n`);
  assert.equal(src, 'https://i.ytimg.com/vi/zGA4XXAkE_s/hqdefault.jpg');
});

test('the rewrite is idempotent', () => {
  // Cards can be re-derived from already-rewritten data; a second pass must
  // not stack a second w_ or c_limit.
  for (const input of [MAXRES, SUBSTACK_NO_WIDTH, SUBSTACK_WITH_WIDTH]) {
    const once = getCardImageSources(input);
    const twice = getCardImageSources(once.src);
    assert.equal(twice.src, once.src, input);
  }
});

console.log('\nsizes attribute:');

test('CARD_IMAGE_SIZES covers every grid breakpoint', () => {
  // Mirrors home-cards.css: 42vw phone row, 2-up to 1100px, 4-up capped 1536.
  assert.match(CARD_IMAGE_SIZES, /max-width:\s*560px\)\s*42vw/);
  assert.match(CARD_IMAGE_SIZES, /max-width:\s*1100px\)\s*47vw/);
  assert.match(CARD_IMAGE_SIZES, /min-width:\s*1536px\)\s*360px/);
  assert.ok(CARD_IMAGE_SIZES.trim().endsWith('23vw'), CARD_IMAGE_SIZES);
});

console.log('\nyoutubeFallbackSrc (client recovery target):');

/*
  This is the half of the contract srcset cannot express. The browser will
  not retry a neighbouring candidate when its pick 404s, so Layout.astro's
  fail-safe re-points the <img> at the rendition YouTube always generates.
  Both sides share this function so they cannot disagree about which one
  that is.
*/

test('maxresdefault falls back to hqdefault', () => {
  assert.equal(
    youtubeFallbackSrc(MAXRES),
    'https://i.ytimg.com/vi/zGA4XXAkE_s/hqdefault.jpg',
  );
});

test('sddefault falls back too — it is 4:3 but it is not guaranteed either', () => {
  assert.equal(
    youtubeFallbackSrc('https://i.ytimg.com/vi/abc123/sddefault.jpg'),
    'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
  );
});

test('the guaranteed renditions decline, so the caller stops instead of looping', () => {
  /*
    An empty return is what makes the recovery single-shot in the honest
    case: if hqdefault itself is what failed, there is nothing better to
    ask for and the container should get the branded panel.
  */
  for (const rendition of ['hqdefault', 'mqdefault', 'default']) {
    assert.equal(
      youtubeFallbackSrc(`https://i.ytimg.com/vi/abc123/${rendition}.jpg`),
      '',
      rendition,
    );
  }
});

test('non-YouTube URLs decline', () => {
  // Article covers must keep reaching markFailed() and their branded panel.
  for (const url of [
    'https://substackcdn.com/image/fetch/w_600,c_limit/https%3A%2F%2Fx.jpg',
    'https://wsrv.nl/?url=example.com%2Fa.jpg&w=600',
    '/article-images/0104b20cd77d37bb-720.webp',
    '',
  ]) {
    assert.equal(youtubeFallbackSrc(url), '', JSON.stringify(url));
  }
});

test('the video id survives, and query strings are preserved', () => {
  assert.equal(
    youtubeFallbackSrc('https://i.ytimg.com/vi/a-B_c1D2e3F/maxresdefault.jpg?sqp=xyz'),
    'https://i.ytimg.com/vi/a-B_c1D2e3F/hqdefault.jpg?sqp=xyz',
  );
});

test('it agrees with the src getCardImageSources already chose', () => {
  /*
    The build-time rewrite and the client-side recovery must land on the
    same URL, or a retry would fetch a second distinct file and defeat the
    cache. This is the whole reason the helper is shared.
  */
  assert.equal(youtubeFallbackSrc(MAXRES), getCardImageSources(MAXRES).src);
});

test('applying it twice is a no-op', () => {
  const once = youtubeFallbackSrc(MAXRES);
  assert.equal(youtubeFallbackSrc(once), '');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
