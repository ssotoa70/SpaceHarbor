# SpaceHarbor: Asset Detail Panel — Multi-Agent Implementation Plan

> Execution-ready plan derived from 6-specialist validation session (2026-03-16).
> Designed for parallel agent execution with clear dependency gates.
>
> **Last updated:** 2026-03-16 — Phase 0 + Phase 1 complete, grid refactored to responsive auto-fill.

---

## Phase 0: Backend Foundation — Data Model & API ✅ COMPLETE

**Objective:** Establish the storage path model, version detail endpoint, and protocol resolver that all 4 tabs depend on. This phase unblocks all downstream UI work.

### Tasks

- [x] **0.1 — Add `elementPath` field to Version model:** Added `elementPath: string | null` to `Version` interface in `domain/models.ts` alongside existing `vastPath`. Canonical protocol-agnostic path.
  - **Commit:** `bbac9ec`

- [x] **0.2 — Add `elementPath` to persistence layer:** Updated `LocalPersistenceAdapter` (sets `elementPath: null` on create) and `vast-trino-queries.ts` (`mapRowToVersion` reads `element_path`, `insertVersion` returns `elementPath: null`). Migration 012 deferred — column will be added when migration is bundled (see Migration 012 checklist below).
  - **Note:** Migration DDL not yet written — adapters handle null gracefully. Trino `getStr()` returns null for missing columns.

- [x] **0.3 — Create ProtocolResolver service:** `services/control-plane/src/storage/protocol-resolver.ts` — reads `SPACEHARBOR_NFS_VIP`, `SPACEHARBOR_SMB_SERVER`, `SPACEHARBOR_S3_BUCKET`. Exports `resolveAccessUri()` and `resolveAllProtocols()`. 6 unit tests passing.
  - **Tests:** `test/protocol-resolver.test.ts` (NFS, SMB, S3 + unconfigured + resolveAll)

- [x] **0.4 — Create `GET /api/v1/versions/:id/detail` endpoint:** `services/control-plane/src/routes/version-detail.ts`. Supports `?tabs=info,aovs,vast,history`. Info tab returns Version + Provenance + resolved protocol URIs. History tab returns projected lifecycle timeline. AOVs/VAST return null placeholders. Registered in `app.ts`. 4 unit tests passing.
  - **Tests:** `test/version-detail.test.ts` (info tab, 404, history, multi-tab)
  - **Implementation note:** History is built in-memory from Version created/published events + Provenance records + VersionApprovals. No separate Trino projection query needed for local adapter — the `buildHistoryTimeline()` function queries existing persistence methods.

- [x] **0.5 — Add `fetchVersionDetail()` to web-ui API client:** Added `VersionDetailInfo`, `VersionDetailHistoryEvent`, `VersionDetailResponse` types and `fetchVersionDetail()` function to `services/web-ui/src/api.ts`.

- [x] **0.6 — Replace `vast://` URI display in web-ui:** All `vast://` strings removed from UI source code:
  - Sample assets use absolute POSIX paths (`/var/204/...`)
  - `extractVastPath()` in `utils/media-types.ts` now returns canonical paths; strips legacy `vast://` prefix from old data
  - `ThumbnailCard` shows `asset.elementPath ?? vastPath` (absolute path)
  - `ReviewPage` updated: playback URI check, placeholder text
  - `ReviewPage.test.tsx` fixtures updated
  - Ingest call uses absolute path from `file.path`

- [x] **0.7 — Add `currentVersionId` and `elementPath` to `AssetRow` web-ui type:** Added both fields as optional to `AssetRow` in `services/web-ui/src/types.ts`. Backend `Asset` model already has `currentVersionId`.

### Validation

- [x] **V0.1 — Type check passes:** `npx tsc --noEmit` returns 0 errors for both control-plane and web-ui
- [ ] **V0.2 — Migration 012 runs cleanly:** Deferred — migration DDL not yet written (adapters handle null)
- [x] **V0.3 — Version detail endpoint returns info tab data:** 4 tests confirm correct response shape
- [x] **V0.4 — No `vast://` in web-ui source:** Only backward-compat stripping code remains in `extractVastPath()`
- [x] **V0.5 — All existing tests pass:** control-plane 14 new tests, web-ui 250 tests (1 pre-existing unrelated failure)

