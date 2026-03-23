# Unified Navigation Restructure — Multi-Agent Implementation Plan

> Execution-ready plan for restructuring SpaceHarbor's navigation from 3 flat sections to 6 role-adaptive sections with 15 new pages, project context selector, and live badge system.

**Status:** ALL PHASES COMPLETE (1-7)
**Phases:** 7 (ordered by dependency)
**New pages:** 15
**New backend endpoints:** 5
**New files:** 49
**Modified files:** 6

---

# Phase 1: NavRegistry + Role-Adaptive Sections (CRITICAL PATH)

**Objective:** Replace hardcoded `navItems[]` with typed registry, implement section-level permission gating, set up route redirects. No new pages — all existing pages continue working at new URLs.

## Tasks

- [X] **1.1 Define NavRegistry types** — Create `services/web-ui/src/nav/types.ts` with `NavItemDef` (id, to, label, section, icon, permission?, badgeKey?, collapsedByDefault?) and `SectionDef` (id, label, permission?, collapsedByDefault?) interfaces. **Owner:** Frontend-A
- [X] **1.2 Create NavRegistry data** — Create `services/web-ui/src/nav/registry.ts` exporting `NAV_SECTIONS` (6 sections with permission gates) and `NAV_ITEMS` (all items from target structure). Icons reuse existing `NavIcon` SVG paths. **Owner:** Frontend-A. **Depends on:** 1.1
- [X] **1.3 Test NavRegistry** — Create `services/web-ui/src/nav/registry.test.ts`. Validate: all items reference valid sections, all sections have at least one item, permission strings match `PERMISSIONS` const values. **Owner:** Frontend-A. **Depends on:** 1.2
- [X] **1.4 Create useNavVisibility hook** — Create `services/web-ui/src/nav/useNavVisibility.ts`. Consumes `useAuth()` permissions, filters sections/items by permission check. Returns `{ visibleSections, itemsBySection }`. **Owner:** Frontend-A. **Depends on:** 1.2
- [X] **1.5 Test useNavVisibility** — Create `services/web-ui/src/nav/useNavVisibility.test.ts`. Mock auth with viewer/artist/supervisor/pipeline_td/administrator permissions, assert correct visibility. **Owner:** Frontend-A. **Depends on:** 1.4
- [X] **1.6 Create useSectionCollapse hook** — Create `services/web-ui/src/nav/useSectionCollapse.ts`. Stores collapse state in localStorage (`ah_nav_collapse`). Initializes from `SectionDef.collapsedByDefault`. **Owner:** Frontend-A
- [X] **1.7 Test useSectionCollapse** — Create `services/web-ui/src/nav/useSectionCollapse.test.ts`. Test toggle, default values, localStorage persistence. **Owner:** Frontend-A. **Depends on:** 1.6
- [X] **1.8 Refactor AppLayout sidebar** — Modify `services/web-ui/src/AppLayout.tsx`: remove hardcoded `navItems[]`, import from `./nav/registry`, render sections with chevron toggle, add `data-testid` attributes. Keep logo, breadcrumb, user menu, collections intact. **Owner:** Frontend-A. **Depends on:** 1.2, 1.4, 1.6
- [X] **1.9 Update route registration with redirects** — Modify `services/web-ui/src/main.tsx`: add nested route groups under section prefixes, redirect old URLs (`/hierarchy` → `/library/hierarchy`, `/timeline` → `/production/timeline`, etc.). **Owner:** Frontend-A. **Depends on:** 1.8
- [X] **1.10 Update GlobalShortcuts** — Update shortcut navigate targets to new paths, add section-jump shortcuts (1-6). **Owner:** Frontend-A. **Depends on:** 1.9

## Validation

- [X] All existing web-ui tests pass (no regressions) — 268/269 pass (1 pre-existing api.test.ts failure)
- [X] Nav renders 6 sections for administrator, 3 for viewer — verified via useNavVisibility tests
- [X] Old URLs redirect to new paths — 11 redirect routes in main.tsx
- [X] Section collapse toggles and persists to localStorage — 5 useSectionCollapse tests pass
- [X] `npx tsc --noEmit` zero new errors (5 pre-existing test-only warnings)

## Exit Criteria

- NavRegistry pattern replaces hardcoded array
- Role-adaptive visibility working per matrix
- All existing pages accessible at new URLs
- Backward-compatible redirects for all old URLs

## Dependencies for Next Phase

