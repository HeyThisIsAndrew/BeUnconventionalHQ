/*
  Featured Highlights — ensure the component maintains consistent state across clicks
*/
import { launchTestBrowser } from './e2e-browser.mjs';
import { startPreviewServer } from './e2e-server.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapSanityVideo } from '../src/lib/videos.ts';
import { categorize } from '../src/data/categorize.js';
import { pickHomeFeatured } from '../src/lib/homepage-featured-selection.ts';

async function runTests() {
  console.log('Starting Astro preview server for Featured Highlights E2E...');
  const { stop } = await startPreviewServer();

  console.log('Server is running. Launching Puppeteer...');
  const browser = await launchTestBrowser();
  let exitCode = 0;
  let passed = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://localhost:4321/', { waitUntil: 'networkidle2' });

    /* The homepage arms a splash curtain; drop it so the component is laid out. */
    await page.evaluate(() => {
      document.documentElement.classList.remove('splash-armed', 'splash-lifting', 'splash-dropping');
      window.__hqScrollLock?.release?.();
    });

    const hasComponent = await page
      .waitForSelector('.featured-highlights', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!hasComponent) {
      console.log('  – No featured highlights component rendered, skipping');
      await page.close();
      return;
    }

    const docs = JSON.parse(fs.readFileSync(new URL('../src/data/videos.json', import.meta.url), 'utf8'));
    const videos = docs.filter(doc => (doc.manualTypeOverride || doc._type) === 'video'
      && (doc.contentStatus === 'published' || !doc.contentStatus))
      .map(doc => mapSanityVideo(doc, { categorize })).filter(Boolean)
      .map(video => ({ ...video, type: 'video' }));
    const expected = pickHomeFeatured(videos);
    if (expected?.kind === 'collection') {
      const rendered = await page.evaluate(() => ({
        lead: document.querySelector('.featured-world .fh-hero-card.active [data-video-id]')?.getAttribute('data-video-id'),
        featuredIds: [...document.querySelectorAll('.featured-world [data-video-id]')].map(el => el.getAttribute('data-video-id')),
        heroIds: [...document.querySelectorAll('.hero-acc [data-play-video]')].map(el => el.getAttribute('data-play-video')),
        rows: document.querySelectorAll('.featured-world .fh-row').length,
      }));
      assert.equal(rendered.lead, expected.items[0].youtubeId, 'Featured must open on the newest series video');
      assert.ok(rendered.rows <= 4, 'Featured must keep its four-item window');
      assert.ok(rendered.heroIds.every(id => !rendered.featuredIds.includes(id)), 'the hero must not repeat a Featured video');
      console.log('  ✓ Featured opens on the newest series video without repeating it in the hero');
      passed++;
    }

    const result = await page.evaluate(async () => {
      const section = document.querySelector('.featured-highlights');
      const rows = [...section.querySelectorAll('.fh-row')];
      const errors = [];

      // Initial state checks
      const activeRows = [...section.querySelectorAll('.fh-row.is-active')];
      if (activeRows.length !== 1) {
        errors.push(`Expected 1 active row, found ${activeRows.length}`);
      }

      const activeIndex = activeRows[0].getAttribute('data-index');
      const activeHero = [...section.querySelectorAll('.fh-hero-card.active')];

      if (activeHero.length !== 1) {
        errors.push(`Expected 1 active hero, found ${activeHero.length}`);
      }

      if (activeHero.length === 1 && activeHero[0].getAttribute('data-index') !== activeIndex) {
        errors.push('Active hero index does not match active row index');
      }

      // Interaction check
      if (rows.length > 1) {
        const nextRow = rows[1];
        nextRow.click();
        
        // Wait for DOM to update
        await new Promise(r => setTimeout(r, 100));

        const newActiveRows = [...section.querySelectorAll('.fh-row.is-active')];
        if (newActiveRows.length !== 1) {
          errors.push(`After click: Expected 1 active row, found ${newActiveRows.length}`);
        } else if (newActiveRows[0].getAttribute('data-index') !== nextRow.getAttribute('data-index')) {
          errors.push('After click: Active row did not update to clicked index');
        }

        const newActiveHero = [...section.querySelectorAll('.fh-hero-card.active')];
        if (newActiveHero.length !== 1 || newActiveHero[0].getAttribute('data-index') !== nextRow.getAttribute('data-index')) {
          errors.push('After click: Hero card did not update to match active row');
        }
      }

      return errors;
    });

    assert.equal(result.length, 0, `Featured Highlights state errors: ${result.join(', ')}`);
    console.log(`  ✓ Desktop: state is consistent and interactive`);
    passed++;

    console.log(`\n✅ Featured Highlights E2E tests passed (${passed} assertions groups).`);
  } catch (error) {
    console.error('\n❌ Featured Highlights E2E failed:', error.message);
    exitCode = 1;
  } finally {
    await browser.close();
    stop();
    process.exit(exitCode);
  }
}

runTests();