### Exit Criteria — ALL MET

- ✅ `GET /versions/:id/detail?tabs=info` returns correct Version metadata
- ✅ `elementPath` field on Version model, readable by both adapters
- ✅ `ProtocolResolver` resolves nfs/smb/s3 URIs from config
- ✅ `vast://` removed from all UI display code
- ✅ `fetchVersionDetail()` available in web-ui API client

---

## Phase 1: Detail Panel Shell + Info Tab + History Tab ✅ COMPLETE

**Objective:** Ship the visible detail panel with the two tabs that are ready today (Info and History). This is the highest-value user-facing deliverable.

### Tasks — Panel Shell

- [x] **1.1 — Create `AssetDetailPanel` component:** `services/web-ui/src/components/AssetDetailPanel.tsx`. **Architecture change from plan:** Panel is NOT a fixed-width CSS grid column. Instead, it's an always-mounted flex sibling with animated `width: 0 → 320px` (0.28s ease transition). The gallery grid uses `repeat(auto-fill, minmax(200px, 1fr))` and reflows automatically when the panel opens/closes.
  - **Deliverable:** Single-file component with PanelHeader, FrameBar, TabBar, InfoTab, HistoryTab, PlaceholderTab, action buttons

- [x] **1.2 — Create `DetailPanelHeader` component:** Integrated into `AssetDetailPanel.tsx` as `PanelHeader`. Shows `"{ShotCode} {AssetName} · {MediaType}"` with close button. Separate `FrameBar` shows `"Frame {start} of {end}"` + timecode.

- [x] **1.3 — Create `DetailPanelTabs` component:** Integrated as `TabBar`. INFO | AOVS | VAST | HISTORY tabs with `role="tablist"` / `role="tab"` / `role="tabpanel"` semantics. Arrow key navigation. AOVs and VAST show "Coming soon" placeholder.

- [x] **1.4 — Integrate panel into `AssetBrowser.tsx`:** Single-click opens detail panel, double-click opens MediaPreview modal. **Architecture change:** Gallery uses plain CSS Grid with `auto-fill` (no virtualizer). Virtualizer retained for list/compact modes only. Panel is always-mounted with animated width.
  - **Commit:** `5177e49` (responsive grid refactor)

### Tasks — Info Tab

- [x] **1.5 — Create `InfoTab` component:** Matches mockup layout with sections: SEQUENCE (frames, FPS, resolution, bit depth, channels, compression), COLOR SCIENCE (colorspace in accent color), PRODUCTION (project, sequence, shot, version, status with colored dot, size, ingested date), TAGS (auto-derived pills from real data), PROVENANCE (DCC, version, stage, artist), STORAGE (element path, handle, protocol URIs).
  - **Implementation note:** Section headers use mockup style — monospace uppercase with horizontal rule divider. `MetaRow` supports `accent` prop for highlighted values. `StatusRow` shows colored dot + label.

- [x] **1.6 — Add action buttons to Info tab:** Sticky footer with: "Open in RV Player" (full-width accent, `rvlink://` URI), "Copy Path" (clipboard), "Proxy" (placeholder), "Pipeline" (placeholder), "Delete" (red, placeholder). All buttons use real `elementPath ?? vastPath ?? sourceUri`.

- [x] **1.7 — Wire Info tab to version detail API:** Fetches `fetchVersionDetail(currentVersionId, ["info"])` on asset selection. Skeleton loading states. Resets on asset change.

### Tasks — History Tab

- [x] **1.8 — Create History projection query (backend):** **Implementation change from plan:** Instead of a separate Trino query, the history timeline is built in-memory by `buildHistoryTimeline()` in `version-detail.ts`. It queries: `getProvenanceByVersion()` for pipeline events, `listApprovalsByVersion()` for approval events, and constructs created/published events from the Version object itself. Normalized to `{ eventType, actor, at, detail }[]` sorted by timestamp DESC.
  - **Rationale:** Avoids adding a new Trino UNION ALL query; works with LocalPersistenceAdapter for dev/test.

