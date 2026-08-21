# Featured Hubs: Cinematic 3D Deck Redesign
**Ticket / Feature Spec**

## Overview
The \`/featured/index.astro\` page has been radically redesigned to move away from a traditional flat grid or bento box layout into a fully immersive, full-page cinematic experience. We are utilizing a "split-screen accordion" architecture that transitions into a dynamic 3D card deck with a synchronized right-hand autoplaying metadata panel.

## Architecture

### 1. Full-Page Takeover
* The layout is strictly constrained to \`100vh\`, bypassing standard vertical body scrolling.
* It dynamically accounts for the global navbar height via \`padding-top: var(--header-height)\`.

### 2. Collapsed State (The Accordion)
* **Categories:** Organized into 4 main horizontal strips (The Multiverse, Streamers, Studios, Gaming). Gaming is strictly ordered as PlayStation, Nintendo, Xbox.
* **Branding:** A right-to-left cinematic red bleed (\`linear-gradient\` fading from red to deep black) ensures consistent premium branding across all rows.
* **Typography:** Left-aligned, ultra-bold, tightly kerned cinematic typography (system/Apple-style \`font-weight: 900\`, \`letter-spacing: -0.04em\`).

### 3. Expanded State (The Deck + Metadata)
When a category is clicked, the UI splits into two main columns (50% / 50% split).

#### Left Column: 3D Coverflow Deck
* **Perspective:** Stacked using CSS 3D transforms (\`perspective\`, \`translateZ\`, \`translateX\`).
* **Interaction:** Clicking any card in the back of the deck shuffles it to the front. The cards use \`div\` elements to capture clicks securely, preventing unintended navigation.
* **Visuals:** Sharp, 0px border-radius edges. Deep 3D shadows.
* **Peeking Spines:** Background cards feature a dark gradient spine on their right edge with the brand title printed vertically, ensuring the user knows what they are clicking.
* **Action:** The front-most active card displays a prominent "ENTER HUB" pill overlay.

#### Right Column: Dynamic Info Panel
* **Autoplaying Trailer:** A massive, full-bleed trailer loops endlessly in the background of the right card. It's dynamically injected via JS using the brand's \`trailerUrl\`. It uses the YouTube embed API with \`autoplay=1&mute=1&loop=1&controls=0\`.
* **Performance:** Iframe sources are *only* loaded when the brand becomes active, preventing severe CPU/Memory lag from multiple simultaneous HD iframes.
* **Logo Overlay:** The brand's transparent logo floats beautifully on top of the autoplaying trailer.
* **Content:** Cinematic descriptive text and a secondary "ENTER HUB" button sit in a darkened lower gradient to ensure text contrast over the video.

## Technical Implementation Details
* **Routing Interceptions:** Fixed aggressive Astro \`ClientRouter\` interceptions by separating the shuffle logic onto \`<div>\` wrappers and isolating the \`<a href>\` navigation purely to the explicit action buttons.
* **Z-Index:** The \`.deck-column\` forces a \`z-index: 20\` to prevent the right-hand column from capturing clicks intended for the right edge of the stacked cards.
* **Data Sources:** Uses \`getFeaturedBrandsLocal()\` from \`src/lib/local-content.ts\` for the primary loop, mapping Sanity \`featuredBrand\` documents into the layout.

## Next Steps / "Phase 2" Roadmap for Claude
1. **Mobile Responsiveness (High Priority):** 
   * Currently, the 50/50 split and 3D deck relies on desktop-width scaling.
   * *Proposed Approach:* On mobile (\`< 768px\`), stack vertically. The 3D deck should transition into a standard horizontal scroll-snap track (swipeable), and the info panel should sit beneath it.
2. **Dynamic Descriptions:**
   * Currently using a stylized fallback description since the Sanity schema lacks a robust \`description\` field for \`featuredBrand\`.
   * Update Sanity schema to support \`description\` strings and pull them into the UI.
3. **Data Fetching Refinement:**
   * Improve the youtube ID extractor (\`extractYoutubeId\`) if non-standard URLs are used.
   * If real "featured content" per brand is needed instead of just the \`trailerUrl\`, map it dynamically from \`videos.json\` using tags.
