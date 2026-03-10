# Phase 3: UI Overhaul — Sleek MAM Interface

**Duration:** 6-8 weeks (April 18 - June 12, 2026)
**Goal:** Transform the current table-centric MVP UI into a professional, visually superior MAM interface that rivals ftrack, ShotGrid, and Frame.io.
**Depends on:** Phase 2 (ASWF pipeline provides the data for media previews, timelines, materials)

---

## Current State

- React 18 + Vite 6 + TypeScript
- Vanilla CSS (847 lines), no component library
- 3 role-based table views (Operator/Coordinator/Supervisor)
- No media previews, no hierarchy navigation, no timeline viz, no dark mode
- 78 tests passing
- Polling-only (15s interval), no real-time

---

## Design Principles

1. **Dark-first design** — VFX artists work in dark environments; light theme as option
2. **Media-forward** — thumbnails and proxies everywhere, not buried in table cells
3. **Hierarchy as navigation** — Project > Episode > Sequence > Shot > Version as breadcrumb + tree
4. **Real-time pipeline** — SSE/WebSocket for live status updates
5. **Keyboard-first** — power users navigate via shortcuts
6. **Accessible** — WCAG 2.1 AA minimum

---

## Task Breakdown

### Task 3.1: Design System Foundation (~400 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/web-ui/package.json and services/web-ui/src/styles.css.
Read services/web-ui/src/App.tsx to understand current component structure.

Set up a professional design system for a VFX MAM application:

1. Install Radix UI primitives + Tailwind CSS 4:
   npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
   @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-toast
   @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-separator
   npm install -D tailwindcss @tailwindcss/vite

2. Configure Tailwind in vite.config.ts (use @tailwindcss/vite plugin).