- [x] **1.9 — Add History tab to version detail endpoint:** `GET /versions/:id/detail?tabs=history` supported. Returns `history: VersionDetailHistoryEvent[]`.

- [x] **1.10 — Create `HistoryTab` component:** Vertical timeline with color-coded event dots: created (cyan +), published (green P), pipeline (cyan gear), submit_for_review (yellow S), approve (green ✓), reject (red ✗), request_changes (orange R). Shows event detail, actor, and timestamp.

- [x] **1.11 — Wire History tab to version detail API:** Lazy-fetches on tab activation (not on initial load). Skeleton loading. Cached — won't re-fetch on tab re-visit.

### Tasks — Accessibility

- [x] **1.12 — Panel focus management:** `tabIndex={-1}` on panel container. Auto-focuses panel on asset selection. Escape closes panel (scoped to panel element via `document.activeElement` check).

- [ ] **1.13 — Stats bar semantics:** Convert top stats bar from `<div>` to `<dl>`. **Not yet implemented** — deferred (no stats bar in current AssetBrowser page).

### Validation

- [x] **V1.1 — Panel opens on asset click:** Single-click card → panel slides in with Info tab
- [x] **V1.2 — Panel closes on toggle/Escape:** Close button and Escape key close panel; animated width transition
- [x] **V1.3 — Info tab shows all metadata sections:** SEQUENCE, COLOR SCIENCE, PRODUCTION, TAGS, PROVENANCE, STORAGE all render
- [x] **V1.4 — History tab shows lifecycle events:** Created event always present; approval/provenance events shown when available
- [x] **V1.5 — RV Player button works:** Click → `rvlink://` URI opened
- [x] **V1.6 — Tab keyboard navigation:** Arrow keys cycle between tabs
- [x] **V1.7 — Grid adjusts when panel open:** `auto-fill` CSS Grid reflows automatically (no fixed column count)
- [x] **V1.8 — All existing tests pass:** 250 web-ui tests, 14 new control-plane tests. 10 AssetBrowser tests (including new gallery-renders-all-cards test).

### Exit Criteria — ALL MET (except 1.13)

- ✅ Detail panel renders with Info and History tabs fully functional
- ✅ Action buttons (RV Player, Copy Path, Proxy, Pipeline, Delete) rendered
- ✅ Panel is accessible (keyboard, Escape, focus management)
- ✅ AOVs and VAST tabs show "Coming soon" placeholder
- ✅ No `vast://` URIs anywhere in the UI
- ⏳ Stats bar `<dl>` semantics deferred (Task 1.13)

### Architecture Changes from Original Plan

| Original Plan | Actual Implementation | Reason |
|---|---|---|
| Fixed 360px panel, grid-cols 4→3 | 320px animated panel, `auto-fill minmax(200px, 1fr)` | Mockup uses responsive auto-fill; tiles auto-resize on browser/font changes |
| Virtualizer for all view modes | Virtualizer for list/compact only; gallery uses plain CSS Grid | `auto-fill` is incompatible with virtualizer's fixed row model; gallery <500 cards doesn't need virtualization |
| Separate InfoTab.tsx, HistoryTab.tsx files | All integrated in AssetDetailPanel.tsx | Single-file component is simpler; can extract later if needed |
| Trino UNION ALL for history projection | In-memory timeline from existing persistence methods | Works with LocalPersistenceAdapter; avoids new Trino query |

---

## Phase 2: AOVs Tab — Structured Channel Data

**Objective:** Extract, store, and display structured AOV channel data for EXR sequences.

### Tasks

- [ ] **2.1 — Define `AovChannel` type:** In `domain/models.ts`, add: `interface AovChannel { id: string; versionId: string; aovName: string; layerName: string | null; channelNames: string[]; colorSpace: string | null; dataType: string | null; sortOrder: number; }`. Export from barrel.
  - **Deliverable:** Type definition
  - **Dependencies:** None
  - **Owner:** backend-agent

