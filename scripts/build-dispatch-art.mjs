/**
 * THE HQ DISPATCH's two fixed images, rendered by headless Chrome so they
 * carry the site's real display font (Syne) and logo, which the email itself
 * cannot load (issue #266 rules out web fonts in the email):
 *
 *   public/dispatch/header-v2-1200x400.png the masthead, 3:1, shown at 600x200
 *                                          (header-1200x400.png, the first one
 *                                          with the logo, is kept: never delete
 *                                          an image an email may point at)
 *   public/dispatch/fallback-1200x675.jpg  a story's art when it has none of
 *                                          its own, 16:9, so the FEATURED box
 *                                          always opens on a full-width image
 *                                          (owner's call)
 *
 * Both are committed. Re-run only when the design changes:
 *   node scripts/build-dispatch-art.mjs
 *
 * Design is the site's: #0a0a0a ground, the #cc0000 brand glow from the top
 * right (BrandGlow.astro), the PageTitle lockup (red spaced kicker, heavy
 * uppercase title, a red word tucked under it with a glow).
 */
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { DISPATCH_FALLBACK_IMAGE, DISPATCH_HEADER_IMAGE } from '../src/lib/dispatch-feed.ts';

const ROOT = new URL('../', import.meta.url);
const read64 = async (path) => (await fs.readFile(new URL(path, ROOT))).toString('base64');

const syne = await read64('public/fonts/syne.woff2');
const inter = await read64('public/fonts/inter.woff2');
const logo = (await sharp(new URL('src/assets/logo-mark.webp', ROOT).pathname).png().toBuffer()).toString('base64');

const base = `
  @font-face { font-family: Syne; src: url(data:font/woff2;base64,${syne}) format('woff2'); font-weight: 400 800; }
  @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    background:
      radial-gradient(circle at 100% 0%, rgba(204,0,0,0.30) 0%, rgba(204,0,0,0.09) 30%, rgba(204,0,0,0) 62%),
      radial-gradient(circle at 0% 100%, rgba(204,0,0,0.08) 0%, rgba(204,0,0,0) 45%),
      #0a0a0a;
    color: #f0f0f0;
    overflow: hidden;
  }
  .kicker { font-family: Inter, sans-serif; font-weight: 600; color: #ef4444; text-transform: uppercase; }
  .title { font-family: Syne, sans-serif; font-weight: 800; text-transform: uppercase; line-height: 0.95; }
  .hq { color: #cc0000; text-shadow: 0 0 28px rgba(204,0,0,0.55); }
`;

/* The masthead is THE HQ DISPATCH lockup alone, centred. It used to carry
   the logo beside it, which made three brand marks in a row (the top bar's
   "BE UNCONVENTIONAL HQ", the logo, then this lockup), and the logo's tagline
   was unreadable at phone width (owner's call). The publisher is named once,
   in the email's top bar. */
const header = `<!doctype html><html><head><style>${base}
  body { display: flex; align-items: center; justify-content: center; padding: 0 64px; }
  /* flex: none and nowrap: Syne is wide, and a shrinking column is what
     wrapped THE HQ onto two lines and pushed DISPATCH off the frame. */
  .lockup { display: flex; flex-direction: column; align-items: center; flex: none; white-space: nowrap; text-align: center; }
  .kicker { font-size: 24px; letter-spacing: 0.3em; margin-bottom: 18px; color: #ff6b6b; font-weight: 700; }
  .title { font-size: 104px; letter-spacing: 0.01em; }
  .title .hq { display: block; font-size: 72px; margin-top: 6px; }
</style></head><body>
  <div class="lockup">
    <div class="kicker">Every week</div>
    <div class="title">The HQ<span class="hq">Dispatch</span></div>
  </div>
</body></html>`;
const fallback = `<!doctype html><html><head><style>${base}
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #111111; }
  .logo { width: 620px; }
  .kicker { font-size: 22px; letter-spacing: 0.4em; margin-top: 40px; }
</style></head><body>
  <img class="logo" src="data:image/png;base64,${logo}" alt="">
  <div class="kicker">The HQ Dispatch</div>
</body></html>`;

// Containers that run as root need PUPPETEER_NO_SANDBOX=1.
const browser = await puppeteer.launch({ headless: true, args: process.env.PUPPETEER_NO_SANDBOX ? ['--no-sandbox'] : [] });
try {
  const page = await browser.newPage();
  const shoot = async (html, width, height) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    /* Nothing may be cut off (owner's rule): refuse to write an image whose
       lettering or logo runs past the frame, with a margin to spare. */
    const overflow = await page.evaluate((w, h) => {
      const margin = 40;
      return [...document.querySelectorAll('.logo, .kicker, .title, .hq')]
        .map((el) => ({ cls: el.className, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.left < margin || r.top < margin || r.right > w - margin || r.bottom > h - margin)
        .map(({ cls, r }) => `${cls} ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`);
    }, width, height);
    if (overflow.length) throw new Error(`art runs past the ${width}x${height} frame: ${overflow.join('; ')}`);
    return page.screenshot({ type: 'png' });
  };

  await fs.mkdir(new URL('public/dispatch/', ROOT), { recursive: true });

  const headerPng = await sharp(await shoot(header, 1200, 400)).png({ compressionLevel: 9, palette: false }).toBuffer();
  await fs.writeFile(new URL(`public${DISPATCH_HEADER_IMAGE}`, ROOT), headerPng);
  console.log(`wrote public${DISPATCH_HEADER_IMAGE} (${(headerPng.length / 1024).toFixed(0)} KB)`);

  const fallbackJpg = await sharp(await shoot(fallback, 1200, 675)).jpeg({ quality: 86, progressive: true, mozjpeg: true }).toBuffer();
  await fs.writeFile(new URL(`public${DISPATCH_FALLBACK_IMAGE}`, ROOT), fallbackJpg);
  console.log(`wrote public${DISPATCH_FALLBACK_IMAGE} (${(fallbackJpg.length / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
}
