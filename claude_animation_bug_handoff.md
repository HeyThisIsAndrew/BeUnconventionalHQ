# Read Less Animation Bug - Handoff for Claude

## The Bug
When a user clicks "Read less" on the expandable hero description text (`#event-about-text`), the collapse animation is extremely jarring. It visibly "bounces" and flashes before collapsing down to the `3em` value.

## The Root Cause
The bug occurs in this block of code:
```javascript
} else {
  expanded = false;
  // Pin the current full height (handles max-height:none), then animate
  // down to the collapsed value on the next frame.
  text.style.maxHeight = text.scrollHeight + 'px';
  void text.offsetHeight; // force reflow so the start height registers
  requestAnimationFrame(() => {
    text.style.maxHeight = COLLAPSED_MAX;
  });
  // ...
}
```

When expanded, `text.style.maxHeight` is set to `none`. 
When the user clicks "Read less", you set `maxHeight = text.scrollHeight + 'px'`. Because the element has `transition: max-height 0.45s` applied in CSS, the browser attempts to interpolate a transition from `none` to `120px` (or whatever the scroll height is). 

Since browsers cannot mathematically interpolate `none`, it treats the starting value as `0`. Therefore, the browser instantly snaps the element to `0px` and begins animating *up* to `120px`. 
However, in the very next frame (via `requestAnimationFrame`), you change the target `maxHeight` to `3em`. The browser is now caught trying to animate an element that started at 0, was targeting 120, and is now targeting 48. This results in the violent "bounce" or "flash" the user is seeing.

## The Fix
You must explicitly disable CSS transitions while pinning the starting height, and you must ensure the browser *paints* that non-transitioned height before you re-enable the transition and collapse it. 

Because `requestAnimationFrame` executes *before* the layout paint, putting `transition = ''` inside a single `rAF` allows the browser to batch the style changes, meaning the `transition: none` is effectively ignored. You must use a double `requestAnimationFrame` (or a `setTimeout`) to yield to the browser's paint cycle.

```javascript
// 1. Disable transition
text.style.transition = 'none';
// 2. Pin current height
text.style.maxHeight = text.getBoundingClientRect().height + 'px';
// 3. Force reflow
void text.offsetHeight; 

// 4. Wait for the browser to paint the pinned height, THEN re-enable transition and collapse
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    text.style.transition = '';
    text.style.maxHeight = COLLAPSED_MAX;
  });
});
```

Please implement this fix in `src/pages/events-new/[slug].astro`.