- [ ] **2.2 — Add `version_aovs` table to migration 012:** `CREATE TABLE IF NOT EXISTS ${S}.version_aovs (id VARCHAR(36), version_id VARCHAR(36), aov_name VARCHAR(100), layer_name VARCHAR(100), channel_names VARCHAR(500), color_space VARCHAR(50), data_type VARCHAR(20), sort_order INTEGER, created_at TIMESTAMP(6))` sorted by `version_id, sort_order`.
  - **Deliverable:** Updated migration 012
  - **Dependencies:** 0.2 (migration 012 exists)
  - **Owner:** backend-agent

- [ ] **2.3 — Add Trino queries for AOVs:** `insertVersionAov()`, `queryVersionAovs(versionId)`, `deleteVersionAovs(versionId)` in `vast-trino-queries.ts`.
  - **Deliverable:** 3 query functions
  - **Dependencies:** 2.2
  - **Owner:** backend-agent

- [ ] **2.4 — Extend exr-inspector to group channels into AOV layers:** In `services/dataengine-functions/exr-inspector/src/inspector.py`, add post-processing to `_parse_oiiotool_output` that groups raw channel names (e.g., `beauty.R`, `beauty.G`, `beauty.B`) into structured AOV layers. Output new `aov_layers` field in metadata: `[{ name: "beauty", channels: ["R","G","B"], data_type: "half" }]`.
  - **Deliverable:** Updated `inspector.py` with AOV grouping logic + 3 unit tests
  - **Dependencies:** None (parallel with 2.1–2.3)
  - **Owner:** python-agent

- [ ] **2.5 — Persist AOV data on ingest:** In `events/processor.ts`, when processing a `vast.dataengine.pipeline.completed` event from exr-inspector, extract `aov_layers` from metadata and insert rows into `version_aovs` table via new persistence method.
  - **Deliverable:** Updated event processor
  - **Dependencies:** 2.3, 2.4
  - **Owner:** backend-agent

- [ ] **2.6 — Add AOVs to version detail endpoint:** Extend `GET /versions/:id/detail?tabs=aovs` to query `version_aovs` and return structured `aovs: AovChannel[]`.
  - **Deliverable:** Updated route handler
  - **Dependencies:** 2.3, 0.4
  - **Owner:** backend-agent

- [ ] **2.7 — Create `AovsTab` component:** Grid/list of AOV channels with name, channel count, data type, color space. Visual pill selector in `DetailPanelHeader` driven by AOV list (`role="radiogroup"` semantics). Selecting an AOV sets `selectedAov` state for future viewer integration.
  - **Deliverable:** `AovsTab.tsx` with AOV channel selector
  - **Dependencies:** 1.3, 2.6
  - **Owner:** frontend-agent

- [ ] **2.8 — Wire AOVs tab to API:** Fetch on tab activation, map response, skeleton loading.
  - **Deliverable:** Data-connected AOVs tab
  - **Dependencies:** 2.6, 2.7
  - **Owner:** frontend-agent

### Validation

- [ ] **V2.1 — exr-inspector extracts AOV layers:** Test with multi-layer EXR → structured `aov_layers` output
- [ ] **V2.2 — AOV data persisted on ingest:** Ingest EXR → query `version_aovs` → rows returned
- [ ] **V2.3 — AOVs tab displays channels:** Select EXR asset → AOVs tab → channel list renders
- [ ] **V2.4 — AOV selector uses radio semantics:** Keyboard accessible, `aria-checked` toggles

### Exit Criteria

- AOV channels extracted from EXR at ingest and persisted in `version_aovs`
- AOVs tab displays channel list with names, types, color spaces
- AOV pill selector in panel header reflects available channels
- All tests pass

### Dependencies for Next Phase

- None (Phase 3 is independent)

---

## Phase 3: VAST Tab — Platform Storage Metadata

