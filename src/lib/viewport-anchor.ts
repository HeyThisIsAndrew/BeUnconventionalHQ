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
 *   2. Touches each fixed control's `top` and reads layout back, which forces
 *      the engine to re-establish the element's box — and with it, its hit
 *      region. The value is restored in the same frame, so nothing moves.
 *
 * WHY A NUDGE AND NOT A TRANSFORM
 * The usual trick for this is `translateZ(0)` to re-promote the layer, but
 * #navbar's transform is already owned by the splash curtain
 * (`html.splash-armed #navbar { transform: translateY(-100%) }`) and stamping
 * over it would break the reveal. Touching `top` is inert here: the value
 * written is the one already computed, and it is cleared immediately.
 *
 * COST WHEN NONE OF THIS APPLIES
 * Nothing. `visualViewport` resize does not fire on a desktop browser sitting
 * still, and the handler is a few reads on a handful of elements when it does.
 * On any engine that hit-tests correctly the nudge is a no-op that changes no
 * pixels.
 *
 * VERIFIED BY `scripts/e2e-viewport-anchor.test.mjs`, which fires the same
 * events and asserts every control keeps its exact position and stays
 * reachable. Chromium cannot reproduce the stale-hit-region behaviour itself —
 * it hit-tests these correctly — so what is testable here is that the
 * correction runs, is bound to the right signal, and disturbs nothing.
 */

/** Controls that are fixed, or fixed-anchored, and were reported as untappable. */
const FIXED_CONTROLS = '#navbar, .nav-toggle, .modal-overlay, .modal-close, .close-fullscreen-btn';

let bound = false;

export function keepFixedControlsTappable(): void {
  if (bound) return;
  const vv = window.visualViewport;
  if (!vv) return;
  bound = true;

  let queued = false;

  const refresh = () => {
    queued = false;

    /* Publish the offset even when it is 0 — a stylesheet reading
       `var(--vv-top)` should get a real length rather than falling back. */
    const offsetTop = Math.max(0, Math.round(vv.offsetTop));
    document.documentElement.style.setProperty('--vv-top', `${offsetTop}px`);

    for (const el of document.querySelectorAll<HTMLElement>(FIXED_CONTROLS)) {
      const inlineTop = el.style.top;
      /* Write the value the element already has, so the box does not move,
         then read layout back to force the engine to re-resolve it. */
      el.style.top = getComputedStyle(el).top;
      void el.offsetHeight;
      /* Restore in the same frame — before anything can paint. */
      el.style.top = inlineTop;
    }
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

  refresh();
}
