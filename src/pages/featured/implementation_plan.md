# Fixing the 4K Centering Bug on Featured Hubs

## Goal
Fix the layout regression on the Featured Hubs page where the content (Header, Grid, and CTA banner) is pushed to the left side of the screen on ultra-wide / 4K viewports.

## Analysis of the Bug
The root cause is a known Flexbox rendering quirk in modern browsers. 
Because we converted the `<main>` tag into a Flex column (`flex-col`) to push the footer to the bottom, all direct children of `<main>` became Flex Items. 

When a Flex Item has `w-full` (width: 100%), `max-w-screen-2xl` (max-width: 1536px), and `mx-auto` (margin: auto), the browser's flex engine struggles to compute the remaining horizontal space correctly on viewports larger than the `max-width`. Instead of centering the 1536px container, it pins it to the left edge of the screen.

## Proposed Changes
Instead of relying on `mx-auto` for horizontal centering inside a flex column, we must use Flexbox's native cross-axis alignment (`align-self: center`).

1. **Update `src/pages/featured/index.astro`**
   - Replace `mx-auto` with `self-center` on the main content wrapper.
   - Replace `mx-auto` with `self-center` on the CTA banner wrapper.
   
2. **Review `/feed` and `/events` Routes**
   - Apply the same `self-center w-full max-w-screen-2xl` pattern to ensure the bug doesn't replicate on the other pages I just updated.
   - Also, fix the About page bottom padding (`padding-bottom` / `margin-bottom` spacing) as requested in your previous instruction which was missed.

## Open Questions / User Review Required
> [!IMPORTANT]
> The `self-center` utility is the definitive fix for 4K centering inside flex columns. Does this implementation plan sound good to proceed?