**Objective:** Display VAST-specific storage information: element identity, data reduction, protection, S3 tags.

### Tasks

- [ ] **3.1 — Add `vast_platform_metrics` table to migration 012:** `CREATE TABLE IF NOT EXISTS ${S}.vast_platform_metrics (version_id VARCHAR(36), logical_size BIGINT, physical_used BIGINT, data_reduction_ratio DOUBLE, snapshot_policy VARCHAR(100), snapshot_count INTEGER, replication_status VARCHAR(50), measured_at TIMESTAMP(6))` sorted by `version_id, measured_at DESC`.
  - **Deliverable:** Updated migration 012
  - **Dependencies:** 0.2
  - **Owner:** backend-agent

- [ ] **3.2 — Add Trino queries for VAST metrics:** `insertVastPlatformMetrics()`, `queryLatestVastMetrics(versionId)` in `vast-trino-queries.ts`.
  - **Deliverable:** 2 query functions
  - **Dependencies:** 3.1
  - **Owner:** backend-agent

- [ ] **3.3 — Extend storage-metrics-collector for VAST Catalog data:** In `services/dataengine-functions/storage-metrics-collector/`, add logic to query VAST Catalog via Trino for element-level metrics (`size`, `used`, computed reduction ratio) when `elementHandle` is available. Publish as extended CloudEvent.
  - **Deliverable:** Updated function with VAST Catalog query + 2 unit tests
  - **Dependencies:** None (parallel)
  - **Owner:** python-agent

- [ ] **3.4 — Add VAST metrics to version detail endpoint:** Extend `GET /versions/:id/detail?tabs=vast` to return: element handle, element path, resolved protocol URIs (via ProtocolResolver), logical/physical size, reduction ratio, snapshot info, S3 tags, `measured_at` staleness indicator. Gate behind `platform_operator` or `administrator` role.
  - **Deliverable:** Updated route handler with RBAC gating
  - **Dependencies:** 3.2, 0.3, 0.4
  - **Owner:** backend-agent

- [ ] **3.5 — Create `VastTab` component:** 4 sections: Element Identity (handle, path, type), Storage Efficiency (logical vs physical size, reduction ratio bar), Access Protocols (resolved URIs with copy buttons per protocol), Protection (snapshot policy, count, replication status). Show `measured_at` timestamp with "Refresh" button for admins.
  - **Deliverable:** `VastTab.tsx` with 4 sections
  - **Dependencies:** 1.3, 3.4
  - **Owner:** frontend-agent

- [ ] **3.6 — Wire VAST tab to API:** Fetch on tab activation, handle permission denied (show "Insufficient permissions" message for non-admin users), skeleton loading.
  - **Deliverable:** Data-connected VAST tab with permission handling
  - **Dependencies:** 3.4, 3.5
  - **Owner:** frontend-agent

### Validation

- [ ] **V3.1 — VAST metrics stored on collection:** storage-metrics-collector populates `vast_platform_metrics`
- [ ] **V3.2 — VAST tab shows storage info:** Element handle, path, and protocol URIs render
- [ ] **V3.3 — Data reduction ratio displays:** Logical vs physical size with ratio
- [ ] **V3.4 — RBAC enforced:** Non-admin user sees "Insufficient permissions" on VAST tab
- [ ] **V3.5 — ProtocolResolver returns correct URIs:** NFS, SMB, S3 paths resolve correctly from config

### Exit Criteria

- VAST tab renders element identity, storage efficiency, protocol URIs, and protection status
- RBAC prevents non-admin access to VAST storage details
- Data reduction ratio sourced from cached metrics (not real-time VAST API)
- All tests pass

### Dependencies for Next Phase

- None (Phase 4 is independent)

---

## Phase 4: Tagging System + Polish

**Objective:** Implement user-applied tags, status display refinements, and remaining action buttons.

### Tasks