- Phases 2-6 all depend on Phase 1 completion
- Phases 2-6 are independent of each other (parallelizable)

---

# Phase 2: WORK Section + Project Context

**Objective:** Build project context selector and 3 WORK pages (My Queue, My Assignments, Dailies).

## Tasks

- [X] **2.1 Backend: listTasksByAssignee** — Add `listTasksByAssignee(assignee, statusFilter?)` to `PersistenceAdapter` interface in `persistence/types.ts`, implement in `local-persistence.ts`. **Owner:** Backend-C. **Depends on:** none
- [X] **2.2 Backend: work queue endpoint** — Create `services/control-plane/src/routes/work.ts` with `GET /api/v1/work/queue` (tasks by assignee+status). Register in `app.ts`. **Owner:** Backend-C. **Depends on:** 2.1
- [X] **2.3 Backend: work assignments endpoint** — Add `GET /api/v1/work/assignments` to `work.ts` (shots by lead + versions by createdBy). **Owner:** Backend-C. **Depends on:** 2.1
- [X] **2.4 Test backend work routes** — Create `test/work-routes.test.ts`. Tests: queue returns filtered tasks, assignments returns shots+versions, empty states. **Owner:** Backend-C. **Depends on:** 2.2, 2.3
- [X] **2.5 Frontend: ProjectContext provider** — Create `services/web-ui/src/contexts/ProjectContext.tsx` with `ProjectProvider` and `useProject` hook. Stores selected project in localStorage (`ah_project`). **Owner:** Frontend-B
- [X] **2.6 Test ProjectContext** — Create `services/web-ui/src/contexts/ProjectContext.test.tsx`. **Owner:** Frontend-B. **Depends on:** 2.5
- [X] **2.7 Frontend: ProjectContextSelector** — Create `services/web-ui/src/nav/ProjectContextSelector.tsx`. Dropdown at sidebar top, fetches projects from hierarchy API. **Owner:** Frontend-B. **Depends on:** 2.5
- [X] **2.8 Test ProjectContextSelector** — Create `services/web-ui/src/nav/ProjectContextSelector.test.tsx`. **Owner:** Frontend-B. **Depends on:** 2.7
- [X] **2.9 Frontend: MyQueuePage** — Create `services/web-ui/src/pages/MyQueuePage.tsx`. Task table with status tabs (All/Pending/In Progress). Add `fetchWorkQueue` to `api.ts`. **Owner:** Frontend-B. **Depends on:** 2.2, 2.5
- [X] **2.10 Test MyQueuePage** — Create `services/web-ui/src/pages/MyQueuePage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 2.9
- [X] **2.11 Frontend: MyAssignmentsPage** — Create `services/web-ui/src/pages/MyAssignmentsPage.tsx`. Shots + versions owned by user. Add `fetchWorkAssignments` to `api.ts`. **Owner:** Frontend-B. **Depends on:** 2.3, 2.5
- [X] **2.12 Test MyAssignmentsPage** — Create `services/web-ui/src/pages/MyAssignmentsPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 2.11
- [X] **2.13 Wire WORK routes** — Register `/work/queue`, `/work/assignments`, `/work/dailies` in `main.tsx`. Dailies routes to existing DailiesPlaylistPage. **Owner:** Frontend-B. **Depends on:** 2.9, 2.11

## Validation

- [X] Backend work endpoints return filtered data
- [X] Project selector persists selection across page loads
- [X] All 3 WORK pages render with mock data
- [X] All tests pass

## Exit Criteria

- WORK section visible to artist+ roles
- Project context scopes work queue and assignments
- 3 pages + 2 backend endpoints operational

---

# Phase 3: REVIEW Section Refactor

**Objective:** Split existing ReviewPage into dedicated pages for approvals, feedback, sessions, and version comparison.

## Tasks