3. Create design tokens in services/web-ui/src/design/tokens.css:
   - Dark theme (default): dark grays (#0a0a0b → #1a1a1f → #2a2a30),
     accent blue (#3b82f6), success green (#22c55e), warning amber (#f59e0b),
     error red (#ef4444), text (white/gray-300/gray-500)
   - Light theme: invert appropriately
   - CSS custom properties with [data-theme="dark"] / [data-theme="light"]
   - Typography: Inter for UI, JetBrains Mono for code/metadata
   - Spacing scale: 4px base (0.25rem increments)
   - Border radius: 6px default, 8px cards, 12px modals
   - Shadows: subtle for dark theme (inner glow rather than drop shadow)

4. Create base components in services/web-ui/src/design/:
   - Button.tsx — primary, secondary, ghost, destructive variants; sizes sm/md/lg
   - Card.tsx — with header, body, footer slots; hover state
   - Badge.tsx — status colors (pending=gray, processing=blue, completed=green,
     failed=red, review=amber, approved=emerald)
   - Input.tsx — text, search, textarea with focus rings
   - Table.tsx — sortable headers, row hover, compact/comfortable density
   - Skeleton.tsx — loading placeholders matching component shapes
   - ThemeToggle.tsx — dark/light switch

5. Replace styles.css import in main.tsx with the new Tailwind + tokens setup.
   Keep styles.css temporarily — we'll migrate components in subsequent tasks.

Write tests for each design component (render, variants, accessibility).
```

**Validation:** Components render in both themes. All accessibility attributes present. Tests pass.

---

### Task 3.2: App Shell & Navigation (~350 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/web-ui/src/App.tsx — currently uses radio buttons for role switching.
Read services/web-ui/src/api.ts for available API endpoints.

Replace the current flat layout with a professional app shell:

File: services/web-ui/src/layout/AppShell.tsx
- Sidebar (240px, collapsible to 64px icon-only):
  - Logo/brand at top
  - Navigation sections:
    - Pipeline: Assets, Timelines, Materials
    - Review: Approval Queue, Review Sessions
    - Operations: Incidents, Audit Log, Metrics
    - Settings (bottom): Theme toggle, role selector
  - Active item highlighted with accent color + left border indicator
  - Collapse button at bottom

File: services/web-ui/src/layout/TopBar.tsx
- Breadcrumb trail (dynamic based on current view + hierarchy context)
- Global search input (Cmd+K to focus)
- Notification bell (count badge)
- User avatar/menu

File: services/web-ui/src/layout/Router.tsx
- Use React Router v6 (install react-router-dom)
- Routes:
  /assets                    → AssetBrowser
  /assets/:id                → AssetDetail
  /projects                  → ProjectList
  /projects/:id              → ProjectDetail (sequences/shots tree)
  /projects/:id/shots/:shotId → ShotDetail (versions list)
  /timelines                 → TimelineList
  /timelines/:id             → TimelineView
  /materials                 → MaterialBrowser
  /materials/:id             → MaterialDetail
  /review                    → ApprovalQueue
  /incidents                 → IncidentDashboard
  /audit                     → AuditTimeline

- Wrap all routes in AppShell layout
- 404 page

Write tests:
- Navigation renders correct route
- Breadcrumb updates on navigation
- Sidebar collapse/expand works
- Keyboard shortcut (Cmd+K) focuses search
```

**Validation:** App shell renders with sidebar + topbar. Routes work. Tests pass.

---

### Task 3.3: Asset Browser — Gallery + List Views (~400 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/web-ui/src/api.ts for fetchAssets() response shape.
The API returns assets with thumbnail { uri, width, height } and proxy { uri, codec } objects.

Create a professional asset browser that renders media:

File: services/web-ui/src/pages/AssetBrowser.tsx
- View toggle: Grid (default) / List / Compact
- Grid view:
  - Cards with thumbnail image (lazy-loaded, blurhash placeholder)
  - Asset title, status badge, version label
  - Hover: show proxy play button overlay, quick actions (review, approve)
  - Selection: click to select, Shift+click for range, Cmd+click for multi
  - Card size: small (160px) / medium (240px) / large (320px) — user toggle
- List view:
  - Thumbnail column (64px), title, status, version, shot, sequence, project, updated
  - Sortable columns (click header)
- Compact view:
  - Dense table similar to current but styled with design system
- Filter bar:
  - Status chips (multi-select)
  - Project/Sequence/Shot dropdowns (cascading)
  - Search input (debounced 300ms)
  - Sort: newest, oldest, name, status
  - "Clear all" button
- Pagination: infinite scroll for grid, numbered pages for list

File: services/web-ui/src/components/ThumbnailCard.tsx
- Image with aspect-ratio container (16:9 default)
- Fallback: gradient placeholder with file type icon
- Status dot overlay (top-right corner)
- On hover: dim image, show action buttons

File: services/web-ui/src/components/MediaPreview.tsx
- For proxy URIs: HTML5 video player with controls
- For image URIs: full-resolution image viewer
- For EXR sequences: display frame count + "Open in RV" button
- Lightbox mode: click thumbnail → overlay with full preview

Write tests:
- Grid renders correct number of cards
- View toggle switches layout
- Filter updates displayed assets
- Thumbnail fallback renders when URI is null
- Selection model (single, range, multi)
```

**Validation:** Assets display as visual cards with thumbnails. Three view modes work. Filters functional.

---

### Task 3.4: Hierarchy Browser — Project Tree (~350 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/web-ui/src/api.ts — add API calls for:
- GET /api/v1/projects → fetchProjects()
- GET /api/v1/projects/:id/sequences → fetchSequences(projectId)
- GET /api/v1/projects/:id/sequences/:seqId/shots → fetchShots(sequenceId)
  (Note: actual endpoint is listShotsBySequence — check route files)
- GET /api/v1/shots/:id/versions → fetchVersions(shotId)

Create a hierarchical project browser:

File: services/web-ui/src/pages/ProjectBrowser.tsx
- Left panel (300px): tree view
  - Project nodes (expand to show sequences)
  - Sequence nodes (expand to show shots)
  - Shot nodes (expand to show versions)
  - Lazy-load children on expand (don't fetch all at once)
  - Search/filter at top of tree
  - Count badges on each node (e.g., "12 shots")

- Right panel: detail view based on selected node
  - Project selected → project info card + sequence list as cards
  - Sequence selected → sequence info + shot grid with thumbnails
  - Shot selected → shot info + version timeline (vertical, newest first)
    - Each version: thumbnail, status badge, version label, created date
    - Active version highlighted
    - "Open in RV" button per version

File: services/web-ui/src/components/TreeView.tsx
- Reusable tree component with:
  - Expand/collapse with arrow icons
  - Keyboard navigation (up/down/left/right/enter)
  - Loading state per node (skeleton while fetching children)
  - Selection state (highlight + callback)

File: services/web-ui/src/pages/ShotDetail.tsx
- Version history as visual timeline
- Technical metadata panel (resolution, codec, frame range, colorspace)
- Material bindings list (which MaterialX looks are applied)
- Approval history timeline
- "Open in RV" button

Write tests:
- Tree expands and fetches children
- Selection updates detail panel
- Keyboard navigation works
- Version timeline renders in correct order
```

**Validation:** Users can navigate Project → Sequence → Shot → Version visually. Tree is keyboard-navigable.

---

### Task 3.5: Timeline Visualization (~400 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read the timeline domain model from Phase 2 (Timeline, TimelineClip).
Add API calls to services/web-ui/src/api.ts:
- GET /api/v1/timelines?projectId= → fetchTimelines(projectId)
- GET /api/v1/timelines/:id → fetchTimeline(id)  (includes clips)
- POST /api/v1/timelines/:id/conform → conformTimeline(id)

Create an OTIO timeline visualization:

File: services/web-ui/src/pages/TimelineView.tsx
- Header: timeline name, frame rate, total duration, conform status badge
- Track lanes (horizontal, scrollable):
  - Each track as a labeled row (V1, V2, A1, A2...)
  - Clips as colored blocks, width proportional to duration
  - Clip colors: matched=green, unmatched=red, pending=gray
  - Clip label: clip name + frame range
  - On hover: tooltip with source URI, shot match, in/out points
  - On click: select clip → show detail panel
- Playhead: draggable position indicator with frame counter
- Zoom: horizontal zoom in/out (mouse wheel or +/- buttons)
- Minimap: compressed overview of full timeline at bottom

File: services/web-ui/src/components/TimelineTrack.tsx
- Canvas-based or SVG rendering for performance
- Clip blocks with rounded corners
- Gap indicators (dark regions between clips)
- Frame ruler at top with major/minor ticks

File: services/web-ui/src/pages/TimelineList.tsx
- List of timelines per project
- Status badges (ingested/conforming/conformed)
- "Conform" action button
- Clip match summary (e.g., "23/30 clips matched")

Write tests:
- Timeline renders correct number of tracks
- Clips render with correct widths proportional to duration
- Conform button triggers API call
- Zoom changes clip widths
```

**Validation:** Timelines render as horizontal track lanes. Clips are visually distinguishable by conform status.

---

### Task 3.6: Real-Time Updates via SSE (~250 lines)

**Agent:** general-purpose (both backend + frontend)
**Commit checkpoint:** After this task

**Prompt:**
```
Replace the 15-second polling with Server-Sent Events (SSE) for live pipeline updates.

Backend (services/control-plane/src/routes/sse.ts):
- GET /api/v1/events/stream — SSE endpoint
  - Use Fastify's reply.raw to write SSE frames
  - Event types to broadcast:
    - "asset.status_changed" — when job status transitions
    - "asset.metadata_updated" — when DataEngine updates metadata
    - "job.claimed" / "job.completed" / "job.failed"
    - "timeline.conformed"
  - Keep-alive: send comment every 30s to prevent timeout
  - Client disconnect cleanup: track active connections, remove on close
  - Optional: ?projectId= filter to only receive events for a project

- Add an EventEmitter or simple pub/sub in the persistence layer:
  - After each status change in updateJobStatus/setJobStatus, emit event
  - SSE route subscribes to these events and forwards to connected clients

Frontend (services/web-ui/src/hooks/useEventStream.ts):
- Custom hook: useEventStream(projectId?)
  - Opens EventSource to /api/v1/events/stream
  - Reconnects on disconnect (exponential backoff: 1s, 2s, 4s, max 30s)
  - Returns { connected: boolean, lastEvent: SSEEvent | null }
  - On "asset.status_changed": invalidate asset query cache
  - On "asset.metadata_updated": refresh asset detail

- Replace polling in App.tsx with useEventStream:
  - Remove setInterval-based fetching
  - Keep polling as fallback if SSE connection fails
  - Show connection status indicator in TopBar (green dot = live, yellow = reconnecting)

Register SSE route in app.ts.

Write tests:
- SSE endpoint sends events on status change
- Client reconnects on disconnect
- Fallback to polling when SSE unavailable
```

**Validation:** Status changes appear in UI within 1 second without polling. Connection indicator works.

---

### Task 3.7: Review & Annotation Interface (~400 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/web-ui/src/components/ApprovalPanel.tsx and ReviewButton.tsx.
Read services/control-plane/src/routes/approval.ts for approval endpoints.

Create a dedicated review interface:

File: services/web-ui/src/pages/ReviewSession.tsx
- Split layout:
  - Left (70%): media viewer
    - For video proxies: HTML5 player with frame-accurate controls
      (frame forward/back buttons, timecode display, playback speed)
    - For EXR sequences: frame slider + "Open in RV" button
    - For MaterialX: 3D preview placeholder with texture list
  - Right (30%): review panel
    - Version info (label, status, shot context)
    - Approval actions: Approve / Request Changes / Reject (with reason)
    - Notes thread (chronological, with @mentions)
    - Version comparison: dropdown to compare with previous version
    - Technical metadata accordion

File: services/web-ui/src/pages/ApprovalQueue.tsx (replace existing)
- Card-based layout (not table):
  - Each card: thumbnail, title, submitter, submitted date, status badge
  - Priority indicator (colored left border)
  - Click → navigate to ReviewSession
- Filters: status, submitter, date range
- Sort: newest first (default), priority, submitter
- Bulk actions: approve selected, request changes on selected

File: services/web-ui/src/components/VideoPlayer.tsx
- HTML5 video with custom controls styled to match dark theme
- Frame counter overlay
- Playback speed selector (0.25x, 0.5x, 1x, 2x)
- Keyboard shortcuts: space=play/pause, left/right=frame step, J/K/L=shuttle

Write tests:
- Approval actions call correct API endpoints
- Video player renders with custom controls
- Notes thread displays in chronological order
- Bulk approve works on selected items
```

**Validation:** Full review workflow in UI: view media, read notes, approve/reject. Video player has frame controls.

---

### Task 3.8: Material Browser (~300 lines)

**Agent:** ui-ux-react-vite
**Commit checkpoint:** After this task (final Phase 3 commit)

**Prompt:**
```
Read services/web-ui/src/api.ts — add API calls for all MaterialX endpoints from Phase 2.

Create a material browser and detail view:

File: services/web-ui/src/pages/MaterialBrowser.tsx
- Grid of material cards per project
- Each card: material name, version count, look count, status badge
- Click → MaterialDetail

File: services/web-ui/src/pages/MaterialDetail.tsx
- Header: material name, project, status, created by
- Version selector (dropdown or tabs)
- For selected version:
  - Look variants as visual cards (placeholder image + look name)
  - Texture dependency tree:
    - Hierarchical view: material → textures (direct) → textures (transitive)
    - Each texture: type icon, path, colorspace badge, content hash
    - Missing texture indicator (red warning if file not found)
  - "Where Used?" panel: list of shot versions bound to this material
  - Technical metadata: MTLX spec version, render contexts, USD material path

File: services/web-ui/src/components/DependencyTree.tsx
- Tree visualization of texture dependencies
- Depth-based indentation
- Expandable/collapsible nodes
- Color-coded by texture type (albedo=blue, normal=purple, roughness=green, etc.)

Write tests:
- Material grid renders cards
- Version selector updates displayed looks
- Dependency tree renders with correct depth
- "Where Used?" shows bound versions
```

**Validation:** Materials browsable with version/look/dependency drill-down. Tests pass.

---

## Commit Strategy

| Commit | Task | Est. Lines | Message |
|--------|------|-----------|---------|
| 1 | 3.1 | ~400 | `feat(P3): design system with Radix + Tailwind + dark theme` |
| 2 | 3.2 | ~350 | `feat(P3): app shell with sidebar, topbar, and router` |
| 3 | 3.3 | ~400 | `feat(P3): asset browser with gallery/list views and media previews` |
| 4 | 3.4 | ~350 | `feat(P3): hierarchy browser with project tree navigation` |
| 5 | 3.5 | ~400 | `feat(P3): OTIO timeline visualization with track lanes` |
| 6 | 3.6 | ~250 | `feat(P3): SSE real-time updates replacing polling` |
| 7 | 3.7 | ~400 | `feat(P3): review session with video player and approval actions` |
| 8 | 3.8 | ~300 | `feat(P3): material browser with dependency tree visualization` |

---

## Validation Checklist

- [ ] All 78+ existing web-ui tests still pass
- [ ] New component tests pass for all design system components
- [ ] Dark and light themes render correctly
- [ ] Keyboard navigation works throughout (sidebar, tree, asset grid)
- [ ] Thumbnails and video proxies render from API data
- [ ] SSE connection indicator shows live status
- [ ] Each commit under 1200 lines
- [ ] Lighthouse accessibility score >= 90
- [ ] Responsive layout works at 1280px, 1920px, and 2560px widths
