# Analytics Dashboard & SQL Query Console — Multi-Agent Implementation Plan

## Overview

Two new admin features for SpaceHarbor: (1) an Analytics Dashboard with four tab panels aggregating asset, pipeline, storage, and render data via Trino SQL; (2) a restricted SQL Query Console allowing `super_admin` users to run ad-hoc read-only queries against the VAST database.

**Constraint:** No new npm dependencies. All charts are inline SVG. SQL highlighting uses regex tokenizer over a textarea/pre overlay.

**Migration target:** `013_adhoc_query_audit.ts` (next after existing `012_audit_trail.ts`)

**Permission targets:**
- `admin:analytics` — new permission, granted to `platform_operator` and above
- `admin:adhoc_query` — new permission, granted to `super_admin` only

---

# Phase 1: Shared Infrastructure

**Objective:** Create the permissions, utilities, chart components, and migration that unblock all subsequent phases.

**CRITICAL PATH — All tasks must complete before Phases 2-5.**

## Tasks

- [x] **1.1 Add new permissions to IAM** — Add `ADMIN_ANALYTICS: "admin:analytics"` and `ADMIN_ADHOC_QUERY: "admin:adhoc_query"` to `PERMISSIONS` in `types.ts`. Add `P.ADMIN_ANALYTICS` to `platform_operator` direct permissions in `permissions.ts`. Add `P.ADMIN_ADHOC_QUERY` to `super_admin` direct permissions. Add `ACTION_PERMISSION_MAP` entries for all 7 new routes. **Owner:** Backend-IAM
- [x] **1.2 Test new permissions** — Create `test/iam/analytics-query-permissions.test.ts`. Verify: `platform_operator` has `admin:analytics`; `supervisor` does NOT; `super_admin` has `admin:adhoc_query`; `administrator` does NOT; all 7 route patterns resolve. **Owner:** Backend-Test
- [x] **1.3 Create TTL cache utility** — Create `src/utils/ttl-cache.ts` with generic `TtlCache<T>` class (get/set/has/clear, configurable TTL, default 10 min, passive eviction on read). **Owner:** Backend-Infra
- [x] **1.4 Test TTL cache** — Create `test/utils/ttl-cache.test.ts`. Test: set/get, expiry after TTL, clear, size, non-existent key returns undefined. **Owner:** Backend-Test
- [x] **1.5 Extract chart components** — Extract `VerticalBarChart`, `HorizontalBarChart`, `Sparkline`, `StatCard`, `DashboardCard` from `CapacityPlanningDashboard.tsx` to `src/components/charts/`. Create new `DonutChart.tsx` (SVG circle segments via stroke-dasharray) and `LineChart.tsx` (SVG polylines with gradient fill). Create `charts/utils.ts` with `formatBytes`, `formatHours`, `formatDuration`. Create barrel `charts/index.ts`. Refactor `CapacityPlanningDashboard` to import from `../components/charts`. **Owner:** Frontend-Components
- [x] **1.6 Test chart components** — Create `src/components/charts/charts.test.tsx`. Test: each component renders, DonutChart segments sum to 100%, LineChart renders polylines, StatCard renders label/value, CapacityPlanningDashboard regression test. **Owner:** Frontend-Test
- [x] **1.7 Migration 013: adhoc_query_audit table** — Create `src/db/migrations/013_adhoc_query_audit.ts` with `adhoc_query_audit` table (id, user_id, sql_text VARCHAR(10240), sql_hash VARCHAR(64), row_count, duration_ms, status, error_message, created_at). Sort keys: `['created_at', 'user_id']`. Register in `migrations/index.ts`. **Owner:** Backend-DB

## Validation

- [x] All existing tests still pass (no regressions)
- [x] `node --import tsx --test test/iam/analytics-query-permissions.test.ts` passes
- [x] `node --import tsx --test test/utils/ttl-cache.test.ts` passes
- [x] `npx vitest run src/components/charts/charts.test.tsx` passes
- [x] `npx vitest run src/pages/CapacityPlanningDashboard.test.tsx` passes (regression)
- [x] `npx tsc --noEmit` has zero errors

## Exit Criteria

- 2 new permissions registered in IAM type system and role matrix
- TTL cache utility created with passing tests
- 7 chart components in `src/components/charts/` with barrel export
- CapacityPlanningDashboard refactored to use shared charts (no behavior change)
- Migration 013 created and registered

## Dependencies for Next Phase

- Phase 2 requires: 1.1, 1.3 (permissions + cache)
- Phase 3 requires: 1.1, 1.3, 1.7 (permissions + cache + migration)
- Phase 4 requires: 1.5 (chart components)
- Phase 5 requires: 1.5 (chart components, for shared UI patterns)

---

# Phase 2: Analytics Backend

**Objective:** Build 4 analytics API endpoints with TTL caching and time range support.