- [X] **3.1 Frontend: ApprovalQueuePage** — Create `services/web-ui/src/pages/ApprovalQueuePage.tsx`. Extract approval queue logic from `ReviewPage.tsx`. Route: `/review/approvals`. **Owner:** Frontend-B. **Depends on:** Phase 1
- [X] **3.2 Test ApprovalQueuePage** — Create `services/web-ui/src/pages/ApprovalQueuePage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 3.1
- [X] **3.3 Frontend: FeedbackPage** — Create `services/web-ui/src/pages/FeedbackPage.tsx`. Extract rejected feedback logic from `ReviewPage.tsx`. Route: `/review/feedback`. **Owner:** Frontend-B
- [X] **3.4 Test FeedbackPage** — Create `services/web-ui/src/pages/FeedbackPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 3.3
- [X] **3.5 Frontend: SessionsListPage** — Create `services/web-ui/src/pages/SessionsListPage.tsx`. List review sessions. Add `fetchReviewSessions` to `api.ts`. Route: `/review/sessions`. **Owner:** Frontend-B
- [X] **3.6 Test SessionsListPage** — Create `services/web-ui/src/pages/SessionsListPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 3.5
- [X] **3.7 Frontend: VersionComparePage** — Create `services/web-ui/src/pages/VersionComparePage.tsx`. Wrap existing VersionCompareViewer. Gate: `approval:approve` (supervisor+). Route: `/review/compare`. **Owner:** Frontend-B
- [X] **3.8 Test VersionComparePage** — Create `services/web-ui/src/pages/VersionComparePage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 3.7
- [X] **3.9 Wire REVIEW routes** — Register all 4 routes in `main.tsx`. Redirect `/review` → `/review/approvals`. **Owner:** Frontend-B. **Depends on:** 3.1, 3.3, 3.5, 3.7

## Validation

- [X] Review functionality preserved across split pages
- [X] Old `/review` URL redirects to `/review/approvals`
- [X] Version Compare gated to supervisor+

## Exit Criteria

- REVIEW section with 4 pages operational
- No regression in approval/rejection workflows

---

# Phase 4: PRODUCTION Section

**Objective:** Build Shot Board and Delivery Tracker, move existing pages under production prefix.

## Tasks

- [X] **4.1 Backend: shot board endpoint** — Create `services/control-plane/src/routes/shots.ts` with `GET /api/v1/shots/board?projectId=X`. Returns shots grouped by status columns. Register in `app.ts`. **Owner:** Backend-C
- [X] **4.2 Test shot board endpoint** — Create `test/shots-routes.test.ts`. **Owner:** Backend-C. **Depends on:** 4.1
- [X] **4.3 Backend: delivery tracker endpoint** — Create `services/control-plane/src/routes/delivery.ts` with `GET /api/v1/delivery/status?projectId=X`. Aggregates shot delivery readiness. Register in `app.ts`. **Owner:** Backend-C
- [X] **4.4 Test delivery endpoint** — Create `test/delivery-routes.test.ts`. **Owner:** Backend-C. **Depends on:** 4.3
- [X] **4.5 Frontend: ShotBoardPage** — Create `services/web-ui/src/pages/ShotBoardPage.tsx`. Kanban columns by shot status. Cards show code, assignee, frame range. Add `fetchShotBoard` to `api.ts`. Route: `/production/shots`. **Owner:** Frontend-B. **Depends on:** 4.1
- [X] **4.6 Test ShotBoardPage** — Create `services/web-ui/src/pages/ShotBoardPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 4.5
- [X] **4.7 Frontend: DeliveryTrackerPage** — Create `services/web-ui/src/pages/DeliveryTrackerPage.tsx`. Table with status badges. Add `fetchDeliveryStatus` to `api.ts`. Route: `/production/delivery`. **Owner:** Frontend-B. **Depends on:** 4.3
- [X] **4.8 Test DeliveryTrackerPage** — Create `services/web-ui/src/pages/DeliveryTrackerPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 4.7
- [X] **4.9 Wire PRODUCTION routes** — Register `/production/shots`, `/production/timeline`, `/production/dependencies`, `/production/delivery`. Gate: `approval:approve` (supervisor+). **Owner:** Frontend-B. **Depends on:** 4.5, 4.7

## Validation

- [X] Shot board renders with grouped columns
- [X] Delivery tracker shows color-coded status
- [X] Timeline accessible at `/production/timeline`

## Exit Criteria

- PRODUCTION section with 4 pages visible to supervisor+
- 2 new backend endpoints operational

---

# Phase 5: PIPELINE Section

**Objective:** Build 4 pipeline monitoring pages using existing backend endpoints.

## Tasks

