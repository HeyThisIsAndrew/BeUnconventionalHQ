/** The built homepage's latest shelves must track the committed publication sources. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8'));
const latestArticle = read('articles').filter(article => !article.editorial?.hidden)
  .sort((a, b) => Date.parse(b.isoDate) - Date.parse(a.isoDate))[0];
const videos = read('videos').filter(video => (video.manualTypeOverride || video._type) === 'video'
  && (!video.contentStatus || video.contentStatus === 'published'))
  .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
assert.ok(latestArticle && videos.length, 'publication fixtures must not be empty');

const { stop } = await startPreviewServer();
const browser = await launchTestBrowser();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });
    const rendered = await page.evaluate(() => ({
      article: document.querySelector('.intel-spread #intel-feature-title')?.textContent.trim(),
      videoIds: [...document.querySelectorAll('[data-watching-item]:not([data-watching-clone])')]
        .map(item => item.querySelector('[data-video-id]')?.getAttribute('data-video-id')),
    }));
    assert.equal(rendered.article, latestArticle.editorial?.title ?? latestArticle.title,
      'Intel must lead with the newest article even if the hero or Featured also shows it');
    assert.deepEqual(rendered.videoIds, videos.slice(0, 10).map(video => video.youtubeId),
      'Watching must show the latest ten videos without cross-section exclusions');
    assert.equal(new Set(rendered.videoIds).size, rendered.videoIds.length);
    console.log(`PASS ${width}px: newest article leads Intel; latest videos lead Watching with no internal repeats.`);
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