**Parallelizable with Phase 3.**

## Tasks

- [x] **2.1 Analytics route: asset metrics** — Create `src/routes/analytics.ts` with `GET /api/v1/analytics/assets`. Queries: total count, count by status, count by media_type, top 10 most accessed. Use `TtlCache` with key `analytics:assets:{range}`. Time range: `?range=24h|7d|30d|90d` or `?from=&to=`. Fallback to in-memory data when Trino unavailable. Response: `{ totalAssets, byStatus, byMediaType, topAccessed, range, cachedAt }`. **Owner:** Backend-Analytics. **Depends on:** 1.1, 1.3
- [x] **2.2 Analytics route: pipeline metrics** — Add `GET /api/v1/analytics/pipeline` to analytics.ts. Job completion rate, throughput/hour, DLQ size, retry success rate. Same TTL cache pattern. **Owner:** Backend-Analytics. **Depends on:** 2.1
- [x] **2.3 Analytics route: storage + render metrics** — Add `GET /api/v1/analytics/storage` and `GET /api/v1/analytics/render` to analytics.ts. Storage: total bytes, by media type, proxy/thumbnail coverage, growth trend (7 data points). Render: core hours, avg render time, peak memory trend, jobs by engine. **Owner:** Backend-Analytics. **Depends on:** 2.2
- [x] **2.4 Register analytics routes in app.ts** — Import and call `registerAnalyticsRoutes(app, persistence, catalogTrino, prefixes)` in the `app.after()` block. **Owner:** Backend-Wiring. **Depends on:** 2.3
- [x] **2.5 Test analytics routes** — Create `test/analytics-routes.test.ts`. Tests: each endpoint returns 200 with correct shape, time range parsing, invalid range returns 400, cache behavior (second call within TTL returns same cachedAt), empty data returns zero/arrays (not errors). **Owner:** Backend-Test. **Depends on:** 2.4

## Validation

- [x] `node --import tsx --test test/analytics-routes.test.ts` passes
- [x] All 4 endpoints return valid JSON for each time range preset
- [x] Cache reduces repeated Trino calls (verified in test)

## Exit Criteria

- 4 analytics endpoints operational with TTL caching
- Time range support works for all presets + custom
- Graceful fallback when Trino unavailable

## Dependencies for Next Phase

- Phase 4 requires: 2.4 (routes registered, endpoints accessible)

---

# Phase 3: Query Console Backend

**Objective:** Build restricted SQL execution engine with all 7 security controls.

**Parallelizable with Phase 2.**

## Tasks

- [x] **3.1 SQL statement classifier** — Create `src/query/sql-classifier.ts`. Functions: `classifyStatement(sql)` (allow SELECT/SHOW/DESCRIBE/EXPLAIN, deny all else), `referencesBlockedTable(sql)` (blocklist: iam_users, iam_api_keys, iam_global_roles, iam_project_memberships, iam_refresh_tokens, schema_version), `ensureLimit(sql, maxLimit)` (inject/cap LIMIT 10000), `validateLength(sql, maxBytes)` (reject > 10KB). **Owner:** Backend-Security. **Depends on:** 1.1
- [x] **3.2 Test SQL classifier** — Create `test/query/sql-classifier.test.ts`. Tests: SELECT allowed, INSERT/DROP denied, case variations, leading comments stripped, IAM tables blocked (direct/subquery/JOIN/CTE), LIMIT injection/capping, length validation, multi-statement detection. **Owner:** Backend-Test. **Depends on:** 3.1
- [x] **3.3 Query execution routes** — Create `src/routes/query.ts`. `POST /api/v1/query/execute`: JWT-only auth, rate limit 10/min, classify+sanitize SQL, execute via separate TrinoClient (90s timeout), audit log. `GET /api/v1/query/history`: last 50 queries for user. `DELETE /api/v1/query/:queryId`: cancel via Trino REST API. **Owner:** Backend-Query. **Depends on:** 3.1, 1.3, 1.7
- [x] **3.4 Register query routes in app.ts** — Import and call `registerQueryRoutes(app, catalogTrino, prefixes)`. **Owner:** Backend-Wiring. **Depends on:** 3.3
- [x] **3.5 Test query routes** — Create `test/query-routes.test.ts`. Tests: valid SELECT returns 200, INSERT/DROP returns 403, IAM table returns 403, query > 10KB returns 400, rate limit (11th query returns 429), API key auth returns 403, history returns sorted, cancel returns 200, audit entry created, LIMIT auto-injection. **Owner:** Backend-Test. **Depends on:** 3.4

## Validation

- [x] `node --import tsx --test test/query/sql-classifier.test.ts` passes
- [x] `node --import tsx --test test/query-routes.test.ts` passes
- [x] No DDL/DML statement passes through classifier
- [x] IAM tables inaccessible via any SQL pattern
- [x] Rate limiting enforced

