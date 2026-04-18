# Metadata Plumbing Cleanup — Design

**Date:** 2026-04-18
**Branch:** `fix/metadata-plumbing-cleanup`
**Context:** Post-Phase-5.5 smoke-test surfaced four pre-existing metadata plumbing bugs. Bug A shipped with Phase 5.5. This cycle resolves B, C, D, and deprecates the two legacy metadata endpoint families.

## Goal

Make metadata routing fully config-driven and format-correct end-to-end, eliminating the last two "EXR-centric" legacy paths.

## Source documents

- [`docs/issues/2026-04-17-metadata-plumbing-followups.md`](../../issues/2026-04-17-metadata-plumbing-followups.md) — canonical bug characterization for B / C / D plus the legacy-endpoint deprecation.
- [`docs/superpowers/specs/2026-04-17-phase-5.5-metadata-pipelines-admin-design.md`](./2026-04-17-phase-5.5-metadata-pipelines-admin-design.md) — Phase 5.5 spec (status pill semantics, `/metadata/lookup` admin proxy, seed JSON).
- [`docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md`](./2026-04-16-asset-metadata-db-reader-design.md) — C-1b spec (the `/assets/:id/metadata` route this cycle migrates storage-browser onto).

## Decision summary

| Question | Decision |
|---|---|
| Bug D.2 (Process/Reprocess actions) scope | Time-boxed 1-day spike inside Layer C; exit criteria gated on root-cause shape |
| Legacy endpoint deprecation timing | Delete in this same cycle, immediately after A+B+C ship and smoke-test passes |
| Bug B fallback visibility | Silent to callers; server-side `warn` log only |
| Bug D.1 classifier scope | Reshape `metadataKindForFilename` to accept an optional pipelines list; keep static sets as named fallback |
| Overall sequencing | Four concern-layers, subagent-driven, independent where possible |

## Architecture

Four independent layers with an explicit dependency graph.

```
Layer A (vastdb-query)           Layer B (classifier)
  /metadata/lookup                metadataKindForFilename +
  bucket-stripped fallback        findPipelineForFilename
  structured warn-log             reshape
         │                              │
         │                              ▼
         │                       Layer C (legacy-caller migration)
         │                        C.1  Asset-ID surfaces →
         │                             useAssetMetadata(assetId)
         │                        C.2  Storage-browser →
         │                             useStorageSidecar(sourceUri)
         │                             + <img> → format branch
         │                             + empty-state copy
         │                        D.2 spike (1 day, inside C.2)
         │                              │
         └──────────────┬───────────────┘
                        ▼
                 Layer D (cleanup)
                  delete 4 web-ui helpers
                  delete 2 control-plane passthroughs
                  delete 8 Python endpoints
                  release note + admin-guide update
```

- Layer A is independent — runs in parallel with B.
- Layer B blocks Layer C.
- Layer D is a hard gate after A+B+C ship and smoke-test passes. Two grep checks enforce zero remaining legacy callers before deletion.

### Services touched (LOC estimate)

| Service | Files | Est. LOC |
|---|---|---|
| `services/vastdb-query/` | `main.py`, tests | +40 / –0 |
| `services/web-ui/` | `utils/metadata-routing.ts`, `pages/StorageBrowserPage.tsx`, `pages/AssetBrowser.tsx`, `pages/AssetDetail.tsx`, `components/AssetDetailPanel.tsx`, `api.ts`, tests | +120 / –200 |
| `services/control-plane/` | `routes/exr-metadata.ts`, `routes/video-metadata.ts`, `app.ts` | +0 / –150 (Layer D) |

## Components & contracts

### Layer A — `services/vastdb-query/main.py`

Modified: `/api/v1/metadata/lookup` handler. **Response shape unchanged.** New internal behavior:

```
1. Query primary: WHERE s3_key = <path> OR file_path = <path>
2. If count == 0 AND path contains "/":
     fallback_path = path.split("/", 1)[1]
     Query fallback: WHERE s3_key = <fallback_path> OR file_path = <fallback_path>
     If count > 0:
       log.warn("metadata_lookup.fallback_hit", path=<orig>, fallback=<stripped>, schema=<s>, table=<t>)
       return fallback result
3. Return result (primary, fallback, or empty)
```

