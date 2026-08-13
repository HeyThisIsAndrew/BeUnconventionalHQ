/**
 * ─── KEEP FIXED CONTROLS TAPPABLE WHEN SAFARI RESIZES THE WEB VIEW ──────────
 *
 * THE REPORT THAT PINNED THIS DOWN
 * "In landscape the hamburger and the X are difficult to press… at the moment
 * that I closed all the tabs, it stopped happening." iPhone, iOS Safari.
 *
 * That detail is the whole diagnosis. With more than one tab open, Safari on
 * iPhone shows a tab bar in landscape, and that tab bar COLLAPSES as you
 * scroll down and expands again as you scroll up. Each collapse resizes the
 * web view. With a single tab there is no tab bar, nothing resizes, and the
 * buttons behave — which is exactly what was observed.
 *
 * iOS Safari does not reliably re-hit-test `position: fixed` elements after
 * that resize. They are PAINTED in the right place and their touch region is
 * left at the old one, so the reader presses what they can see and nothing
 * happens. Every control this was reported against is fixed or fixed-anchored:
 * #navbar (and the hamburger/X inside it), .modal-close in landscape, and
 * .close-fullscreen-btn inside the viewport-fixed category overlay.
 *
 * WHAT THIS DOES
 * `visualViewport` fires `resize`/`scroll` exactly when the browser chrome
 * changes — that is the signal, and it is the only reliable one; a window
 * `resize` does not fire for a chrome collapse. On each one:
 *
 *   1. Publishes the visual viewport's top offset as `--vv-top`, so any
 *      control that needs to sit below overlaying chrome can use it in CSS.
 *   2. Forces each fixed control's box to be recomputed, and with it its hit
 *      region, by writing a genuine sub-pixel layout mutation and reverting it
 *      on the NEXT frame.
 *
 * WHY THE MUTATION HAS TO BE REAL, AND REVERTED A FRAME LATER
 * The first version of this wrote each element's own computed `top` back onto
 * it and read `offsetHeight`, then restored the value in the same tick. That
 * is very likely a no-op: writing a property its used value already equals,
 * and reverting before the frame ends, gives the engine nothing to invalidate,
 * so the stale hit region survives. Credit to the Antigravity audit for
 * catching it.
 *
 * `padding-bottom: 0.1px` is a value the element does NOT already have, so the
 * box genuinely changes; reverting on the next animation frame means a layout
 * pass actually happens in between. 0.1px on a fixed control is below the
 * threshold of anything visible, and the control is out of flow, so nothing
 * else moves with it.
 *
 * NOT a transform: #navbar's transform is owned by the splash curtain
 * (`html.splash-armed #navbar { transform: translateY(-100%) }`) and stamping
 * `translateZ(0)` over it would break the reveal.
 *
 * NOT VERIFIABLE HERE. Chromium hit-tests fixed elements correctly, so neither
 * version can be shown to fix the WebKit symptom from this sandbox. What the
 * test asserts is that the correction runs, is bound to the right signal, and
 * leaves every control's geometry and inline styles exactly as it found them.
 *
 * COST, AND THE GATE THAT KEEPS IT DOWN
 * `visualViewport.scroll` fires continuously while a phone scrolls, and a
 * layout write per frame during scrolling is the exact thrash this is meant to
 * avoid — an earlier version had no gate, and with `.modal-overlay` still in
 * the list (it carries `transition: all 0.4s`) each write also started a 400ms
 * transition. Both found by the Antigravity audit.
 *
 * So the nudge only runs when the viewport GEOMETRY actually changed — size,
 * offset or scale. Those are the only things that stale a hit region; if none
 * of them moved there is nothing to invalidate and the pass is a string
 * compare. Hidden controls are skipped for the same reason: a closed overlay
 * has no hit region to fix, and writing to it can only start animations nobody
 * asked for.
 *
 * VERIFIED BY `scripts/e2e-viewport-anchor.test.mjs`, which fires the same
 * events and asserts every control keeps its exact position and inline styles.
 * Chromium cannot reproduce the stale-hit-region behaviour itself, so what is
 * testable here is that the correction runs, is bound to the right signals,
 * and disturbs nothing.
 */

