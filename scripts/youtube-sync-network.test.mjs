import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClient } from '../src/lib/platforms/youtube.ts';

const item = (id, duration = 'PT2M') => ({
  id, contentDetails: { duration },
  snippet: { title: 'Test upload', publishedAt: '2026-10-26T18:00:00Z' },
});

test('Shorts probes use bounded concurrency, have timeouts, and preserve API order', async () => {
  const items = Array.from({ length: 12 }, (_, i) => item(String(i).padStart(11, '0')));
  let active = 0;
  let peak = 0;
  const client = createYouTubeClient({ apiKey: 'fixture', fetchImpl: async (url, options) => {
    if (String(url).includes('googleapis.com')) return Response.json({ items });
    assert.ok(options.signal instanceof AbortSignal);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return new Response(null, { status: 200 });
  } });
  const result = await client.getVideoDetails(items.map(i => i.id));
  assert.equal(peak, 4);
  assert.deepEqual(result.map(v => v.id), items.map(i => i.id));
  assert.ok(result.every(v => v.isShort));
});

test('a transient HTTP/2 failure is retried before classifying a long Short', async () => {
  let probes = 0;
  const client = createYouTubeClient({ apiKey: 'fixture', fetchImpl: async url => {
    if (String(url).includes('googleapis.com')) return Response.json({ items: [item('abcdefghijk')] });
    if (!probes++) throw new Error('ERR_HTTP2_SESSION_ERROR');
    return new Response(null, { status: 200 });
  } });
  const [result] = await client.getVideoDetails(['abcdefghijk']);
  assert.equal(result.isShort, true);
  assert.equal(probes, 2);
});

test('unavailable probes preserve known long Shorts; a working redirect remains authoritative', async () => {
  const client = createYouTubeClient({ apiKey: 'fixture', knownShortIds: new Set(['abcdefghijk']), fetchImpl: async url => {
    if (String(url).includes('googleapis.com')) return Response.json({ items: [item('abcdefghijk')] });
    return new Response(null, { status: 429 });
  } });
  assert.equal((await client.getVideoDetails(['abcdefghijk']))[0].isShort, true);
  const ordinary = createYouTubeClient({ apiKey: 'fixture', knownShortIds: new Set(['abcdefghijk']), fetchImpl: async url =>
    String(url).includes('googleapis.com') ? Response.json({ items: [item('abcdefghijk')] }) : new Response(null, { status: 303 }),
  });
  assert.equal((await ordinary.getVideoDetails(['abcdefghijk']))[0].isShort, false);
});

test('YouTube API failures still fail the sync instead of being swallowed as probe failures', async () => {
  const client = createYouTubeClient({ apiKey: 'fixture', fetchImpl: async () => Response.json({ error: { message: 'quota exceeded' } }, { status: 403 }) });
  await assert.rejects(client.getVideoDetails(['abcdefghijk']), /quota exceeded/);
});