## Exit Criteria

- Query execution endpoint operational with all 7 security controls
- History and cancel endpoints functional
- Audit logging captures every query attempt
- JWT-only auth enforced (API keys rejected)

## Dependencies for Next Phase

- Phase 5 requires: 3.4 (routes registered, endpoints accessible)

---

# Phase 4: Frontend — Analytics Dashboard

**Objective:** Build the Analytics Dashboard page with 4 tab panels, charts, and auto-refresh.

**Parallelizable with Phase 5.**

## Tasks

- [x] **4.1 Analytics API client functions** — Add types (`AnalyticsAssetsData`, `AnalyticsPipelineData`, `AnalyticsStorageData`, `AnalyticsRenderData`) and fetch functions (`fetchAnalyticsAssets`, `fetchAnalyticsPipeline`, `fetchAnalyticsStorage`, `fetchAnalyticsRender`) to `api.ts`. **Owner:** Frontend-API. **Depends on:** 2.4
- [x] **4.2 AnalyticsDashboard page** — Create `src/pages/AnalyticsDashboard.tsx`. Tab bar (Assets/Pipeline/Storage/Render Farm), time range presets (24h/7d/30d/90d + Custom), auto-refresh 5 min with countdown, empty state with CTA, loading skeleton. Assets: DonutChart + StatCards + top-accessed table. Pipeline: StatCards + VerticalBarChart. Storage: HorizontalBarChart + DonutChart + LineChart. Render: StatCards + LineChart + VerticalBarChart. **Owner:** Frontend-Analytics. **Depends on:** 1.5, 4.1
- [x] **4.3 Register analytics route and nav** — Add lazy import + route for `/analytics` in `main.tsx`. Add nav item in ADMIN section of `AppLayout.tsx` with `admin:analytics` permission gate. **Owner:** Frontend-Wiring. **Depends on:** 4.2
- [x] **4.4 Test analytics dashboard** — Create `src/pages/AnalyticsDashboard.test.tsx`. Tests: renders loading, renders all 4 tabs, tab switching, time range buttons, auto-refresh timer, empty state, chart components render, permission gate. **Owner:** Frontend-Test. **Depends on:** 4.3

## Validation

- [x] `npx vitest run src/pages/AnalyticsDashboard.test.tsx` passes
- [x] All existing web-ui tests still pass
- [x] Nav item visible to platform_operator, hidden from supervisor

## Exit Criteria

- Analytics dashboard accessible at `/analytics` for authorized users
- All 4 tab panels render with correct charts
- Auto-refresh and time range controls functional
- Permission-gated nav item in ADMIN section

---

# Phase 5: Frontend — SQL Query Console

**Objective:** Build the restricted SQL Query Console page with editor, results, and history.

**Parallelizable with Phase 4.**

## Tasks

- [x] **5.1 Query API client functions** — Add types (`QueryResult`, `QueryHistoryEntry`) and functions (`executeQuery`, `fetchQueryHistory`, `cancelQuery`) to `api.ts`. **Owner:** Frontend-API. **Depends on:** 3.4
- [x] **5.2 QueryConsolePage component** — Create `src/pages/QueryConsolePage.tsx`. Top/bottom split (40/60, resizable divider). SQL editor (textarea+pre overlay with regex syntax highlighting). Toolbar (Run/Cancel/History/Clear/Export CSV/Export JSON). Results table (paginated 50/page, sticky header, monospaced). Query states (idle/running/results/error). Cancel via AbortController + server cancel. Truncation banner. Error panel. History in localStorage (last 20). Export CSV/JSON in-browser. **Owner:** Frontend-Query. **Depends on:** 5.1
- [x] **5.3 Register query console route and nav** — Add lazy import + route for `/query` in `main.tsx`. Add nav item in ADMIN section of `AppLayout.tsx` with `admin:adhoc_query` permission gate. **Owner:** Frontend-Wiring. **Depends on:** 5.2
- [x] **5.4 Test query console** — Create `src/pages/QueryConsolePage.test.tsx`. Tests: renders editor+results, typing updates highlight, Run triggers API, Cancel appears during running, results table renders, pagination, truncation banner, error state, history dropdown, Export CSV, permission gate, Cmd+Enter shortcut. **Owner:** Frontend-Test. **Depends on:** 5.3

## Validation

- [x] `npx vitest run src/pages/QueryConsolePage.test.tsx` passes
- [x] All existing web-ui tests still pass
- [x] Nav item visible to super_admin only

## Exit Criteria

- Query console accessible at `/query` for super_admin users
- SQL editor with syntax highlighting functional
- Results display with pagination and export
- Cancel, history, and error handling all working
- Permission-gated to super_admin only

---

# Phase 6: Integration & Final Validation