/**
 * Controls that are fixed, or fixed-anchored, and were reported as untappable.
 *
 * `.modal-overlay` is deliberately NOT here. It carries
 * `transition: all 0.4s` (modal.css), so the 0.1px padding write below would
 * start a 400ms transition on it every time this runs — on an element that is
 * usually closed and invisible, from a handler bound to scroll. Found by the
 * Antigravity audit. It is the backdrop, not a control; `.modal-close` is the
 * button that was actually reported, and it is still covered.
 *
 * Before adding anything here, check what it transitions.
 */
const FIXED_CONTROLS = '#navbar, .nav-toggle, .modal-close, .close-fullscreen-btn';

let bound = false;

export function keepFixedControlsTappable(): void {
  if (bound) return;
  const vv = window.visualViewport;
  if (!vv) return;
  bound = true;

  let queued = false;
  /* The viewport geometry the hit regions were last corrected for. */
  let lastGeometry = '';

  const refresh = () => {
    queued = false;

    /*
      ONLY NUDGE WHEN THE VIEWPORT ACTUALLY CHANGED.

      `visualViewport.scroll` fires continuously while the page moves on a
      phone, and a layout write per frame during scrolling is exactly the
      thrash this is supposed to avoid. But hit regions only go stale when the
      viewport GEOMETRY changes — a chrome collapse, a rotation, a pinch. If
      none of those numbers moved, there is nothing to invalidate, so the
      whole pass is a string compare.
    */
    const geometry = `${vv.width}x${vv.height}@${vv.offsetTop},${vv.offsetLeft},${vv.scale}`;
    const geometryChanged = geometry !== lastGeometry;
    lastGeometry = geometry;

    /* Publish the offset even when it is 0 — a stylesheet reading
       `var(--vv-top)` should get a real length rather than falling back. */
    const offsetTop = Math.max(0, Math.round(vv.offsetTop));
    document.documentElement.style.setProperty('--vv-top', `${offsetTop}px`);

    if (!geometryChanged) return;

    /* A value the element does NOT already have, so the box genuinely changes
       and the engine has something to invalidate. Skips anything not currently
       rendered: a closed overlay has no hit region to correct, and writing to
       it can only start transitions nobody asked for. */
    const nudged: Array<[HTMLElement, string]> = [];
    for (const el of document.querySelectorAll<HTMLElement>(FIXED_CONTROLS)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      nudged.push([el, el.style.paddingBottom]);
      el.style.paddingBottom = '0.1px';
    }
    if (!nudged.length) return;

    /* Reverted on the NEXT frame, so a layout pass lands in between — that gap
       is the entire point, and reverting in the same tick is what made the
       previous version a no-op. Collected first and reverted in one callback
       rather than one rAF per element. */
    requestAnimationFrame(() => {
      for (const [el, previous] of nudged) el.style.paddingBottom = previous;
    });
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(refresh);
  };

  /* `resize` is the chrome collapsing or expanding; `scroll` on the visual
     viewport fires when it is panned independently of the layout viewport,
     which is the other way these two fall out of step. */
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);

  /*
    ─── ROTATION, WHICH IS THE SAME BUG WITH A DIFFERENT TRIGGER ─────────────

    Reported: load the site, press ENTER THE HQ, THEN rotate to landscape —
    the navbar and the X stop responding. Starting in landscape is fine. The
    difference is not the orientation, it is that the viewport was resized
    after the controls were laid out, which is exactly the condition that
    leaves fixed elements hit-tested at their old coordinates.

    Two things were missing:

    1. `orientationchange` and window `resize` were not listened to at all.
       `visualViewport.resize` is documented to cover this, but it is the same
       engine that is failing to re-hit-test in the first place — relying on
       one signal from it, for a bug in it, is optimistic. These are cheap.

    2. A rotation is ANIMATED, roughly 300ms on iOS. A correction that runs on
       the first event runs against a layout that is still moving, and the
       final geometry never gets a pass. So the refresh is repeated across the
       settling window rather than fired once.

    The repeats are idempotent — each is a 0.1px padding write on a handful of
    elements, reverted on the next frame — so an extra one costs nothing and a
    missed one costs the reader a dead button.
  */
  const SETTLE_MS = [0, 120, 320, 600];
  const refreshUntilSettled = () => {
    for (const delay of SETTLE_MS) {
      if (delay === 0) schedule();
      else setTimeout(schedule, delay);
    }
  };

  window.addEventListener('orientationchange', refreshUntilSettled);
  window.addEventListener('resize', refreshUntilSettled);

  refresh();
}