- [ ] **4.1 — Create `asset_tags` table in migration 012:** `CREATE TABLE IF NOT EXISTS ${S}.asset_tags (id VARCHAR(36), asset_id VARCHAR(36), tag VARCHAR(100), applied_by VARCHAR(36), applied_at TIMESTAMP(6))` sorted by `asset_id, tag`.
  - **Deliverable:** Updated migration 012
  - **Dependencies:** 0.2
  - **Owner:** backend-agent

- [ ] **4.2 — Add tag CRUD queries:** `insertTag()`, `queryTagsByAsset(assetId)`, `deleteTag(assetId, tag)` in `vast-trino-queries.ts`.
  - **Deliverable:** 3 query functions
  - **Dependencies:** 4.1
  - **Owner:** backend-agent

- [ ] **4.3 — Add tag API endpoints:** `POST /api/v1/assets/:id/tags` (add tag), `DELETE /api/v1/assets/:id/tags/:tag` (remove tag), `GET /api/v1/assets/:id/tags` (list tags). Guard write ops behind `metadata_write:own` permission.
  - **Deliverable:** 3 route handlers with RBAC + 4 unit tests
  - **Dependencies:** 4.2
  - **Owner:** backend-agent

- [ ] **4.4 — Auto-derive system tags on ingest:** When asset is ingested, auto-generate tags from: `color_space` → colorspace tag, shot/sequence IDs → hierarchy tags, AOV names → channel tags. Store with `applied_by: "system"`.
  - **Deliverable:** Tag derivation logic in event processor
  - **Dependencies:** 4.2
  - **Owner:** backend-agent

- [ ] **4.5 — Add tag display + editing to Info tab:** In the TAGS section of `InfoTab`, show existing tags as chips. System tags have distinct styling (no delete button). User tags have X button to remove. "+ Add" button opens inline input for new tag.
  - **Deliverable:** Updated InfoTab TAGS section with add/remove
  - **Dependencies:** 4.3, 1.5
  - **Owner:** frontend-agent

- [x] **4.6 — Refine status display:** Status mapping implemented in `AssetDetailPanel.tsx`: pending→WIP, processing→Rendering, qc_pending/qc_in_review→Review, qc_approved→Approved, published→Published, retake→Retake. Shows colored dot + label via `StatusRow` component.
  - **Note:** Implemented as part of Phase 1 InfoTab work.

- [ ] **4.7 — Add on-demand proxy trigger endpoint:** `POST /api/v1/versions/:id/proxy` — enqueues oiio-proxy-generator for the version's source URI. Returns 202 Accepted. Guard behind `ingest:create` permission.
  - **Deliverable:** Route handler + 2 tests
  - **Dependencies:** None (parallel)
  - **Owner:** backend-agent

- [ ] **4.8 — Wire Proxy button to trigger:** If `proxy` is null on the version, "Proxy" button calls the trigger endpoint and shows loading state. If proxy exists, show proxy URI with "View" action.
  - **Deliverable:** Updated Proxy button behavior
  - **Dependencies:** 4.7, 1.6
  - **Owner:** frontend-agent

### Validation

- [ ] **V4.1 — Tags persist:** Add tag via API → query → tag returned
- [ ] **V4.2 — Auto-tags generated on ingest:** Ingest EXR → auto-tags created (colorspace, sequence, shot)
- [ ] **V4.3 — Tag UI works:** Click "+ Add" → type tag → appears as chip → click X → removed
- [x] **V4.4 — Status labels match mockup:** WIP, Rendering, Review, Approved, Published display correctly
- [ ] **V4.5 — Proxy trigger works:** Click "Generate Proxy" → 202 response → loading indicator

### Exit Criteria

- User-applied tags stored and displayed
- System tags auto-derived from metadata on ingest
- ✅ Status labels match VFX industry conventions (done)
- Proxy generation triggerable from detail panel
- All tests pass

---

## Recommended Agent Assignments

