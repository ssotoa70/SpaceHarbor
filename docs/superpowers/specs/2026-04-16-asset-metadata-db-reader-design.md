# Design: Asset Metadata DB Reader (C-1b) + Trino Config Fix

**Status:** approved, awaiting user spec review
**Date:** 2026-04-16
**Authors:** Sergio Soto + Claude
**Related tasks:** brainstorming tasks #7–#12 in this session

## 1. Problem

The dynamic `AssetDetailPanel` in the web UI renders nothing for the metadata tab. The panel calls `GET /api/v1/storage/metadata?sourceUri=…`, which attempts to read a `_metadata.json` sidecar from S3; that sidecar doesn't exist for current assets (live probe of `pixar_5603.exr` → `404 SIDECAR_NOT_FOUND`). Meanwhile, DataEngine extractors land rows in VAST Database tables at `vast."sergio-db/{frame_metadata,video_metadata}".files`, but **nothing in the read path of the UI queries those tables**. `git log --all -S "FROM video_metadata"` returns zero hits — the UI has never been wired to read these tables.

The user's request: make the panel read from the database tables declared in the pipeline config (schema/table already configurable via `default-pipelines.json`), while keeping the sidecar path as a fallback.

Independently: the `vast-trino` circuit breaker is OPEN on live (19 consecutive failures) because `VAST_DATABASE_URL` in the control-plane env points at the VAST S3 endpoint instead of the Trino coordinator. This blocks the SQL query console, analytics, and any future Trino-backed code — but does NOT block the new feature, which uses the `vastdb` Python SDK path (via the `vastdb-query` sidecar).

## 2. Goals and non-goals

**Goals**
- UI panel shows extracted metadata for assets whenever it's present in VAST DB, with the same dynamic/"Frame.io"-style UX the existing sidecar path uses.
- Sidecar continues to work as a fallback — the panel still renders when VAST DB is unreachable or rows haven't landed yet.
- Schema/table names are **fully config-driven** through the existing `dataEnginePipelines` platform setting — no container-env schema coupling (honors `feedback_no_hardcoded_values.md`).
- Trino connectivity is restored so the SQL query console and breaker state return to healthy.

**Non-goals**
- Not rewriting the extractors (`services/dataengine-functions/` is owned out-of-band per `feedback_dataengine_functions_deprecated.md`).
- Not changing the existing `/storage/metadata` endpoint — it stays for any remaining callers and is the transport for the sidecar branch of the new endpoint.
- Not adding a visual query builder or row filter — this feature surfaces existing rows, doesn't add new interaction.

## 3. Architecture

### 3.1 Components touched

```
web-ui                                control-plane                       vastdb-query (python)
───────                                ─────────────                       ────────────────────
AssetDetailPanel                       routes/asset-metadata.ts  (NEW)     main.py
  ├ useAssetMetadata (NEW hook) ──GET──►                         ─proxy──►  /api/v1/metadata/lookup (NEW)
  │                                      ├─ getAssetById (persistence)        path=... schema=... table=...
  │                                      ├─ getDataEnginePipelines            │
  │                                      ├─ proxyToVastdbQuery (NEW)          ▼ vastdb SDK
  │                                      └─ fetchStorageSidecar (existing)    VAST DB tables
  └ MetadataTab renderer (UPDATED)
```

### 3.2 New control-plane endpoint

```
GET /api/v1/assets/:id/metadata
  Auth: any authenticated user
  → 200
  {
    "assetId": "uuid",
    "sourceUri": "s3://<bucket>/<key>",
    "fileKind": "image" | "video" | "raw_camera" | "other",
    "pipeline": {
      "functionName": "frame-metadata-extractor",
      "targetSchema": "frame_metadata",
      "targetTable": "files",
      "sidecarSchemaId": "frame@1"
    } | null,
    "sources": {
      "db":      "ok" | "empty" | "unreachable" | "disabled",
      "sidecar": "ok" | "missing"
    },
    "dbRows":   [ { <row fields from target table> } ],
    "sidecar":  { <existing StorageMetadataResponse.data> } | null,
    "dbError":  "string"   // only present when sources.db === "unreachable"
  }
  → 404 ASSET_NOT_FOUND
  → 401 / 403 per normal auth
```

Flow:
1. `persistence.getAssetById(:id)` → `sourceUri`, derive `fileKind` via `inferFileKindFromUri` (existing helper). If not found → `404 ASSET_NOT_FOUND`.
2. `getDataEnginePipelines()` → match first pipeline where `fileKind` matches AND `enabled !== false`. If no match, or `sourceUri` doesn't parse as `s3://bucket/key`, `sources.db = "disabled"` and skip the DB call (pipeline field in response is `null`).
3. `Promise.allSettled([ dbLookup, sidecarFetch ])`:
   - `dbLookup` = proxy `GET /api/v1/metadata/lookup?path={encoded(s3key)}&schema={pipeline.targetSchema}&table={pipeline.targetTable}` to `vastdb-query`. The `path` value is the S3 key only (scheme + bucket stripped) so it matches what the extractor stored.
   - `sidecarFetch` = existing sidecar read path (same logic as `/storage/metadata`).