Guardrail: only strip if something remains after the first slash.

### Layer B — `services/web-ui/src/utils/metadata-routing.ts`

Reshape the classifier so pipelines are the authoritative source with the static sets as a named fallback:

```typescript
// NEW primary API
export function classifyForPipelines(
  filename: string,
  pipelines: DiscoveredPipeline[] | null,
): { kind: MetadataKind; pipeline: DiscoveredPipeline | null };

// EXISTING — unchanged signature, continues to use static sets
export function metadataKindForFilename(filename: string): MetadataKind;
```

- `pipelines` non-null → match file extension against each pipeline's `extensions` list; return `{kind, pipeline}`. `kind` derives from pipeline's `fileKind` (`"image" | "video" | "raw_camera"`).
- `pipelines` null (still discovering) → fall through to the static-set path. Same behavior as today; preserves `useStorageSidecar`'s on-mount eligibility gate.
- `MetadataKind` type extends from `"image" | "video" | "none"` to also include `"raw_camera"` to reflect the pipeline contract.

### Layer C — legacy-caller migration + storage-browser fixes

Legacy helpers `fetchExrMetadataLookup` / `fetchVideoMetadataLookup` are called from four web-ui files. C-1b partially migrated `AssetDetailPanel.MetadataTab` to `fetchAssetMetadata(assetId)` / `useAssetMetadata`, but the remaining surfaces still call the legacy helpers. Layer D's cleanup cannot ship until all four are migrated.

#### C.1 — Asset-ID-keyed surfaces (three files)

All three surfaces have an `assetId` in scope. Migrate to the existing `useAssetMetadata(assetId)` hook / `fetchAssetMetadata(assetId)` call added in C-1b.

- `services/web-ui/src/pages/AssetBrowser.tsx` — replace `fetchExrMetadataLookup` / `fetchVideoMetadataLookup` usage (lines 508, 513, 519, 522) with `useAssetMetadata(asset.id)` in the component that owns the state.
- `services/web-ui/src/pages/AssetDetail.tsx` — replace `fetchExrMetadataLookup(a.sourceUri)` (line 38) with `useAssetMetadata(a.id)`.
- `services/web-ui/src/components/AssetDetailPanel.tsx` — replace the remaining non-MetadataTab `fetchExrMetadataLookup(asset.sourceUri)` call (line 1244). Verify whether this duplicates the MetadataTab's existing `useAssetMetadata` call; if so, lift state up.

Rendering switches from EXR/video-specific field lists to the generic grouped-by-family layout already used by `AssetDetailPanel.MetadataTab`. If the caller renders custom bespoke views on top of the legacy response, those views move to the `sidecar` data path (same fields, format-neutral JSON).

#### C.2 — Storage-browser (path-keyed)

`StorageBrowserPage.FileDetailSidebar` has no `assetId` — it works on S3 paths. Migration target: the existing `useStorageSidecar(sourceUri)` hook + `/storage/metadata` control-plane route (already in the codebase). The sidecar is format-neutral: both extractors write `_metadata.json` containing the same fields as the DB row, so the sidecar is the natural parity path for a path-keyed surface.

Three behavioral changes:

1. **Metadata lookup** — replace `fetchExrMetadataLookup` / `fetchVideoMetadataLookup` with `useStorageSidecar(sourceUri)`. Render `sidecar.data` as grouped key-value sections (re-use the `Section` / `DetailRow` primitives already in this file). The bespoke EXR-channels / parts sections are dropped — they were reading EXR-specific response fields that don't exist in the sidecar JSON.
2. **Preview pane** — branch on `classifyForPipelines(filename, pipelines).kind`:
   - `image` → `<img src={previewUrl} />`
   - `video` → `<video src={previewUrl} controls muted />`
   - `raw_camera` → "No preview available for raw camera files"
   - `none` → existing "No preview" fallback
3. **Empty-state copy** — replace `"No EXR metadata available"` with format-neutral copy routed by `kind`:
   - `kind === "none"` → `"No pipeline configured for .{ext}"` + link to `/automation/pipelines`
   - otherwise → `"No metadata extracted yet. The file may not have been processed."`

