# Project Handoff: Be Unconventional HQ (V2 Cinematic Interaction)

## Current Status
We have successfully implemented a high-end "Editorial Kinetic Stack" identity system that transitions from the Hero section into the Navbar on scroll. The site architecture is stable, performance-focused (Astro static), and all core pages (Videos, Articles, About, Contact, Events, Category Hubs) are built.

## Key Accomplishments (Gemini Branch)
1.  **Identity Morph:** The branding now physically "compresses" from a large, layered 3-line stack in the Hero into a compact, interactive stack in the Navbar.
2.  **Kinetic Typography:**
    *   **Hero:** "BE" (top-left), "UNCONVENTIONAL" (center), and "HQ" (bottom-right) overlap with cinematic depth.
    *   **Navbar:** The compact stack unfolds into a single line on hover, rewarding user exploration.
3.  **Dynamic Context:** A page-specific "Editorial Subline" (e.g., CINEMATIC VAULT) reveals itself beneath the Navbar branding via a parallax effect as the user scrolls.
4.  **Performance:** All animations are GPU-accelerated (`transform`, `opacity`, `filter`). Staggered "template" reveals have been replaced with a unified center-weighted grid emergence.
5.  **Substack Integration:** The Articles page and Category Hubs fetch and filter real Substack content at build time.

## Known Issues / Stabilization Needed
- **Navbar Hover Flicker:** The transition between the stacked and single-line state in the Navbar can be finicky if the mouse is at the edge of the hit area.
    *   *Solution Recommendation:* Increase the `padding` buffer on `.nav-identity-wrapper` and ensure `min-width` is set to the width of the expanded state to prevent the layout from snapping back and forth.
- **Hero Alignment:** The specific offsets for "BE" and "HQ" need to be rock-solid to ensure they converge exactly on the center axis during the scroll compression.

## Architectural Notes for Claude
- **CSS Variable Driven:** The entire interaction is driven by `--hero-compress-progress` (0 to 1), calculated in `Hero.astro`.
- **Global Consistency:** Terminology has been unified to "Explore The HQ" across the site.
- **Base Path:** Always use `import.meta.env.BASE_URL` for links/assets (GitHub Pages support).

## Handoff Directive
Please focus on **stabilizing the interaction timings** and ensuring the **Hero Stack alignment** is visually perfect across mobile and desktop. Maintain the "Unconventional" layering—the overlap is intentional and should feel like high-end editorial print design.

---
**Branch:** `gemini`
**Latest Build Status:** Verified Stable.
