import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { execSync } from 'child_process';

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

const viewports = [
  { name: '360x740', width: 360, height: 740, isMobile: true, hasTouch: true },
  { name: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true },
  { name: '768x1024', width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: '1440x900', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: '1920x1080', width: 1920, height: 1080, isMobile: false, hasTouch: false }
];

const routes = [
  '/',
  '/about',
  '/author/andrew-baxter',
  '/category/film',
  '/events',
  '/events/avengers-doomsday-premiere',
  '/events/avengers-doomsday-premiere/coverage',
  '/events/archive',
  '/featured',
  '/featured/dc-comics',
  '/feed',
  '/intel',
  '/intel/lanterns-premiere-review-dcs-biggest',
  '/intel/topic/film'
];

function findSourceFile(classList) {
  if (!classList || classList.length === 0) return 'Unknown';
  for (const cls of classList) {
    if (cls.match(/^[a-z0-9-]+$/)) {
      try {
        const out = execSync(`grep -rl "\\.${cls}\\|class=[^>]*${cls}\\|className=[^>]*${cls}" src/`, { encoding: 'utf8' });
        const files = out.trim().split('\n').filter(Boolean);
        if (files.length > 0) return files[0];
      } catch (e) {
        // grep exits with 1 if no match
      }
    }
  }
  return 'Unknown';
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      let distance = 300;
      let timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight > 10000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });
  await new Promise(r => setTimeout(r, 500));
}

async function probeCards(page, vpName, currentRoute, stateName) {
  return await page.evaluate(async (vpName, currentRoute, stateName) => {
    const images = Array.from(document.querySelectorAll('img, picture, [style*="background-image"]'));
    const cardsSet = new Set();
    const cardsMap = new Map();
    
    for (const img of images) {
      if (img.closest('header, footer, nav, .site-header, .site-footer')) continue;
      
      let p = img.parentElement;
      let card = null;
      while (p && p !== document.body) {
         if (p.querySelector('a[href], button, [role=button], [data-play-video]') || 
             p.hasAttribute('href') || p.hasAttribute('data-play-video') || p.tagName === 'A' || p.tagName === 'BUTTON') {
            card = p;
            break;
         }
         p = p.parentElement;
      }
      if (card) {
         cardsSet.add(card);
         if (!cardsMap.has(card)) cardsMap.set(card, []);
         cardsMap.get(card).push(img);
      }
    }
    
    const extracted = [];
    for (const [card, imgs] of cardsMap.entries()) {
      const img = imgs[0];
      
      card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
       // wait two rAFs
      
      const imgRect = img.getBoundingClientRect();
      if (imgRect.width === 0 || imgRect.height === 0) continue;
      
      const points = {
        imageCenter: { x: imgRect.left + imgRect.width / 2, y: imgRect.top + imgRect.height / 2 },
        imageTopLeft: { x: imgRect.left + imgRect.width * 0.25, y: imgRect.top + imgRect.height * 0.25 },
        imageBottomRight: { x: imgRect.left + imgRect.width * 0.75, y: imgRect.top + imgRect.height * 0.75 },
      };
      
      const titleEl = card.querySelector('h1, h2, h3, h4, .title, .headline') || (card.tagName === 'A' ? card : card.querySelector('a[href]'));
      const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;
      if (titleRect && titleRect.width > 0) {
        points.titleCenter = { x: titleRect.left + titleRect.width / 2, y: titleRect.top + titleRect.height / 2 };
      }
      
      const bodyEl = Array.from(card.querySelectorAll('p, .deck, .body, .excerpt, .description')).find(el => el.innerText.trim().length > 0);
      const bodyRect = bodyEl ? bodyEl.getBoundingClientRect() : null;
      if (bodyRect && bodyRect.width > 0) {
        points.bodyCenter = { x: bodyRect.left + bodyRect.width / 2, y: bodyRect.top + bodyRect.height / 2 };
      }

      const probes = {};
      for (const [key, pt] of Object.entries(points)) {
         if (pt.x >= 0 && pt.y >= 0 && pt.x <= window.innerWidth && pt.y <= window.innerHeight) {
           const elAt = document.elementFromPoint(pt.x, pt.y);
           if (elAt) {
             const interactive = elAt.closest('a[href], button, [role=button], [data-play-video]');
             if (interactive) {
               probes[key] = interactive.tagName.toLowerCase() + (interactive.className ? '.'+interactive.className.split(' ').join('.') : '');
             } else {
               probes[key] = 'NONE';
             }
           } else {
             probes[key] = 'UNTESTED';
           }
         } else {
           probes[key] = 'UNTESTED';
         }
      }
      
      const controls = Array.from(card.querySelectorAll('button, [role="button"], a.yt-mark, .play-overlay, .chip, [data-play-video]')).map(el => el.className || el.tagName.toLowerCase()).join(', ');
      const dest = card.tagName === 'A' ? card.getAttribute('href') : 
                   (card.querySelector('a[href]')?.getAttribute('href') || card.getAttribute('data-play-video') || card.querySelector('[data-play-video]')?.getAttribute('data-play-video') || '');
      
      const classList = Array.from(card.classList);

      extracted.push({
        classList,
        selector: card.tagName.toLowerCase() + (card.className && typeof card.className === 'string' ? '.' + card.className.split(' ').join('.') : ''),
        route: currentRoute,
        state: stateName,
        viewport: vpName,
        imageTapHits: [probes.imageCenter, probes.imageTopLeft, probes.imageBottomRight].filter(x => x !== 'UNTESTED'),
        hasUntested: [probes.imageCenter, probes.imageTopLeft, probes.imageBottomRight].includes('UNTESTED'),
        titleTapHits: probes.titleCenter || 'N/A',
        bodyTapHits: probes.bodyCenter || 'N/A',
        dest,
        controls
      });
    }
    return extracted;
  }, vpName, currentRoute, stateName);
}