**Note on DB-but-no-sidecar edge case.** The current legacy path reads VastDB, not sidecar. If an extractor writes the DB row but fails to write the sidecar (rare; should be atomic), storage-browser will show "No metadata extracted yet" while the DB has the row. Accepted trade-off: sidecar-only avoids adding a new path-keyed control-plane route, and the failure mode is diagnosable via the existing `/metadata/lookup` admin proxy. Tracked as a follow-up if it becomes a real operational issue.

#### D.2 spike (time-boxed 1 day)

Investigate `requestProcessing` at line 519. Probes:

- `POST /api/v1/storage/process` with a working file's sourceUri → confirm 200.
- Same endpoint with a failing file's sourceUri → inspect response + server logs.
- Grep the storage-process route for extension/kind filtering logic.

**Exit criteria (decided day 1 of investigation):**

- If root cause is a hardcoded classifier on the process route → fix inside Layer C using `classifyForPipelines`.
- If root cause is worker dispatch, event broker topic routing, or permissions → carve out to a separate `fix/process-actions` branch with its own brainstorm. Layer C ships without D.2.

### Layer D — cleanup

Grep-verified deletions (see Error Handling → Delete-gate protection):

- `services/web-ui/src/api.ts` — `fetchExrMetadataLookup`, `fetchVideoMetadataLookup`, `fetchExrMetadataStats`, `fetchVideoMetadataStats` + response types.
- `services/control-plane/src/routes/exr-metadata.ts` — delete file + `app.ts` registration.
- `services/control-plane/src/routes/video-metadata.ts` — delete file + `app.ts` registration.
- `services/vastdb-query/main.py` — 8 endpoints (`stats`, `files`, `files/{id}`, `lookup`) × 2 domains + env-bound helpers.

No code additions in Layer D. Release note and admin-guide-metadata-pipelines update only.

## Data flow

### Current (broken, for contrast)

```
User selects file in StorageBrowser
  ├── file kind decided by hardcoded METADATA_IMAGE_EXTS / METADATA_VIDEO_EXTS
  ├── metadata fetch branches on kind:
  │     image → /api/v1/exr-metadata/lookup  (env-bound schema)
  │     video → /api/v1/video-metadata/lookup (env-bound schema)
  │     none  → no fetch, "No EXR metadata available" placeholder
  └── preview fetch: fetchMediaUrls → ALWAYS <img>

video extractor stores s3_key WITHOUT bucket; EXR with bucket → video lookups miss
```

### New (all four layers in place)

```
Admin sets dataEnginePipelines in Platform Settings
  ↓
useDataEnginePipelines() loads + caches discovered pipelines
  ↓
User selects file in StorageBrowser (FileDetailSidebar mounts)
  ├─┬── classifyForPipelines(filename, pipelines)
  │ │     returns { kind, pipeline } — pipeline holds schema/table/functionName
  │ │     (used for preview-branch decision + empty-state routing)
  │ │
  │ ├── metadata fetch: useStorageSidecar(sourceUri)  ← path-keyed
  │ │     → control-plane GET /api/v1/storage/metadata?sourceUri=
  │ │     → S3 _metadata.json sidecar (format-neutral JSON)
  │ │
  │ │   (Asset-ID-keyed surfaces — AssetBrowser/AssetDetail/AssetDetailPanel —
  │ │    use useAssetMetadata(assetId) → GET /assets/:id/metadata, which goes
  │ │    through vastdb-query /metadata/lookup and benefits from Layer A's
  │ │    bucket-stripped fallback.)
  │ │
  │ └── preview fetch: fetchMediaUrls(sourceUri) → routed by kind:
  │            image      → <img>
  │            video      → <video controls muted>
  │            raw_camera → "No preview available" panel
  │            none       → "No preview" panel
  │
  └── empty-state: format-neutral; kind==="none" → CTA to /automation/pipelines
```

### Cross-layer signal path

- Layer A writes one structured log line per fallback hit. Ops can alert on rate. No response-shape change.
- Layer B's classifier reads the same discovered-pipelines cache that `MetadataPipelinesPage` populates — zero duplicate fetches.
- Layer C delegates all format/schema questions to Layer B. No hardcoded extension sets or function names remain in storage-browser.
- Layer D's grep gate (see Error Handling) fires before any deletion.