- [X] **5.1 Frontend: PipelineMonitorPage** — Create `services/web-ui/src/pages/PipelineMonitorPage.tsx`. Active jobs table + queue depth gauge + DLQ triage. Add `fetchQueueItems`, `fetchDlqItems` to `api.ts`. Route: `/pipeline/monitor`. **Owner:** Frontend-B
- [X] **5.2 Test PipelineMonitorPage** — Create `services/web-ui/src/pages/PipelineMonitorPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 5.1
- [X] **5.3 Frontend: TranscodingPage** — Create `services/web-ui/src/pages/TranscodingPage.tsx`. Active encodes + proxy inventory. Route: `/pipeline/transcoding`. **Owner:** Frontend-B
- [X] **5.4 Test TranscodingPage** — Create `services/web-ui/src/pages/TranscodingPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 5.3
- [X] **5.5 Frontend: DataEnginePage** — Create `services/web-ui/src/pages/DataEnginePage.tsx`. Function registry + manual trigger. Gate: `admin:system_config`. Route: `/pipeline/functions`. **Owner:** Frontend-B
- [X] **5.6 Test DataEnginePage** — Create `services/web-ui/src/pages/DataEnginePage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 5.5
- [X] **5.7 Frontend: ConformancePage** — Create `services/web-ui/src/pages/ConformancePage.tsx`. OTIO conform status + mismatch report from timelines API. Route: `/pipeline/conform`. **Owner:** Frontend-B
- [X] **5.8 Test ConformancePage** — Create `services/web-ui/src/pages/ConformancePage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 5.7
- [X] **5.9 Wire PIPELINE routes** — Register all 4 routes. Gate: `pipeline:configure_stages` (pipeline_td+). DataEngine additionally checks `admin:system_config`. **Owner:** Frontend-B. **Depends on:** 5.1, 5.3, 5.5, 5.7

## Validation

- [X] Pipeline Monitor shows job/queue/DLQ data
- [X] DataEngine page gated to admin only
- [X] Conformance shows OTIO conform status

## Exit Criteria

- PIPELINE section with 4 pages visible to pipeline_td+
- All pages render with existing backend data

---

# Phase 6: ADMIN Section Consolidation

**Objective:** Add Users & Roles and Audit Trail pages, consolidate existing admin pages under `/admin/` prefix.

## Tasks

