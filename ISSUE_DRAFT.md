# Z-Axis Depth Transition Prototype & Astro View Transitions

## Overview
Implement a high-performance "Z-Axis Depth Transition" prototype and native Astro View Transitions for Be Unconventional HQ. The goal is to provide a premium, 60fps compositor-only transition experience (using `transform` and `opacity`) across all devices while strictly adhering to performance budgets.

## Technical Specifications
- **Framework**: Astro, Tailwind CSS, Vanilla JS
- **View Transitions**: Astro `<ViewTransitions />` API
- **Performance Budget**: < 50ms main thread blocking time. >90% mobile Lighthouse, >95% desktop Lighthouse.
- **Animations**: Compositor-only (`transform: scale3d`, `transform: translate3d`, `opacity`). Utilize `will-change: transform, opacity;` dynamically.
- **A11y**: Enforce `@media (prefers-reduced-motion: reduce)` to fall back to an instant cross-fade.

## Acceptance Criteria
- [ ] Astro native View Transitions enabled in Base Layout.
- [ ] Default cross-fades for standard content pages.
- [ ] Homepage "Enter the HQ" button triggers Z-Axis fly-through.
  - Desktop/iPad: Hero scales up `scale3d(4, 4, 1)`, fades to opacity 0.
  - Mobile: Hero scales down `scale3d(0.95, 0.95, 1)`, fades to opacity 0.
  - Main site content slides up into position `translate3d(0, 0, 0)`.
  - DOM cleanup removes pointer events / adds `display: none` after 800ms.
- [ ] Top-Level Nav Z-Axis Depth Transitions (Slam effect).
- [ ] Tested successfully across Mobile Portrait, Mobile Landscape, iPad Pro, Standard Desktop, 4K Desktop.
- [ ] Zero layout blowouts, scrollbar glitches, or nav bugs.