## Error handling

### Layer A — vastdb-query fallback

| Scenario | Response | Log |
|---|---|---|
| Primary hit | `count >= 1, matched_by` | — |
| Primary miss, fallback hit | Same shape as primary | `warn("metadata_lookup.fallback_hit", ...)` |
| Primary miss, fallback miss | `count: 0, matched_by: null` | — (genuine empty) |
| Path without `/` to strip | `count: 0, matched_by: null` | — (fallback skipped) |
| Table/schema doesn't exist | 503 + dict-shaped detail (existing TargetProbe behavior) | existing error log |
| Downstream SDK error | 503 + plain-text detail (existing) | existing error log |

Invariants:
- Fallback is silent to callers.
- Fallback only fires on `count == 0` from the primary query, not on errors.
- Log level is `warn` — drift signal, not a user-facing problem.

### Layer B — classifier edge cases

| Input | Output |
|---|---|
| `pipelines: null` (still discovering) | Static-set fallthrough — today's behavior |
| `pipelines: []` (empty config) | `{kind: "none", pipeline: null}` for everything |
| Filename with no extension | `{kind: "none", pipeline: null}` |
| Extension matches multiple pipelines | First match (validator prevents duplicates at write time) |
| Pipeline with `enabled: false` | Still returned — it's a classification, not a routing decision |

### Layer C — storage-browser error surfaces

| Condition | UI behavior |
|---|---|
| Storage-browser — `useStorageSidecar` throws | Error banner in sidebar; retry button; preview still attempts |
| Storage-browser — sidecar is `null` (not yet written) | Format-neutral "No metadata extracted yet" empty-state |
| Asset-ID surfaces — `useAssetMetadata` surfaces `database.status: "unreachable"` | Existing C-1b inline warning with `dbError` detail; sidecar still renders |
| `fetchMediaUrls` returns null | Existing "No preview" fallback |
| `kind: "none"` | Preview: "No preview"; metadata: "No pipeline configured for .{ext}" + CTA |
| `requestProcessing` throws (D.2) | Existing `processError` banner |

### Delete-gate protection (Layer D)

Before any deletion:

1. `grep -rn "fetchExrMetadataLookup\|fetchVideoMetadataLookup\|fetchExrMetadataStats\|fetchVideoMetadataStats" services/web-ui/src/ | grep -v "\.test\."` must return 0 matches outside release-notes / comments.
2. `grep -rn "/exr-metadata/\|/video-metadata/" services/control-plane/src/ services/web-ui/src/ | grep -v "\.test\." | grep -v release-notes` must return 0 matches.
3. Any grep failure fails the review gate — fix before proceeding.

Post-deletion smoke: Phase 5.5 + C-1b smoke tests must pass against the stripped-down vastdb-query. Regression in any of those surfaces → revert Layer D only.

## Testing

### Layer A — vastdb-query

Unit tests (same mock pattern as existing `main.py` tests — HMAC + SDK chain):

| Test | Assertion |
|---|---|
| Primary hits on bucket-prefixed key | `count >= 1`, no warn log |
| Primary miss + fallback hits on bucket-stripped key | `count >= 1`, response identical to primary, **warn log captured** |
| Primary miss + fallback miss | `count: 0`, no warn log |
| Path without `/` | `count: 0`, fallback skipped |
| SDK exception on primary | 503 relayed; no fallback attempt |
| Existing schema/table validation + target-probe tests | Pass unmodified |

### Layer B — classifier

Unit tests (`services/web-ui/src/utils/metadata-routing.test.ts`):

| Test | Assertion |
|---|---|
| `.exr` with image pipeline | `{ kind: "image", pipeline: <image> }` |
| `.mov` with video pipeline | `{ kind: "video", pipeline: <video> }` |
| `.r3d` with raw_camera pipeline | `{ kind: "raw_camera", pipeline: <raw> }` |
| `.xyz` no pipeline matches | `{ kind: "none", pipeline: null }` |
| `.exr` with `pipelines: null` | Static-set fallthrough → `kind: "image"`, `pipeline: null` |
| `.jpg` with `pipelines: []` | `{ kind: "none", pipeline: null }` |
| Existing `metadataKindForFilename` tests | Unchanged (back-compat invariant) |

