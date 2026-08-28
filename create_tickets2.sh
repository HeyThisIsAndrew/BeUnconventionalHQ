#!/bin/bash

# Function to create an issue
create_issue() {
  local title="$1"
  local body="$2"
  gh issue create --title "$title" --body "$body"
}

echo "Creating Ticket 1..."
create_issue "Ticket 1: PostgreSQL/Supabase schema initialization (Users, Tiers, OAuth, Canvas Metrics)" "## Objective
Establish the relational database foundation for the micro-SaaS.

## Acceptance Criteria
- [ ] Implement \`users\` table including \`username\` (for vanity URLs) and \`tier\` (Free/Pro).
- [ ] Implement \`oauth_connections\` table with encrypted token storage.
- [ ] Implement \`metric_cache\` table to decouple API fetch delays from live URL reads.
- [ ] Implement \`media_kit_templates\` and \`template_elements\` tables (X/Y coords, bounding boxes)."

echo "Creating Ticket 2..."
create_issue "Ticket 2: Multi-tenant OAuth handshake implementation" "## Objective
Replace local \`.env\` and RapidAPI scrapers with official multi-tenant OAuth 2.0 flows.

## Acceptance Criteria
- [ ] Implement Google OAuth for YouTube analytics.
- [ ] Implement Meta Graph API OAuth for Instagram.
- [ ] Implement official TikTok Login Kit for Web.
- [ ] Ensure refresh tokens are properly captured and stored securely in the \`oauth_connections\` table."

echo "Creating Ticket 3..."
create_issue "Ticket 3: BullMQ/Redis worker cluster setup" "## Objective
Offload all API syncs and PDF/Image rendering to background workers.

## Acceptance Criteria
- [ ] Set up a BullMQ instance backed by Redis.
- [ ] Create distinct queues (\`queue:render-sharp\`, \`queue:render-chromium\`) to prevent resource starvation.
- [ ] Configure web API endpoints to push jobs and return \`202 Accepted\`."

echo "Creating Ticket 4..."
create_issue "Ticket 4: Live URL (/k/username) Redis caching layer & CRON syncs" "## Objective
Serve Pro tier live media kits via \`/k/username\` instantly without hitting provider API rate limits.

## Acceptance Criteria
- [ ] Build master CRON job for Pro users that enqueues daily sync tasks using Splay scheduling.
- [ ] Route \`/k/username\` traffic directly from a Redis cache (hydrated from \`metric_cache\`).
- [ ] Automatically invalidate and hydrate the Redis cache when a BullMQ sync worker successfully completes."

echo "Creating Ticket 5..."
create_issue "Ticket 5: Node.js/Sharp rendering engine for Free tier" "## Objective
Implement a lightweight, low-compute rendering pipeline for Free tier users exporting static PNG/JPG files.

## Acceptance Criteria
- [ ] Utilize \`sharp\` to composite dynamic text variables over the uploaded base image.
- [ ] Implement SVG-based shrink-to-fit logic (\`textLength\`).
- [ ] Limit typography exclusively to curated Google Fonts."

echo "Creating Ticket 6..."
create_issue "Ticket 6: Sandboxed Headless Chromium engine for Pro tier" "## Objective
Implement the heavy Headless Chromium rendering engine for Pro tier users generating PDFs.

## Acceptance Criteria
- [ ] Establish a sandboxed Puppeteer/Playwright worker process.
- [ ] Pass template data to an HTML layout and export to PDF.
- [ ] Utilize modern CSS (\`container-type: inline-size\` with \`cqi\` units) to dynamically shrink text if standard metrics overflow the bounding box."

echo "Creating Ticket 7..."
create_issue "Ticket 7: OAuth failure webhooks and UI fallback logic" "## Objective
Ensure graceful degradation when third-party OAuth refresh tokens are silently revoked or expire.

## Acceptance Criteria
- [ ] Implement BullMQ job hooks to catch \`401 Unauthorized\` responses and update \`oauth_connections.status = 'revoked'\`.
- [ ] Pause the user's automated CRON syncs upon failure.
- [ ] Ensure the Live URL continues to render the last known good metrics from \`metric_cache\`.
- [ ] Add a visible UI badge (e.g., \"Metrics last updated X days ago\") and trigger a transactional email."

echo "Creating Ticket 8..."
create_issue "Ticket 8: Fabric.js frontend drag-and-drop UI" "## Objective
Build the client-facing UI where content creators assemble their living media kits.

## Acceptance Criteria
- [ ] Integrate a canvas engine (e.g., Fabric.js or React Konva) allowing image uploads as the background base.
- [ ] Allow users to drag and drop dynamic tokens (e.g., \`{{youtube_subscribers}}\`) onto the canvas.
- [ ] Enforce visual width/height bounding box resizing for tokens.
- [ ] Save the canvas mapping payload (X/Y, width, height, typography) to the \`template_elements\` Postgres table."

echo "Creating Ticket 9..."
create_issue "Ticket 9: Secure custom font (.ttf/.woff) upload pipeline" "## Objective
Allow Pro users to upload custom fonts for flawless brand matching without introducing remote code execution vulnerabilities.

## Acceptance Criteria
- [ ] Implement an upload pipeline for \`.ttf\` and \`.woff\` files.
- [ ] Strictly sanitize uploaded fonts using a library like \`fontmin\` or \`opentype.js\` to strip malicious tables.
- [ ] Never install fonts at the OS level; pass sanitized fonts strictly via base64 \`@font-face\` injection directly to the rendering engine."

echo "Creating Epic..."
create_issue "Epic: Micro-SaaS Living Media Kit Engine" "## Overview
Transition our existing media kit infrastructure from single-tenant Astro build scripts into a multi-tenant micro-SaaS application. The application will act as a dynamic data overlay engine where content creators can upload native designs and drop data variables over them.

### Architecture Highlights
* **Authentication**: Official OAuth flows (Google, Meta, TikTok Login Kit).
* **Free Tier**: On-demand manual API syncs, curated Google Fonts, and lightweight high-res image exports.
* **Pro Tier**: Automated daily background cron syncs (Splay-scheduled), custom \`.ttf/.woff\` uploads, PDF exports via Headless Chromium, and a live-hosted sponsor URL.

## Task Checklist
### Phase 1: DB & Auth Foundation
- [ ] Ticket 1: PostgreSQL/Supabase schema initialization
- [ ] Ticket 2: Multi-tenant OAuth handshake implementation

### Phase 2: Queue & Caching Infrastructure
- [ ] Ticket 3: BullMQ/Redis worker cluster setup
- [ ] Ticket 4: Live URL caching layer and CRON syncs

### Phase 3: Render Pipelines & Graceful Degradation
- [ ] Ticket 5: Node.js/Sharp rendering engine for Free tier
- [ ] Ticket 6: Sandboxed Headless Chromium engine for Pro tier
- [ ] Ticket 7: OAuth failure webhooks and fallback logic

### Phase 4: Frontend Canvas & Asset Security
- [ ] Ticket 8: Fabric.js frontend drag-and-drop UI
- [ ] Ticket 9: Secure custom font upload pipeline"

echo "Done!"
