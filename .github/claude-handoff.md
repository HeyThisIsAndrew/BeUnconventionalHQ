# Be Unconventional HQ - Developer Handoff

## Current Project State & Architecture
- **Tech Stack**: Astro, React, TailwindCSS.
- **Key Feature**: Local Content Management System (CMS) located at `src/components/admin/LocalCmsApp.tsx`.
- **Data Architecture**: The CMS manages `_local_cms_data.json` directly from the filesystem during development, storing nodes (videos, shorts, topics, featuredBrands, events) in an interconnected graph.

## Recent Updates & Stability (Go/No-Go)
The site has undergone rigorous swarm testing, Chaos testing, and E2E simulation.
**Status: GO (Passing State).**
- All critical UI overlapping bugs on the left/middle column of the CMS have been resolved.
- Left row heights perfectly match the middle row heights.
- React crash risks (e.g. invalid JSON arrays returned from the API) have been self-healed.
- Build successfully passes `astro check`.

## 🐛 KNOWN BUGS FOR CLAUDE TO FIX
The following UX/UI issues were intentionally deferred for you (Claude) to resolve as they require deep design refactoring. Please prioritize fixing these:

1. **VISIBLE SCROLL OVERLAPS ROWS**
   - *Context*: Mac OS overlay scrollbars overlap the content on the right edges (especially the "Delete" button in the right pane).
   - *Task*: Define a WebKit scrollbar class in CSS and apply it to the CMS containers, or add proper right padding to prevent clipping.

2. **METADATA EXTENDS BEYOND BOUNDARY BOX**
   - *Context*: Extremely long tags (e.g., in YouTube Sync Keywords) bleed out of their container boundary instead of wrapping. Long input strings break CSS grid columns.
   - *Task*: Add `break-words`, `min-w-0`, or proper `flex-wrap` constraints to `TagsInput` and grid cells in `LocalCmsApp.tsx`.

3. **UPLOAD BUTTONS DO NOT HAVE GOOD STYLING**
   - *Context*: The current "Upload" buttons are bright red rounded pills with white text that clashes with the sleek dark mode aesthetic.
   - *Task*: Redesign `ImageUploadField` to use a flat, dark-mode integrated outline button style.

4. **CONTENT METADATA HAS POOR STYLING NOT USER FRIENDLY**
   - *Context*: The "Factual (Read-Only)" tab dumps raw text data (Video Metrics, Velocity, Duration) onto the screen without visual hierarchy.
   - *Task*: Refactor this into a clean dashboard-style card layout using CSS grid and subtle borders.

5. **VIDEOS: TABS ARE POORLY DESIGNED AND TOO CLOSE**
   - *Context*: The `CONTENT_TABS` (Factual, Status & Curation, etc.) are cramped, floating pill buttons that look messy.
   - *Task*: Redesign them into a sleek segmented control or integrated tab bar.

## Future Roadmap (Post-Bug Fixes)
- **Dirty State Tracking**: The CMS currently saves immediately on every keystroke. Implement a dirty state tracking mechanism with explicit "Save" buttons.
- **Local Media Picker**: Implement a visual media browser instead of relying solely on pasting URLs.
- **Strict Draft vs. Published State**: Create distinct UI states for content lifecycle management.