### Layer C — storage-browser

Vitest + Testing Library (`StorageBrowserPage.test.tsx`):

| Test | Assertion |
|---|---|
| `.exr` renders `<img>`, not `<video>` | DOM query confirms |
| `.mov` renders `<video controls>` | DOM query confirms |
| `.r3d` renders "No preview available" text | Text present, no `<img>`/`<video>` |
| `.jpg` with no matching pipeline shows CTA | "No pipeline configured for .jpg" + link to `/automation/pipelines` |
| Metadata comes from `useStorageSidecar`, not legacy helpers | Spies assert the legacy calls never fire; `fetchStorageMetadata` called with sourceUri |
| Sidecar `null` (extractor hasn't written one) | Format-neutral "No metadata extracted yet" empty-state |
| Existing tests (processing pills, selection) | Unchanged |

Mock `useDataEnginePipelines` to return a realistic 3-pipeline config. Use `fireEvent.click` / `fireEvent.change` (codebase standard).

**D.2 spike verification (if folded in):** one test — clicking Process on `.jpg` with a configured image pipeline dispatches `requestProcessing` successfully. If spike finds deeper root cause, no test this cycle.

### Layer D — cleanup verification

No new tests. Gates are:

1. All existing Phase 5.5 + C-1b tests still pass.
2. Two grep checks (above) return zero matches.
3. Manual smoke-test checklist passes on `10.143.2.102`.

### Integration / contract tests

No new contract tests. Contracts touched:

- `/api/v1/metadata/lookup` — response shape unchanged.
- `/api/v1/assets/:id/metadata` — already has C-1b contract tests; source of truth.
- `/api/v1/exr-metadata/*`, `/api/v1/video-metadata/*` — deleted in Layer D with their contract tests.

### Manual smoke-test checklist (post-merge, `10.143.2.102`)

1. Asset browser → `.exr` → side panel shows >20 metadata fields, preview renders as image.
2. Asset browser → `.mov` → side panel shows video metadata (previously `DB · empty`), preview renders as playable `<video>`.
3. Storage browser → bucket navigation → `.exr` → image preview, metadata renders.
4. Storage browser → `.mov` → video preview (previously broken-image placeholder), metadata renders.
5. Storage browser → `.jpg` → "No pipeline configured for .jpg" empty-state with working CTA.
6. Storage browser → Process/Reprocess click → triggered-state pill appears (D.2 if in scope).
7. Pipelines page → no console errors (no legacy endpoint calls).
8. vastdb-query logs contain `metadata_lookup.fallback_hit` warn entries on video lookups.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| D.2 spike uncovers a deep root cause, blocks Layer C | Exit criteria defined upfront: carve out to `fix/process-actions` branch; Layer C ships without D.2. |
| Legacy endpoint has an external caller we missed | Grep gate catches internal callers; for externals, the 60-second deprecation logging (rejected in Q2) isn't in scope — user confirmed no external callers exist. |
| `useStorageSidecar` still uses static sets post-B | Accepted — classifier reshape preserves the sync fallback path so the hook's eligibility gate still works. Follow-up tracked in `metadata-routing.ts` JSDoc. |
| Layer A fallback masks an extractor drift that ought to be fixed upstream | `warn` log gives ops visibility; rate-alert-able. Long-term fix is extractor alignment (tracked separately via `dataengine-functions` team). |
| Response-shape parity for `fetchAssetMetadata` vs legacy lookups causes UI regressions | Vitest fixtures include both shapes; existing AssetDetailPanel and AssetBrowser tests already assert against the C-1b shape. |

## Out of scope

- `useStorageSidecar` refactor to read pipelines async (tracked as follow-up in `metadata-routing.ts` JSDoc).
- Extractor alignment to unify `s3_key` vs `bucket/key` at the write path (owned by `dataengine-functions` team).
- Any change to the admin Metadata Pipelines page (Phase 5.5 — already shipped).
- Bug A (EXR schema rename) — shipped in Phase 5.5.

## Next step

Invoke `superpowers:writing-plans` to produce an implementation plan covering Layers A / B / C / D with verbatim TDD steps, task-level acceptance criteria, and subagent-driven-development structure.
