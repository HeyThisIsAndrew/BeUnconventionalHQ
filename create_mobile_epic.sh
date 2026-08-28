#!/bin/bash

# Function to create the epic
gh issue create --title "Epic: Native Apple Ecosystem Expansion (iOS / iPadOS / macOS)" --body "## Overview
Once the core Web Micro-SaaS (v2.0) is complete, this Epic tracks the expansion of the Living Media Kit engine into native Apple applications (iOS, iPadOS, and macOS). 

Later, this will be followed by Android expansion.

## Strategy & Learning Goals
* **Core Technology:** SwiftUI. This will allow us to write a single native codebase that compiles beautifully across iPhone, iPad, and Mac.
* **Backend Integration:** The apps will not need to duplicate the heavy lifting. They will communicate via REST API with the Node.js/Postgres backend built in the v2.0 Web Epic (fetching OAuth statuses, triggering BullMQ renders).
* **Learning Objective:** The development of this Epic is designated as a learning opportunity for native Apple development.

## High-Level Roadmap
- [ ] Ticket: Define REST API contract between the Node.js Web Backend and Mobile Clients
- [ ] Ticket: Setup Xcode project with shared SwiftUI codebase for iOS/macOS
- [ ] Ticket: Implement native OAuth login flows (Google/Meta/TikTok) via App Links
- [ ] Ticket: Build native Canvas / Drag-and-Drop mapping UI in SwiftUI
- [ ] Ticket: Connect native UI to the BullMQ rendering backend"

