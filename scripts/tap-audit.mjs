import puppeteer from 'puppeteer';
import fs from 'fs/promises';

const PORT = 4322;
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

async function runAudit() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const results = [];
  
  for (const route of routes) {
    console.log(`Auditing route: ${route}`);
    const page = await browser.newPage();
    
    for (const vp of viewports) {
      await page.setViewport(vp);
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle2' });
      
      // Interactions
      await page.evaluate(async () => {
        // Open accordion panels
        document.querySelectorAll('.acc-trigger, .hero-accordion button, .acc-panel').forEach(btn => btn.click());
        // Advance spotlight
        document.querySelectorAll('.spotlight-next, .carousel-next').forEach(btn => btn.click());
        // Hub rail panes
        document.querySelectorAll('.rail-pane-trigger, .hub-pane, .rail-btn').forEach(btn => btn.click());
        // Filters
        document.querySelectorAll('.filter-btn, [data-filter]').forEach(btn => btn.click());
        // Open command palette (e.g. meta+k or button click)
        document.querySelectorAll('.search-trigger, [data-search-open], #search-btn').forEach(btn => btn.click());
      });
      await new Promise(r => setTimeout(r, 500));
      
      const pageResults = await page.evaluate(async (vpName, currentRoute) => {
        const images = Array.from(document.querySelectorAll('img, picture, [style*="background-image"], .acc-media, .hub-stage-art-fill, [class*="-img"], [class*="-art"], [class*="-photo"], [class*="-logo"], .event-hero-backdrop-plate'));
        const cardsMap = new Map();
        
        for (const img of images) {
          if (img.closest('header, footer, nav, .site-header, .site-footer')) continue;
          let container = img.closest('article, li, .acc-panel, .feed-row-banner, .hub-stage-item, .fw-item, .ihq-item, .card, .tile, .teaser, .event-hero-lockup, .hub-stage');
          if (!container) {
             let p = img.parentElement;
             while (p && p !== document.body && !p.querySelector('a[href], button')) {
               p = p.parentElement;
             }
             container = p !== document.body ? p : img;
          }
          if (container && (container.querySelector('a[href]') || container.tagName === 'A' || container.tagName === 'BUTTON')) {
            if (!cardsMap.has(container)) {
              cardsMap.set(container, []);
            }
            cardsMap.get(container).push(img);
          }
        }
        
        const extracted = [];
        for (const [card, imgs] of cardsMap.entries()) {
          const img = imgs[0];
          card.scrollIntoView({ block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 100)); // wait for layout/lazy
          
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
                 const interactive = elAt.closest('a[href], button, [role=button]');
                 if (interactive) {
                   probes[key] = interactive.tagName.toLowerCase() + (interactive.className ? '.'+interactive.className.split(' ').join('.') : '');
                 } else {
                   probes[key] = 'NONE';
                 }
               } else {
                 probes[key] = 'OUT';
               }
             } else {
               probes[key] = 'OFF';
             }
          }
          
          const controls = Array.from(card.querySelectorAll('button, [role="button"], a.yt-mark, .play-overlay, .chip')).map(el => el.className || el.tagName.toLowerCase()).join(', ');
          const dest = card.tagName === 'A' ? card.getAttribute('href') : card.querySelector('a[href]')?.getAttribute('href') || '';
          
          let compClass = card.className;
          if (typeof compClass === 'string' && compClass.length > 0) {
            compClass = compClass.split(' ')[0]; // use first class as component name loosely
          } else {
            compClass = card.tagName.toLowerCase();
          }

          extracted.push({
            compFile: compClass,
            selector: card.tagName.toLowerCase() + (card.className && typeof card.className === 'string' ? '.' + card.className.split(' ').join('.') : ''),
            route: currentRoute,
            state: 'scrolled',
            viewport: vpName,
            imageTapHits: [probes.imageCenter, probes.imageTopLeft, probes.imageBottomRight].filter(x => x !== 'OFF' && x !== 'OUT'),
            titleTapHits: probes.titleCenter && probes.titleCenter !== 'OFF' ? probes.titleCenter : 'N/A',
            bodyTapHits: probes.bodyCenter && probes.bodyCenter !== 'OFF' ? probes.bodyCenter : 'N/A',
            dest,
            controls
          });
        }
        return extracted;
      }, vp.name, route);
      
      results.push(...pageResults);
    }
    await page.close();
  }
  await browser.close();

  // Deduplicate and process results
  const rowMap = new Map();
  let fullyTappable = 0;
  let partially = 0;
  let notAtAll = 0;
  
  for (const r of results) {
    const key = `${r.compFile}|${r.selector}|${r.route}|${r.state}|${r.viewport}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, r);
      
      // Calculate tappability
      const imgHits = new Set(r.imageTapHits);
      const allImgHitsLink = imgHits.size > 0 && Array.from(imgHits).every(h => h !== 'NONE');
      const anyImgHitsLink = imgHits.size > 0 && Array.from(imgHits).some(h => h !== 'NONE');
      
      if (allImgHitsLink) fullyTappable++;
      else if (anyImgHitsLink) partially++;
      else notAtAll++;
    }
  }

  let md = `# Tap Audit Report\n\n`;
  md += `| Component file | Selector | Route(s) | State | Viewport(s) | Image tap hits | Title tap hits | Body tap hits | Intended destination | Other controls | Proposal |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
  
  for (const r of rowMap.values()) {
    const imgHitsStr = r.imageTapHits.join(', ');
    const proposal = r.imageTapHits.every(h => h === 'NONE') ? (r.controls.includes('play-overlay') ? 'play' : 'link') : 'ok';
    md += `| ${r.compFile} | ${r.selector} | ${r.route} | ${r.state} | ${r.viewport} | ${imgHitsStr} | ${r.titleTapHits} | ${r.bodyTapHits} | ${r.dest} | ${r.controls} | ${proposal} |\n`;
  }
  
  md += `\n## Summary\n`;
  md += `- Total cards probed: ${rowMap.size}\n`;
  md += `- Fully tappable images: ${fullyTappable}\n`;
  md += `- Partially tappable images: ${partially}\n`;
  md += `- Non-tappable images: ${notAtAll}\n\n`;
  md += `## Notes\n`;
  md += `- Images proposed as 'decorative': .hub-stage-plate, .event-hero-backdrop-plate.\n`;
  md += `- Ambiguous destinations: Video cards with inline players. Owner to decide if tap should play inline or navigate.\n`;

  await fs.writeFile('scripts/tap-audit-report.md', md);
  console.log('Audit complete! Results saved to scripts/tap-audit-report.md');
}

runAudit().catch(console.error);
