#!/bin/bash

# Create Milestone
gh api -X POST repos/{owner}/{repo}/milestones -f title="v2.0: Living Media Kit SaaS" -f description="Transition existing media kit infrastructure from single-tenant Astro build scripts into a multi-tenant micro-SaaS application." > /dev/null 2>&1
echo "Milestone 'v2.0: Living Media Kit SaaS' created (or already exists)."

# We can't reliably extract the milestone ID without jq in all environments, so we will create the issues and you can assign them from the UI, OR we can fetch it.
MILESTONE_ID=$(gh api repos/{owner}/{repo}/milestones --jq '.[] | select(.title=="v2.0: Living Media Kit SaaS") | .number')

# Function to create an issue
create_issue() {
  local title="$1"
  local body="$2"
  if [ -n "$MILESTONE_ID" ]; then
    gh issue create --title "$title" --body "$body" --milestone "$MILESTONE_ID"
  else
    gh issue create --title "$title" --body "$body"
  fi
}

echo "Creating Ticket 1..."
create_issue "Ticket 1: PostgreSQL/Supabase schema initialization (Users, Tiers, OAuth, Canvas Metrics)" "## Objective
Establish the relational database foundation for the micro-SaaS.

## Acceptance Criteria
- [ ] Implement \`users\` table including \`username\` (for vanity URLs) and \`tier\` (Free/Pro).
- [ ] Implement \`oauth_connections\` table with encrypted token storage.
- [ ] Implement \`metric_cache\` table.
- [ ] Implement \`media_kit_templates\` and \`template_elements\` tables (X/Y coords, bounding boxes)."

echo "Creating Ticket 2..."
create_issue "Ticket 2: Multi-tenant OAuth handshake implementation" "## Objective
Replace local \`.env\` and RapidAPI scrapers with official multi-tenant OAuth 2.0 flows.

## Acceptance Criteria
- [ ] Implement Google OAuth for YouTube analytics.
- [ ] Implement Meta Graph API OAuth for Instagram.
- [ ] Implement official TikTok Login Kit for Web.
- [ ] Ensure tokens are captured and stored securely."

echo "Creating Ticket 3..."
create_issue "Ticket 3: BullMQ/Redis worker cluster setup" "## Objective
Offload API syncs and rendering to background workers.

## Acceptance Criteria
- [ ] Set up a BullMQ instance backed by Redis.
- [ ] Create distinct queues (\`queue:render-sharp\`, \`queue:render-chromium\`).
- [ ] Configure web API endpoints to push jobs and return \`202 Accepted\`."

echo "Creating Ticket 4..."
create_issue "Ticket 4: Live URL (/k/username) Redis caching layer & CRON syncs" "## Objective
Serve Pro tier live media kits via \`/k/username\` instantly.

## Acceptance Criteria
- [ ] Build master CRON job for Pro users with Splay scheduling.
- [ ] Route \`/k/username\` traffic directly from Redis cache.
- [ ] Automatically invalidate/hydrate Redis cache on worker completion."

echo "Creating Ticket 5..."
create_issue "Ticket 5: Node.js/Sharp rendering engine for Free tier" "## Objective
Implement a lightweight rendering pipeline for Free tier static exports.

## Acceptance Criteria
- [ ] Utilize \`sharp\` to composite text variables over the base image.
- [ ] Implement SVG-based shrink-to-fit logic.
- [ ] Limit typography to Google Fonts."

echo "Creating Ticket 6..."
create_issue "Ticket 6: Sandboxed Headless Chromium engine for Pro tier" "## Objective
Implement heavy Headless Chromium rendering for Pro tier PDF generation.

## Acceptance Criteria
- [ ] Establish a sandboxed Puppeteer/Playwright worker process.
- [ ] Export HTML layout to PDF.
- [ ] Utilize CSS \`container-type: inline-size\` for text shrink-to-fit."

echo "Creating Ticket 7..."
create_issue "Ticket 7: OAuth failure webhooks and UI fallback logic" "## Objective
Ensure graceful degradation when OAuth tokens are revoked.

## Acceptance Criteria
- [ ] Implement BullMQ job hooks to catch \`401 Unauthorized\`.
- [ ] Pause automated CRON syncs upon failure.
- [ ] Continue serving Live URLs with last known good metrics.
- [ ] Add visible UI badge and trigger transactional warning email."

echo "Creating Ticket 8..."
create_issue "Ticket 8: Fabric.js frontend drag-and-drop UI" "## Objective
Build the client-facing UI for media kit assembly.

## Acceptance Criteria
- [ ] Integrate Fabric.js/React Konva for image uploads.
- [ ] Enable drag-and-drop data tokens (\`{{youtube_subscribers}}\`).
- [ ] Enforce visual bounding box resizing.
- [ ] Save mapping payload to Postgres."

echo "Creating Ticket 9..."
create_issue "Ticket 9: Secure custom font (.ttf/.woff) upload pipeline" "## Objective
Allow Pro users to upload custom fonts securely.

## Acceptance Criteria
- [ ] Implement upload pipeline for \`.ttf/\.woff\`.
- [ ] Sanitize uploaded fonts using \`fontmin\` or \`opentype.js\`.
- [ ] Serve sanitized fonts via base64 \`@font-face\` injection."

echo "Creating Epic..."
create_issue "Epic: Micro-SaaS Living Media Kit Engine" "## Overview
Transition media kit infrastructure into a multi-tenant micro-SaaS dynamic overlay engine.

### Phase 1: DB & Auth Foundation
- Ticket 1: PostgreSQL/Supabase schema initialization
- Ticket 2: Multi-tenant OAuth handshake implementation

### Phase 2: Queue & Caching Infrastructure
- Ticket 3: BullMQ/Redis worker cluster setup
- Ticket 4: Live URL caching & CRON
 
### Phase 3: Render Pipelines & Graceful Degradation
- Ticket 5: Node.js/Sharp rendering engine
- Ticket 6: Sandboxed Headless Chromium engine
- Ticket 7: OAuth failure webhooks & fallback

### Phase 4: Frontend Canvas & Asset Security
- Ticket 8: Fabric.js frontend drag-and-drop UI
- Ticket 9: Secure custom font upload pipeline"

echo "Done!"