4. Resolve to `sources` statuses per Section 4 table. The control-plane endpoint always returns `200` when the asset exists — sub-source failures are reported inside the payload.

### 3.3 New vastdb-query endpoint

File: `services/vastdb-query/main.py` (~40 LOC addition)

```
GET /api/v1/metadata/lookup
  Query: path: str (required)   — S3 key or s3://bucket/key (strip scheme+bucket prefix before match)
         schema: str (required)
         table: str (default "files")
  Uses: vastdb.connect() with existing session pattern
        transaction → bucket(VASTDB_BUCKET).schema(schema).table(table)
        SELECT all columns WHERE source_uri == path (or matching key column)
  → 200 {
    "rows": [ { … } ],
    "bucket": "sergio-db",
    "schema": "frame_metadata",
    "table": "files",
    "matched_by": "path",
    "count": N
  }
  → 503 on SDK error (existing error handling pattern)
  → 404 only if bucket/schema/table doesn't exist
```

**Match column resolution:** first-present column from the priority list `["source_uri", "s3_key", "path", "file_path", "uri"]`. Implemented as a pure helper so tests don't need a live SDK. If none present, return `400` with a clear message naming the available columns — makes misconfiguration obvious.

**Why not reuse `/exr-metadata/lookup` / `/video-metadata/lookup`?** Those are hardcoded to env-bound `VASTDB_SCHEMA` / `VASTDB_VIDEO_SCHEMA`. The new endpoint takes schema + table per request so the pipeline config becomes the single source of truth — which was the user's explicit ask. The old endpoints stay for their current callers.

### 3.4 Pipeline config (no schema migration)

The `dataEnginePipelines` platform setting already carries `targetSchema` and `targetTable` per file kind (see `services/control-plane/src/data-engine/default-pipelines.json`). This design **does not** add any new config fields. To retarget or add a new file kind, admins update platform settings — no code change.

If a pipeline's `targetSchema`/`targetTable` disagree with the actual SDK-addressable table (as currently happens — `frame_metadata` in pipeline config vs `exr_metadata` in `VASTDB_SCHEMA` env), the DB query fails with a clear error and `sources.db = "unreachable"` with `dbError` populated. Operators update platform settings to reconcile.

## 4. Error, fallback, and edge behavior

| Situation | `sources.db` | `sources.sidecar` | Response |
|---|---|---|---|
| DB rows + sidecar | `ok` | `ok` | both populated |
| DB rows only | `ok` | `missing` | `dbRows` populated, `sidecar: null` |
| Sidecar only | `empty` | `ok` | `dbRows: []`, sidecar populated |
| No rows, no sidecar | `empty` | `missing` | 200, empty payloads, UI shows empty state |
| DB 5xx / timeout / circuit open | `unreachable` | whatever applies | sidecar as fallback, `dbError` set |
| No pipeline matches file kind (`other`, no declared pipeline) | `disabled` | whatever applies | sidecar only |
| Pipeline exists but `enabled: false` on the pipeline config | `disabled` | whatever applies | sidecar only |
| Asset's `sourceUri` is not an `s3://` URL (e.g. a local path) | `disabled` | whatever applies | sidecar only (also skipped) |
| Asset not in persistence | — | — | `404 ASSET_NOT_FOUND` |
| vastdb-query sidecar container down | `unreachable` | whatever applies | `dbError: "vastdb-query unreachable"` |

Empty state copy continues to name the pipeline's `functionName` so users know which extractor is responsible (preserves current `metadata-tab.test.tsx` assertion).

## 5. UI changes

**New hook** `services/web-ui/src/hooks/useAssetMetadata.ts`: `useAssetMetadata(assetId) → { status, data, error }`. Internal cache by `assetId` (60s TTL), matching the existing `useStorageSidecar` pattern. The existing `useStorageSidecar` hook stays available for any non-panel caller but is no longer used by the panel.

**MetadataTab** (`services/web-ui/src/components/AssetDetailPanel.tsx`):
- Header badge row: `DB · {status}` + `Sidecar · {status}` + pipeline function name.
- **Database fields** section: render `dbRows`. For a single row, render as a grouped table. For multiple rows (possible for EXR frame sequences), render as a stacked list with per-row summary. Column grouping is a presentation-only heuristic — the panel bins column names into families and renders each family as a labeled section. Concrete families for V1:
  - **Dimensions**: columns matching `/^(width|height|channels|bit_depth|pixel_aspect|display_window|data_window)$/i`
  - **Codec & color**: `/^(codec|pix_fmt|color_space|transfer|primaries|chroma|profile|level|bit_rate)$/i`
  - **Timing**: `/^(duration|frame_count|frame_rate|fps|timecode|start_frame|end_frame)$/i`
  - **File**: `/^(path|filename|size|sha256|md5|etag|mtime|created_at|modified_at)$/i`
  - **Other**: everything else, alphabetized
  Unknown columns appear in **Other** — the panel is therefore self-discovering for new extractor outputs without code changes, consistent with the `feedback_ui_dynamic_fields.md` rule. No config is introduced for the families; they're a rendering detail that can evolve independently.