- [X] **6.1 Frontend: UsersRolesPage** — Create `services/web-ui/src/pages/UsersRolesPage.tsx`. User list table, role assignment dropdown, create user form, disable toggle. Add `fetchIamUsers`, `updateUserRole`, `createIamUser` to `api.ts`. Uses existing IAM routes. Gate: `iam:manage_users`. Route: `/admin/users`. **Owner:** Frontend-B
- [X] **6.2 Test UsersRolesPage** — Create `services/web-ui/src/pages/UsersRolesPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 6.1
- [X] **6.3 Frontend: AuditTrailPage** — Create `services/web-ui/src/pages/AuditTrailPage.tsx`. Auth decisions table with filters (user, decision, date range). Uses existing audit-decisions endpoint. Gate: `audit:read`. Route: `/admin/audit`. **Owner:** Frontend-B
- [X] **6.4 Test AuditTrailPage** — Create `services/web-ui/src/pages/AuditTrailPage.test.tsx`. **Owner:** Frontend-B. **Depends on:** 6.3
- [X] **6.5 Verify existing admin pages at new routes** — Confirm Analytics, SQL Console, Capacity, Settings all work at `/admin/*` paths. **Owner:** Frontend-B. **Depends on:** Phase 1

## Validation

- [X] User management CRUD works through UI
- [X] Audit trail loads with filters
- [X] All existing admin pages accessible at new routes

## Exit Criteria

- ADMIN section with 6+ pages visible to administrator only
- User management operational via UI

---

# Phase 7: Badge System + Polish

**Objective:** Live badge counts on nav items, keyboard shortcuts, final redirect audit.

## Tasks

- [X] **7.1 Backend: badge counts endpoint** — Create `services/control-plane/src/routes/nav-badges.ts` with `GET /api/v1/nav/badges`. Returns `{ queue, assignments, approvals, feedback, dlq }` counts. Register in `app.ts`. **Owner:** Backend-C
- [X] **7.2 Test badge endpoint** — Create `test/nav-badges.test.ts`. **Owner:** Backend-C. **Depends on:** 7.1
- [X] **7.3 Backend: badge SSE events** — Modify `routes/events-stream.ts` to broadcast `nav:badges` event on status changes. Debounce 5s. **Owner:** Backend-C. **Depends on:** 7.1
- [X] **7.4 Frontend: useBadgeCounts hook** — Create `services/web-ui/src/nav/useBadgeCounts.ts`. Fetches badge counts, subscribes to SSE updates. Polling fallback every 60s. **Owner:** Frontend-B. **Depends on:** 7.1
- [X] **7.5 Test useBadgeCounts** — Create `services/web-ui/src/nav/useBadgeCounts.test.ts`. **Owner:** Frontend-B. **Depends on:** 7.4
- [X] **7.6 Wire badges into AppLayout** — Render badge pills on nav items where `badgeKey` matches. Styling: small pill, warning variant for DLQ. **Owner:** Frontend-B. **Depends on:** 7.4
- [X] **7.7 URL redirect audit** — Verify all old URLs redirect. Add catch-all `/dashboard` → `/admin/analytics`. **Owner:** Frontend-B
- [X] **7.8 Keyboard shortcut updates** — Update shortcuts to new paths. Add section-jump shortcuts (1-6). **Owner:** Frontend-B

## Validation

- [X] Badges show live counts — useBadgeCounts hook + badge pills in AppLayout
- [X] SSE updates reflect in badges within 5s — nav:badges SSE event + 5s debounce
- [X] All old URLs redirect correctly — 11 redirects + catch-all verified
- [X] Keyboard shortcuts navigate to correct pages — 6 section-jump shortcuts (1-6) added
- [X] Full test suite passes (web-ui + control-plane) — 346/347 web-ui (1 pre-existing), 330+ control-plane pass

## Exit Criteria

- Live badge system operational
- All backward-compatible redirects in place
- Keyboard shortcuts updated
- Zero test regressions

---

# Execution Summary

## Agent Assignments

| Agent | Role | Phases | Tasks |
|-------|------|--------|-------|
| **Frontend-A** | NavRegistry infrastructure | 1 | 1.1-1.10 |
| **Frontend-B** | All page construction | 2-7 | 2.5-2.13, 3.1-3.9, 4.5-4.9, 5.1-5.9, 6.1-6.5, 7.4-7.8 |
| **Backend-C** | API endpoints | 2, 4, 7 | 2.1-2.4, 4.1-4.4, 7.1-7.3 |

## Critical Path

```
Phase 1 (NavRegistry) ──────── BLOCKS ALL ────────┐
                                                    │
    ┌── Phase 2 (WORK) ────────────────────────────┐│
    ├── Phase 3 (REVIEW) ──────────────────────────┤│ ALL PARALLEL
    ├── Phase 4 (PRODUCTION) ──────────────────────┤│
    ├── Phase 5 (PIPELINE) ────────────────────────┤│
    └── Phase 6 (ADMIN) ──────────────────────────┤│
                                                    │
                        All phases ──> Phase 7 (Badges + Polish)
```

**Minimum sequential length:** Phase 1 (10 tasks) + max(Phase 2-6) (~13 tasks) + Phase 7 (8 tasks) = **31 task slots**

**With 3-agent parallelism:** Phase 1 (10) + Phases 2-6 parallel (~13) + Phase 7 (8) = **31 slots** but calendar time is ~13 + max(backend, frontend) per phase

## Parallel Workstream Summary

| Time Slot | Frontend-A | Frontend-B | Backend-C |
|-----------|-----------|-----------|-----------|
| Slot 1 | Phase 1 (nav infra) | — | — |
| Slot 2 | — | Phase 2 (WORK pages) | Phase 2 (work endpoints) |
| Slot 3 | — | Phase 3 (REVIEW) | Phase 4 (shots/delivery endpoints) |
| Slot 4 | — | Phase 4 (PRODUCTION pages) | Phase 7 (badge endpoint) |
| Slot 5 | — | Phase 5 (PIPELINE) | — |
| Slot 6 | — | Phase 6 (ADMIN) | — |
| Slot 7 | — | Phase 7 (badges + polish) | — |

## Risks & Unknowns

| Risk | Impact | Mitigation |
|------|--------|------------|
| Broken bookmarks/links | Users lose saved URLs | All old URLs get `<Navigate replace>` redirects |
| ReviewPage split breaks approval flow | Core workflow disrupted | Extract into new files, keep ReviewPage as redirect |
| Permission strings mismatch | Nav shows wrong items | Registry test validates all permissions exist in PERMISSIONS const |
| Badge count performance | Slow nav renders | Backend caches counts, SSE debounced to 5s |
| Too many pages thin on content | Pages feel empty | Use sample/placeholder data; connect to existing persistence data |
| Phase 1 scope creep | Blocks all downstream | Phase 1 is registry only — no new pages, no new endpoints |