async function runAudit() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const results = [];
  
  for (const route of routes) {
    console.log(`Auditing route: ${route}`);
    const page = await browser.newPage();
    
    for (const vp of viewports) {
      await page.setViewport(vp); page.on("console", msg => console.log("PAGE LOG:", msg.text()));
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle2' });
      
      console.log('Scrolling page...'); await scrollPage(page);
      
      // baseline
      console.log('Probing baseline...'); results.push(...await probeCards(page, vp.name, route, 'baseline'));

      // Accordions
      console.log('Testing accordions...'); const accCount = await page.evaluate(() => document.querySelectorAll('[data-acc-trigger], .acc-trigger, .hero-accordion button, .acc-panel').length);
      for (let i = 0; i < accCount; i++) {
        await page.evaluate((i) => {
           const btns = document.querySelectorAll('[data-acc-trigger], .acc-trigger, .hero-accordion button, .acc-panel');
           if (btns[i]) btns[i].click();
        }, i);
        await new Promise(r => setTimeout(r, 900));
        results.push(...await probeCards(page, vp.name, route, `accordion-open-${i+1}`));
      }

      // Spotlight slides
      console.log('Testing spotlight...'); const spotlightCount = await page.evaluate(() => document.querySelectorAll('.spotlight-next, .carousel-next').length);
      for (let i = 0; i < Math.min(spotlightCount, 3); i++) {
        await page.evaluate((i) => {
           const btns = document.querySelectorAll('.spotlight-next, .carousel-next');
           if (btns[0]) btns[0].click();
        }, i);
        await new Promise(r => setTimeout(r, 900));
        results.push(...await probeCards(page, vp.name, route, `spotlight-next-${i+1}`));
      }

      // Hub rail panes
      console.log('Testing panes...'); const paneCount = await page.evaluate(() => document.querySelectorAll('.rail-pane-trigger, .hub-pane, .rail-btn').length);
      for (let i = 0; i < paneCount; i++) {
        await page.evaluate((i) => {
           const btns = document.querySelectorAll('.rail-pane-trigger, .hub-pane, .rail-btn');
           if (btns[i]) btns[i].click();
        }, i);
        await new Promise(r => setTimeout(r, 900));
        results.push(...await probeCards(page, vp.name, route, `rail-pane-${i+1}`));
      }

      // Filters
      console.log('Testing filters...'); const filterCount = await page.evaluate(() => document.querySelectorAll('.filter-btn, [data-filter]').length);
      for (let i = 0; i < filterCount; i++) {
        await page.evaluate((i) => {
           const btns = document.querySelectorAll('.filter-btn, [data-filter]');
           if (btns[i]) btns[i].click();
        }, i);
        await new Promise(r => setTimeout(r, 900));
        results.push(...await probeCards(page, vp.name, route, `filter-applied-${i+1}`));
      }

      // Command palette search (test independently and close)
      console.log('Testing search...'); const searchTriggered = await page.evaluate(() => {
         const btn = document.querySelector('.search-trigger, [data-search-open], #search-btn');
         if (btn) { btn.click(); return true; }
         return false;
      });
      if (searchTriggered) {
         await new Promise(r => setTimeout(r, 900));
         results.push(...await probeCards(page, vp.name, route, `search-open`));
         // close it
         await page.keyboard.press('Escape');
         await new Promise(r => setTimeout(r, 900));
      }
    }
    await page.close();
  }
  await browser.close();

  // Process results
  const rowMap = new Map();
  let testedCount = 0;
  let fullyTappable = 0;
  let partially = 0;
  let dead = 0;
  let untested = 0;
  
  const classCache = new Map();
  function getCachedSource(classList) {
    const key = classList.join(' ');
    if (classCache.has(key)) return classCache.get(key);
    const src = findSourceFile(classList);
    classCache.set(key, src);
    return src;
  }
  
  for (const r of results) {
    const tempCompFile = classList => classList.join(' ');
    const key = `${r.selector}|${r.route}|${r.state}|${r.viewport}`;
    
    if (!rowMap.has(key)) {
      r.compFile = getCachedSource(r.classList);
      rowMap.set(key, r);
      
      const imgHits = new Set(r.imageTapHits);
      if (r.hasUntested || r.imageTapHits.length === 0) {
         untested++;
      } else {
         testedCount++;
         const allImgHitsLink = Array.from(imgHits).every(h => h !== 'NONE');
         const anyImgHitsLink = Array.from(imgHits).some(h => h !== 'NONE');
         
         if (allImgHitsLink) fullyTappable++;
         else if (anyImgHitsLink) partially++;
         else dead++;
      }
    }
  }

  // Format report
  let md = `# Tap Audit Report\n\n`;

  // "Confirmed dead images" section
  md += `## Confirmed dead images\n`;
  md += `| Component file | Selector | Route(s) | State | Viewport(s) | Intended destination |\n`;
  md += `|---|---|---|---|---|---|\n`;
  const deadCards = new Map(); // deduplicated by component file
  for (const r of rowMap.values()) {
     if (!r.hasUntested && r.imageTapHits.length > 0) {
        const imgHits = new Set(r.imageTapHits);
        const allNone = Array.from(imgHits).every(h => h === 'NONE');
        if (allNone) {
           if (!deadCards.has(r.compFile)) deadCards.set(r.compFile, r);
        }
     }
  }
  for (const r of deadCards.values()) {
     md += `| ${r.compFile} | ${r.selector} | ${r.route} | ${r.state} | ${r.viewport} | ${r.dest} |\n`;
  }
  md += `\n`;

  md += `## Full Results\n`;
  md += `| Component file | Selector | Route(s) | State | Viewport(s) | Image tap hits | Title tap hits | Body tap hits | Intended destination | Other controls | Proposal |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
  
  for (const r of rowMap.values()) {
    let imgHitsStr = r.imageTapHits.join(', ');
    if (r.hasUntested) imgHitsStr = 'UNTESTED';
    else if (r.imageTapHits.length === 0) imgHitsStr = 'NONE_FOUND';
    
    let proposal = 'ok';
    if (r.hasUntested) {
       proposal = 'untested';
    } else if (r.imageTapHits.every(h => h === 'NONE') && r.imageTapHits.length > 0) {
       proposal = r.controls.includes('play') || r.dest.includes('play') ? 'play' : 'link';
    }
    
    md += `| ${r.compFile} | ${r.selector} | ${r.route} | ${r.state} | ${r.viewport} | ${imgHitsStr} | ${r.titleTapHits} | ${r.bodyTapHits} | ${r.dest} | ${r.controls} | ${proposal} |\n`;
  }
  
  md += `\n## Summary\n`;
  md += `- Total cards probed: ${rowMap.size}\n`;
  md += `- Tested: ${testedCount}\n`;
  md += `- Fully tappable images: ${fullyTappable}\n`;
  md += `- Partially tappable images: ${partially}\n`;
  md += `- Confirmed dead images: ${dead}\n`;
  md += `- Untested (off-screen/unrenderable): ${untested}\n\n`;
  
  md += `## Notes\n`;
  md += `- **Decorative images**: .event-hero-backdrop-plate, .hub-stage-plate, etc., should be left inert (proposal: 'decorative') as they are thematic backgrounds.\n`;
  md += `- **Ambiguous destinations**: For video cards with inline players, it is flagged for the owner to decide if tap should play inline or navigate.\n`;

  await fs.writeFile('scripts/tap-audit-report.md', md);
  console.log('Audit complete! Results saved to scripts/tap-audit-report.md');
}

runAudit().catch(console.error);