**Objective:** Full-stack smoke tests, regression check, and final sign-off.

## Tasks

- [x] **6.1 Integration smoke test** — Create `test/analytics-query-integration.test.ts`. Tests: build app + inject data + hit all 4 analytics endpoints, execute SELECT + verify audit, attempt INSERT + verify 403, CapacityPlanningDashboard regression, permission enforcement (platform_operator analytics yes / query no, super_admin both). **Owner:** Integration-Test. **Depends on:** Phases 2-5
- [x] **6.2 Full test suite run** — Run `node --import tsx --test test/` on control-plane and `npx vitest run` on web-ui. All tests pass with zero failures. **Owner:** QA
- [x] **6.3 Type check** — Run `npx tsc --noEmit` on control-plane. Zero errors. **Owner:** QA

## Validation

- [x] All control-plane tests pass
- [x] All web-ui tests pass
- [x] Zero type errors
- [x] No regressions in existing functionality

## Exit Criteria

- Both features fully integrated and tested
- All security controls verified
- Clean test suite with zero failures

---

# Execution Summary

## Recommended Agent Assignments (4 parallel agents)

| Agent | Workstream | Phases | Tasks |
|-------|-----------|--------|-------|
| **Agent A: Backend** | Permissions, cache, migration, analytics routes, query routes | 1, 2, 3 | 1.1, 1.3, 1.7, 2.1-2.5, 3.1-3.5, 6.1 |
| **Agent B: Frontend** | Chart extraction, analytics page, query console page | 1, 4, 5 | 1.5, 4.1-4.4, 5.1-5.4 |
| **Agent C: Tests** | All test files across both services | 1, 2, 3, 4, 5, 6 | 1.2, 1.4, 1.6, 2.5, 3.2, 3.5, 4.4, 5.4, 6.1-6.3 |
| **Agent D: Wiring** | app.ts, main.tsx, AppLayout.tsx registration | 2, 3, 4, 5 | 2.4, 3.4, 4.3, 5.3 |

**Optimal parallelization:** After Phase 1 completes, Agent A splits into analytics (Phase 2) and query (Phase 3) in sequence. Agent B works on Phase 4 and then Phase 5. Tests can be written alongside implementation.

## Critical Path

```
Phase 1 (1.1→1.2, 1.3→1.4, 1.5→1.6, 1.7) — ~6 tasks, sequential within groups
    │
    ├── Phase 2 (2.1→2.2→2.3→2.4→2.5) ─── Phase 4 (4.1→4.2→4.3→4.4)
    │         PARALLEL                              PARALLEL
    └── Phase 3 (3.1→3.2→3.3→3.4→3.5) ─── Phase 5 (5.1→5.2→5.3→5.4)
                                                        │
                                                Phase 6 (6.1→6.2→6.3)
```

**Minimum sequential length:** 6 + 5 + 4 + 3 = **18 task slots**
**With 2-agent parallelism:** 6 + 5 + 4 + 3 = **18 task slots** (Phases 2||3 and 4||5 overlap)

## Parallel Workstream Summary

| Time Slot | Agent A | Agent B |
|-----------|---------|---------|
| Slot 1 | Phase 1: permissions + cache + migration | Phase 1: chart extraction |
| Slot 2 | Phase 2: analytics backend | Phase 4: analytics frontend |
| Slot 3 | Phase 3: query backend | Phase 5: query frontend |
| Slot 4 | Phase 6: integration | Phase 6: test suite |

## Main Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Trino unavailable in dev | Analytics/Query return errors | All routes fallback to in-memory sample data |
| SQL injection via query console | Data exfiltration/mutation | 7-layer defense: classifier, table blocklist, LIMIT cap, JWT-only, rate limit, audit, separate client |
| Chart extraction breaks CapacityPlanningDashboard | Regression | Task 1.6 includes regression test |
| Large results block browser | UI freeze | 50-row client pagination + 10K server row cap + AbortController cancel |
| Permission collision | IAM breakage | Task 1.2 verifies no collision with existing 55+ permissions |

## New Files (25)

| File | Type | Phase |
|------|------|-------|
| `services/control-plane/src/utils/ttl-cache.ts` | Utility | 1 |
| `services/control-plane/src/db/migrations/013_adhoc_query_audit.ts` | Migration | 1 |
| `services/control-plane/src/query/sql-classifier.ts` | Security | 3 |
| `services/control-plane/src/routes/analytics.ts` | Route | 2 |
| `services/control-plane/src/routes/query.ts` | Route | 3 |
| `services/web-ui/src/components/charts/*.tsx` (7 files + utils + index) | Components | 1 |
| `services/web-ui/src/pages/AnalyticsDashboard.tsx` | Page | 4 |
| `services/web-ui/src/pages/QueryConsolePage.tsx` | Page | 5 |
| Test files (8) | Tests | 1-6 |