- **Sidecar** section: existing render logic, unchanged, when `sidecar` is present.
- **Empty state** when both sources empty: existing copy, naming the pipeline function.

**Test:** `AssetDetailPanel.metadata-tab.test.tsx` updated. New cases: source badges render from stubbed `useAssetMetadata`; db rows group correctly into families; sidecar-only still works; empty state still surfaces the pipeline name.

## 6. Testing

| Layer | Coverage | File |
|---|---|---|
| vastdb-query SDK endpoint | pytest unit tests: column-priority resolver (pure), response shape, error paths with stubbed SDK | `services/vastdb-query/tests/test_metadata_lookup.py` (new — or pick an existing pattern) |
| Control-plane merge + route | contract tests: each row of the fallback matrix in Section 4, via `app.inject()` with stubbed vastdb-query (HTTP mock) and local persistence adapter | `services/control-plane/test/asset-metadata-route.test.ts` (new) |
| Control-plane pure resolver | unit test for the `resolveSourcesStatus({dbResult, sidecarResult})` function | same file (co-located) |
| Web UI hook + render | vitest: stub `useAssetMetadata`, assert on source badges + field-group rendering + empty-state copy | `services/web-ui/src/components/AssetDetailPanel.metadata-tab.test.tsx` (updated) |

Success criteria:
- All rows in the fallback matrix produce the expected `sources` + payload without throwing.
- Panel renders usefully when DB only, sidecar only, and neither source is available.
- Changing `targetSchema` in platform settings changes the queried table without code changes (covered by a contract test with two different pipeline configs).

## 7. Trino config fix (separate commit, same session)

Unrelated to C-1b but in scope per user direction. The live `VAST_DATABASE_URL` is pointing at the VAST S3 endpoint; the `vastdataorg/trino-vast` image's documented coordinator URL is `http://<host>:8080`, and the docker compose service is named `trino`.

Steps:
1. Update `~/SpaceHarbor/.env` on the remote: `VAST_DATABASE_URL=http://trino:8080` (was `http://172.200.201.67`).
2. `docker compose up -d control-plane`.
3. `POST /api/v1/admin/breakers/vast-trino/reset` with admin token.
4. Verify with `POST /api/v1/query/execute {"sql": "SELECT 1"}` → 200.
5. Verify breaker is `closed` via `GET /api/v1/admin/breakers`.

No repo code change is needed for this fix — `docker-compose.yml` already has the correct default `${VAST_DATABASE_URL:-http://trino:8080}`. The `.env` override on the remote is the only wrong thing. Documented in a `chore(deploy)` commit comment; the repo `.env.example` (if any) is also checked for the same stale value.

## 8. Rollout

One PR, three commits:
1. `feat(vastdb-query): /api/v1/metadata/lookup with schema+table per request`
2. `feat(control-plane,web-ui): unified /assets/:id/metadata + panel wiring`
3. `chore(deploy): document VAST_DATABASE_URL coordinator URL convention`

Order matters because the control-plane change depends on the vastdb-query change. Both services get redeployed via the existing rsync-then-restart flow (vastdb-query is in docker compose).

Feature is backward-compatible: `/storage/metadata` and `/{exr,video}-metadata/*` endpoints untouched. Rolling back the panel change reverts the feature without server-side impact.

## 9. Open questions / future work

- If row count for EXR sequences becomes large (thousands of frame-level rows), paginate the `dbRows` in the response. Not needed for V1 — current extractor writes one row per file.
- The "column family grouping" in the UI is heuristic. Could be made config-driven (same pipeline config could declare `displayGroups`), but that's out of scope for this spec.
- Panel currently polls when an asset is selected. Consider switching to an SSE stream when the extractor completes (`dataengine.pipeline.completed` event already fires) so the panel refreshes automatically. Follow-up, not blocking.

## 10. Risks

| Risk | Mitigation |
|---|---|
| `vastdb-query` service latency on each panel open | Hook caches by assetId, 60s TTL; vastdb-query already uses a long-lived SDK session |
| `targetSchema` / `targetTable` misconfigured → rows never found | New `/metadata/lookup` returns a clear error naming the tried schema/table; UI surfaces `dbError` so the misconfig is visible not silent |
| Config drift between `VASTDB_SCHEMA` env and pipeline config | The new endpoint doesn't read `VASTDB_SCHEMA` — drift stops mattering for this feature. Separate tech-debt to remove the env var from the old endpoints (tracked separately, out of scope here) |
| Sidecar file kind disagrees with pipeline file kind | Pipeline lookup wins; sidecar is best-effort addendum |
| Trino fix restarts control-plane mid-session — could drop an in-flight request | Done after spec approved, in a quiet window, with the session's usual rsync-then-up workflow |
