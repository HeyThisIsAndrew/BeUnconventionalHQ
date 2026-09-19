/**
 * ─── THE HERO BACKDROP IS ASKED FOR SMALL, BECAUSE IT IS ALWAYS BLURRED ─────
 *
 * `.hero-bg-inner` carries `filter: blur(30px) saturate(1.05) brightness(0.5)`
 * (hero.css) and never drops it. The picture behind the homepage hero is
 * therefore never seen sharp by anyone, at any breakpoint.
 *
 * It was shipping as the RAW import — `bannerImg.src`, straight out of
 * `src/assets/banner.webp` at 960x540 and 32.1 KB — with no pass through the
 * image pipeline at all. Worse, it is `fetchpriority="high"`, `loading="eager"`
 * and `<link rel="preload">`ed from index.astro, so those bytes sit at the
 * front of the critical path on a phone for detail a 30px blur destroys before
 * a single pixel reaches the screen.
 *
 * This is the convention the rest of the site already follows and this one
 * asset missed. CLAUDE.md states it for hub backdrops: "It is blurred past any
 * detail and drifts slowly, so it is always requested SMALL (640px on
 * /featured, 900px on a hub page). Never source it from video thumbnails."
 * Same reasoning, same number.
 *
 * ─── WHY IT LIVES IN ITS OWN MODULE ────────────────────────────────────────
 *
 * TWO files need the identical URL: Hero.astro paints it and index.astro
 * preloads it. A preload whose href does not byte-match the src the browser
 * ends up requesting is a second download, not a head start — which is exactly
 * the failure mode `scripts/lcp-preload.test.mjs` exists to catch, and exactly
 * what the `crossorigin` mismatch did to the wsrv.nl preconnect. Deriving it
 * once here makes the two impossible to drift apart, rather than relying on
 * two `getImage()` calls being kept in step by hand.
 *
 * Quality 70 rather than the site's usual 78-90: this is the one image where
 * compression artefacts cannot be seen, because the blur is larger than any
 * artefact it could produce.
 */
import { getImage } from 'astro:assets';
import bannerImg from '../assets/banner.webp';

/**
 * The homepage hero's blurred backdrop, sized for the blur rather than for the
 * viewport. Use `.src` for BOTH the `<img>` and the preload.
 */
export const heroBanner = await getImage({
  src: bannerImg,
  width: 640,
  format: 'webp',
  quality: 70,
});