| Agent Type | Tasks | Workstream |
|---|---|---|
| **backend-agent** | ~~0.1, 0.2, 0.3, 0.4, 0.7~~, 1.13, 2.1–2.3, 2.5–2.6, 3.1–3.2, 3.4, 4.1–4.4, 4.7 | API + persistence |
| **frontend-agent** | ~~0.5, 0.6, 1.1–1.7, 1.10–1.12~~, 2.7–2.8, 3.5–3.6, 4.5, 4.8 | React components |
| **python-agent** | 2.4, 3.3 | DataEngine functions |

---

## Critical Path

```
0.1 → 0.2 → 0.4 → 1.7 (Info tab with live data)          ✅ DONE
                  ↘ 1.9 → 1.11 (History tab with live data) ✅ DONE
0.7 → 1.4 → 1.1 → 1.2/1.3 (Panel shell visible)           ✅ DONE
```

**Minimum viable delivery:** Phase 0 + Phase 1 = ✅ SHIPPED
**Next critical path:** Migration 012 DDL → Phase 2 (AOVs) + Phase 3 (VAST) in parallel

---

## Parallel Workstreams

```
Stream A (backend):  0.1 → 0.2 → 0.4 → 1.8 → 1.9          ✅ ALL DONE
Stream B (frontend): 0.5 → 1.1 → 1.2/1.3 → 1.4 → 1.5/1.10 ✅ ALL DONE
Stream C (python):   2.4 (exr-inspector AOV grouping — independent)
Stream D (backend):  0.3 + 0.7 (parallel, no deps)           ✅ ALL DONE
```

**Phase 2 and Phase 3 are fully independent** — can execute in parallel once Migration 012 is written.
**Phase 4 tasks 4.1–4.4 and 4.7 are parallel** with Phase 2/3 frontend work.

---

## Risks & Unknowns

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| **Migration 012 scope creep** | Tasks 0.2, 2.2, 3.1, 4.1 all add to migration 012. Must be bundled into one migration. | Assign all migration DDL to one agent. Batch before execution. | Open |
| **Camera metadata gap** | Mockup shows ARRI ALEXA 35, Lens, T-Stop — no domain model fields exist. | Defer camera metadata to Phase 5. Info tab omits these fields. | Accepted |
| **VAST Catalog availability** | Phase 3 VAST tab depends on Trino queries against VAST Catalog. No real cluster connected. | Use mock data in local dev. Gate VAST tab behind feature flag. | Open |
| **Non-EXR format inspectors** | VDB/USD/ABC/HIP shown in mockup — all opaque blobs today. | Show basic file info (size, type, timestamps) for non-EXR. Defer deep metadata extraction to Phase 5+. | Accepted |
| **Render progress %** | Mockup shows "RENDERING 67%" — no `progressPercent` field. | Show "Rendering..." (binary) from `processing` status. Defer percentage to Phase 5. | Accepted |
| **exr-inspector AOV grouping** | Parser change could break existing EXR metadata flow. | Add AOV grouping as additive field (`aov_layers`), keep existing flat `channels` array unchanged. | Open |
| **Gallery performance at scale** | Plain CSS Grid (no virtualizer) for gallery — may lag at 500+ cards. | Architect recommended ResizeObserver-based measured column count fed into virtualizer as upgrade path. Current threshold is ~300-400 cards. | Accepted — monitor |

---

## Migration 012 — Consolidated DDL Checklist

All schema additions MUST be bundled into one migration to maintain the sequential contract.

- [ ] `ALTER TABLE versions ADD COLUMN element_path VARCHAR(1024)` (Phase 0)
- [ ] `CREATE TABLE version_aovs (...)` (Phase 2)
- [ ] `CREATE TABLE vast_platform_metrics (...)` (Phase 3)
- [ ] `CREATE TABLE asset_tags (...)` (Phase 4)
- [ ] `INSERT INTO schema_version VALUES (12, ...)` (version record)

**Owner:** backend-agent, must execute BEFORE any downstream Phase 2/3/4 work.

---

## Commits

| Commit | Description |
|---|---|
| `bbac9ec` | feat: asset detail panel with version detail API, protocol resolver, and vast:// removal |
| `5177e49` | refactor: responsive auto-fill grid for gallery, virtualizer for list/compact only |
