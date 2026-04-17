# Asset Metadata DB Reader (C-1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AssetDetailPanel metadata tab read extracted rows from VAST Database tables (via the existing `vastdb-query` SDK sidecar) using schema/table names taken from pipeline platform settings, with the existing S3 sidecar JSON as a fallback.

**Architecture:** Three layers. (1) Add a schema-agnostic `GET /api/v1/metadata/lookup?path=&schema=&table=` to the Python `vastdb-query` FastAPI sidecar. (2) Add a new unified `GET /api/v1/assets/:id/metadata` to the TypeScript control-plane that looks up the asset's pipeline config, calls the sidecar and the JSON sidecar fetcher in parallel, and merges. (3) Replace the metadata tab's `useStorageSidecar` with a new `useAssetMetadata` hook and render both sources with status badges. Plus a one-commit Trino connectivity fix (change a single env var on the remote; no repo code change).

**Tech Stack:** Python 3.12 + FastAPI + `vastdb` SDK + pytest (sidecar); TypeScript + Fastify + `node:test` + `tsx` (control-plane); React 18 + Vite + Vitest + React Testing Library (web-ui); Docker Compose on the 10.143.2.102 dev cluster.

**Spec:** `docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md` (commit `2fe5a7a`)

---

## File Structure

### New

| Path | Responsibility |
|---|---|
| `services/vastdb-query/tests/__init__.py` | empty — pytest collection root |
| `services/vastdb-query/tests/test_metadata_lookup.py` | pytest cases for the new endpoint + pure column resolver |
| `services/control-plane/src/routes/asset-metadata.ts` | `GET /api/v1/assets/:id/metadata` + pure `resolveSourcesStatus` helper |
| `services/control-plane/test/asset-metadata-route.test.ts` | contract + unit tests for the new route |
| `services/web-ui/src/hooks/useAssetMetadata.ts` | fetch + 60s-TTL cache for `/assets/:id/metadata` |

### Modified

| Path | Change |
|---|---|
| `services/vastdb-query/main.py` | add `/api/v1/metadata/lookup` handler + shared `resolve_match_column` helper |
| `services/control-plane/src/app.ts` | import + register `registerAssetMetadataRoute` |
| `services/web-ui/src/api.ts` | add `fetchAssetMetadata` + response types |
| `services/web-ui/src/components/AssetDetailPanel.tsx` | swap `useStorageSidecar` for `useAssetMetadata` in `MetadataTab`; add source-status badges and database-fields section |
| `services/web-ui/src/components/AssetDetailPanel.metadata-tab.test.tsx` | update mocks for the new hook shape; add tests for the new rendering cases |

### Env-only change (commit 3, no repo code)

| Target | Change |
|---|---|
| `~/SpaceHarbor/.env` on `10.143.2.102` | `VAST_DATABASE_URL=http://trino:8080` (was `http://172.200.201.67`) |

---

## Task 1 — vastdb-query: pure `resolve_match_column` helper

The endpoint needs to pick which column to match `path` against. Spec priority list: `source_uri`, `s3_key`, `path`, `file_path`, `uri`. Build this as a pure function first so the endpoint body stays small.

**Files:**
- Create: `services/vastdb-query/tests/__init__.py`
- Create: `services/vastdb-query/tests/test_metadata_lookup.py`
- Modify: `services/vastdb-query/main.py` (add helper only)

- [ ] **Step 1: Write the failing unit tests for the resolver**

Create `services/vastdb-query/tests/__init__.py` with one blank line, then:

Create `services/vastdb-query/tests/test_metadata_lookup.py`:

```python
"""Tests for /api/v1/metadata/lookup — schema-agnostic per-asset VAST DB reader."""
import pytest

from main import resolve_match_column, MATCH_COLUMN_PRIORITY


class TestResolveMatchColumn:
    def test_picks_first_priority_when_present(self):
        cols = ["width", "source_uri", "height", "file_path"]
        assert resolve_match_column(cols) == "source_uri"

    def test_falls_through_priority_when_earlier_missing(self):
        cols = ["width", "file_path", "height"]
        assert resolve_match_column(cols) == "file_path"

    def test_matches_case_insensitively(self):
        cols = ["Width", "SOURCE_URI", "Height"]
        assert resolve_match_column(cols) == "SOURCE_URI"

    def test_returns_none_when_no_priority_column_present(self):
        cols = ["width", "height", "duration"]
        assert resolve_match_column(cols) is None

    def test_returns_none_on_empty_list(self):
        assert resolve_match_column([]) is None

    def test_priority_list_is_stable(self):
        # Contract: `source_uri` first, then `s3_key`, `path`, `file_path`, `uri`.
        assert MATCH_COLUMN_PRIORITY == ("source_uri", "s3_key", "path", "file_path", "uri")
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `services/vastdb-query/`:
```bash
python -m pytest tests/test_metadata_lookup.py -v
```
Expected: `ImportError` / `AttributeError` — `resolve_match_column` and `MATCH_COLUMN_PRIORITY` don't exist yet.

- [ ] **Step 3: Add the helper to `main.py`**

At the top of `services/vastdb-query/main.py` after the existing `DEFAULT_VIDEO_TABLE = ...` constant near line 57, add:

```python
# ---------------------------------------------------------------------------
# Schema-agnostic metadata lookup — Phase 5.4 (asset metadata DB reader)
# ---------------------------------------------------------------------------

# Priority order for the column the caller's `path` is matched against.
# First column present in the target table (case-insensitive) wins.
MATCH_COLUMN_PRIORITY: tuple[str, ...] = (
    "source_uri",
    "s3_key",
    "path",
    "file_path",
    "uri",
)


def resolve_match_column(column_names: list[str]) -> Optional[str]:
    """Return the first column from MATCH_COLUMN_PRIORITY that is present in
    ``column_names`` (case-insensitive), preserving the column's original
    casing. Returns None when none match — the caller should surface that
    as a 400 with the list of available columns so misconfiguration is
    visible, not silent."""
    lower_map = {c.lower(): c for c in column_names}
    for wanted in MATCH_COLUMN_PRIORITY:
        if wanted in lower_map:
            return lower_map[wanted]
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
python -m pytest tests/test_metadata_lookup.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit the helper + tests**

```bash
git add services/vastdb-query/tests/__init__.py \
        services/vastdb-query/tests/test_metadata_lookup.py \
        services/vastdb-query/main.py
git commit -m "feat(vastdb-query): add resolve_match_column helper for schema-agnostic lookup

Priority list: source_uri, s3_key, path, file_path, uri. Case-insensitive
column-name match, preserves original casing in the return. 6 unit tests
covering the priority order, fall-through, case handling, and misses."
```

---

## Task 2 — vastdb-query: `/api/v1/metadata/lookup` endpoint

Now add the FastAPI endpoint that uses the helper. Takes `path`, `schema`, `table` per request so the caller (control-plane) can pass pipeline-config values instead of relying on env drift. Strips `s3://<bucket>/` prefix from `path` if present so callers can pass either style.

**Files:**
- Modify: `services/vastdb-query/main.py`
- Modify: `services/vastdb-query/tests/test_metadata_lookup.py`

- [ ] **Step 1: Write the failing tests for the endpoint**

Append to `services/vastdb-query/tests/test_metadata_lookup.py`:

```python
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

# main imports vastdb at module load; the endpoint uses it inside a
# context manager we mock here. We don't touch real network.
import main as app_module
from main import app

client = TestClient(app)


def _stub_session(rows: list[dict], columns: list[str]):
    """Return a MagicMock that mimics the minimal vastdb session surface
    the endpoint uses: bucket(...).schema(...).table(...).select(...)."""
    table = MagicMock()
    table.columns = [MagicMock(name=c) for c in columns]
    for col, mock in zip(columns, table.columns):
        mock.name = col
    table.select.return_value.read_all.return_value.to_pylist.return_value = rows
    schema_obj = MagicMock()
    schema_obj.table.return_value = table
    bucket_obj = MagicMock()
    bucket_obj.schema.return_value = schema_obj
    tx = MagicMock()
    tx.bucket.return_value = bucket_obj
    return tx, table


class TestMetadataLookupEndpoint:
    def test_returns_matched_rows(self, monkeypatch):
        tx, table = _stub_session(
            rows=[{"source_uri": "uploads/pixar_5603.exr", "width": 2048, "height": 858}],
            columns=["source_uri", "width", "height"],
        )
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        assert body["schema"] == "frame_metadata"
        assert body["table"] == "files"
        assert body["matched_by"] == "source_uri"
        assert body["rows"][0]["width"] == 2048

    def test_strips_s3_scheme_and_bucket_prefix(self, monkeypatch):
        tx, table = _stub_session(rows=[], columns=["source_uri"])
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        client.get(
            "/api/v1/metadata/lookup",
            params={"path": "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        # Assert the select predicate received just the key, not the full URI.
        call = table.select.call_args
        # The predicate is the first positional arg; its string form includes
        # the key but not the s3:// prefix.
        assert "uploads/pixar_5603.exr" in str(call)
        assert "s3://" not in str(call)

    def test_400_when_no_priority_column_in_target_table(self, monkeypatch):
        tx, table = _stub_session(rows=[], columns=["width", "height"])
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "k", "schema": "x", "table": "y"},
        )
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert "width" in detail and "height" in detail
        assert "source_uri" in detail  # expected priority column named

    def test_503_when_sdk_raises(self, monkeypatch):
        class Boom(Exception):
            pass

        def _raise(*_a, **_kw):
            raise Boom("bucket not found")

        monkeypatch.setattr(app_module, "vast_transaction", _raise)
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "k", "schema": "x", "table": "y"},
        )
        assert r.status_code == 503
        assert "bucket not found" in r.json()["detail"]

    def test_required_params(self):
        r = client.get("/api/v1/metadata/lookup", params={"schema": "x", "table": "y"})
        assert r.status_code == 422  # fastapi validation — missing path
        r = client.get("/api/v1/metadata/lookup", params={"path": "k", "table": "y"})
        assert r.status_code == 422  # missing schema


# Helper context-manager wrapper for the mocked vast_transaction.
from contextlib import contextmanager


@contextmanager
def _ctx(tx):
    yield tx
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_metadata_lookup.py -v
```
Expected: 5 new tests FAIL with `404 /api/v1/metadata/lookup` or similar (endpoint doesn't exist).

- [ ] **Step 3: Implement the endpoint in `main.py`**

Append immediately after the existing `video_lookup` function (around line 490 in `main.py`):

```python
# ---------------------------------------------------------------------------
# Schema-agnostic per-asset metadata lookup (Phase 5.4)
# ---------------------------------------------------------------------------
# Takes schema + table + path per request — no env-bound schema coupling,
# so pipeline platform settings become the single source of truth.

import ibis  # type: ignore  # already installed as vastdb SDK dep


def _strip_s3_prefix(path: str) -> str:
    """Accept either `s3://<bucket>/<key>` or a bare `<key>`; return `<key>`.
    Extractors typically store just the key, so callers can pass the full
    source URI without thinking about it."""
    if path.startswith("s3://"):
        without_scheme = path[len("s3://"):]
        first_slash = without_scheme.find("/")
        return without_scheme[first_slash + 1:] if first_slash > 0 else without_scheme
    return path


@app.get("/api/v1/metadata/lookup")
def metadata_lookup(
    path: str = Query(..., description="S3 key or full s3:// URI"),
    schema: str = Query(..., description="Target VAST schema name (from pipeline config)"),
    table: str = Query("files", description="Target table name (default: files)"),
    bucket: Optional[str] = Query(None, description="VAST DB bucket (defaults to VASTDB_BUCKET env)"),
):
    """Schema-agnostic lookup of extractor output rows keyed by file path.

    Unlike /exr-metadata/lookup and /video-metadata/lookup (both hardcoded
    to env-bound schemas), this endpoint takes schema + table per request.
    Intended caller: control-plane /assets/:id/metadata, which passes the
    asset's pipeline config's targetSchema/targetTable.
    """
    key = _strip_s3_prefix(path)
    target_bucket = bucket or DEFAULT_BUCKET
    try:
        with vast_transaction(bucket=target_bucket) as tx:
            table_obj = tx.bucket(target_bucket).schema(schema).table(table)
            column_names = [c.name for c in table_obj.columns]
            match_col = resolve_match_column(column_names)
            if match_col is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Target table {schema}.{table} has no recognized "
                        f"path-match column. Expected one of "
                        f"{list(MATCH_COLUMN_PRIORITY)}; got {column_names}."
                    ),
                )
            predicate = ibis._[match_col] == key
            rows = table_obj.select(predicate).read_all().to_pylist()
            return {
                "rows": rows,
                "bucket": target_bucket,
                "schema": schema,
                "table": table,
                "matched_by": match_col,
                "count": len(rows),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_metadata_lookup.py -v
```
Expected: all 11 tests PASS (6 from Task 1 + 5 new).

- [ ] **Step 5: Smoke-probe the endpoint locally**

Start a scratch uvicorn bound to localhost to check the shape (skip if the test suite is enough):

```bash
cd services/vastdb-query
python -c "from main import app; import json; print('routes:', [r.path for r in app.routes if '/metadata/lookup' in getattr(r, 'path', '')])"
```
Expected output includes `/api/v1/metadata/lookup`.

- [ ] **Step 6: Commit the endpoint**

```bash
git add services/vastdb-query/main.py services/vastdb-query/tests/test_metadata_lookup.py
git commit -m "feat(vastdb-query): GET /api/v1/metadata/lookup — schema+table per request

New endpoint supersedes the env-bound /exr-metadata/lookup and
/video-metadata/lookup for callers that know their schema/table at
request time. Control-plane uses this to pass pipeline-config
targetSchema / targetTable, removing VASTDB_SCHEMA env drift as a class
of bug. Accepts s3:// URIs or bare S3 keys. 5 endpoint tests (happy
path, prefix stripping, missing-match-column 400, SDK-raises 503,
required params). Old endpoints untouched."
```

---

## Task 3 — control-plane: pure `resolveSourcesStatus` helper

Merging the DB and sidecar `Promise.allSettled` outcomes into the `sources` object in the response is pure logic — isolate it and unit-test it separately from the route.

**Files:**
- Create: `services/control-plane/src/routes/asset-metadata.ts` (helper + types only at this step)
- Create: `services/control-plane/test/asset-metadata-route.test.ts` (unit tests for the helper)

- [ ] **Step 1: Write the failing helper tests**

Create `services/control-plane/test/asset-metadata-route.test.ts`:

```typescript
/**
 * Tests for /api/v1/assets/:id/metadata — unified DB + sidecar reader.
 * Unit tests for the pure sources-status resolver; contract tests for the
 * route handler land in later tasks.
 */

// Startup gates need these before any app.ts import. Tests also close() the
// app in finally so background workers don't keep the process alive.
process.env.NODE_ENV ??= "development";
process.env.SPACEHARBOR_JWT_SECRET ??= "test-jwt-secret-for-asset-metadata-route-tests-32+";
process.env.SPACEHARBOR_IAM_ENABLED ??= "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE ??= "true";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveSourcesStatus,
  type DbResult,
  type SidecarResult,
} from "../src/routes/asset-metadata.js";

describe("resolveSourcesStatus", () => {
  it("both ok when db returns rows and sidecar exists", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [{ width: 2048 }] },
      { kind: "sidecar", data: { schema_version: "1.0.0" } as unknown as SidecarResult["data"] }
    );
    assert.deepEqual(r, { db: "ok", sidecar: "ok", dbError: undefined });
  });

  it("db=empty when db returns zero rows", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [] },
      { kind: "missing" }
    );
    assert.equal(r.db, "empty");
    assert.equal(r.sidecar, "missing");
  });

  it("db=unreachable + dbError when db call failed", () => {
    const r = resolveSourcesStatus(
      { kind: "error", message: "circuit 'vast-trino' is OPEN" },
      { kind: "sidecar", data: {} as SidecarResult["data"] }
    );
    assert.equal(r.db, "unreachable");
    assert.equal(r.sidecar, "ok");
    assert.equal(r.dbError, "circuit 'vast-trino' is OPEN");
  });

  it("db=disabled when pipeline is missing", () => {
    const r = resolveSourcesStatus(
      { kind: "disabled", reason: "no pipeline for file kind 'other'" },
      { kind: "missing" }
    );
    assert.equal(r.db, "disabled");
    assert.equal(r.sidecar, "missing");
    assert.equal(r.dbError, undefined);
  });

  it("sidecar=missing when sidecar fetch 404s, db continues independently", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [{ any: 1 }] },
      { kind: "missing" }
    );
    assert.equal(r.db, "ok");
    assert.equal(r.sidecar, "missing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/control-plane
npx tsx --test test/asset-metadata-route.test.ts
```
Expected: import errors — `asset-metadata.ts` doesn't exist yet.

- [ ] **Step 3: Create `asset-metadata.ts` with types + helper (no route yet)**

Create `services/control-plane/src/routes/asset-metadata.ts`:

```typescript
/**
 * GET /api/v1/assets/:id/metadata — unified DB + sidecar reader.
 *
 * Queries the VAST DB table declared by the asset's pipeline config (via
 * vastdb-query sidecar) and the S3 `_metadata.json` sidecar in parallel,
 * returns a merged payload with per-source status. Schema/table come
 * from `dataEnginePipelines` platform setting — NO env-bound schema
 * coupling.
 *
 * Spec: docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md
 */

import type { FastifyInstance } from "fastify";

// ─────────────────────────────────────────────────────────────────────────
// Pure helper types — exported for unit testing.
// ─────────────────────────────────────────────────────────────────────────

export type DbSourceStatus = "ok" | "empty" | "unreachable" | "disabled";
export type SidecarSourceStatus = "ok" | "missing";

export interface DbResult_Rows { kind: "rows"; rows: Record<string, unknown>[] }
export interface DbResult_Error { kind: "error"; message: string }
export interface DbResult_Disabled { kind: "disabled"; reason: string }
export type DbResult = DbResult_Rows | DbResult_Error | DbResult_Disabled;

export interface SidecarResult_Hit { kind: "sidecar"; data: Record<string, unknown> }
export interface SidecarResult_Miss { kind: "missing" }
export type SidecarResult = SidecarResult_Hit | SidecarResult_Miss;

export interface SourcesStatus {
  db: DbSourceStatus;
  sidecar: SidecarSourceStatus;
  dbError?: string;
}

export function resolveSourcesStatus(
  db: DbResult,
  sidecar: SidecarResult,
): SourcesStatus {
  let dbStatus: DbSourceStatus;
  let dbError: string | undefined;
  switch (db.kind) {
    case "rows":     dbStatus = db.rows.length > 0 ? "ok" : "empty"; break;
    case "error":    dbStatus = "unreachable"; dbError = db.message; break;
    case "disabled": dbStatus = "disabled";    break;
  }
  const sidecarStatus: SidecarSourceStatus = sidecar.kind === "sidecar" ? "ok" : "missing";
  return { db: dbStatus, sidecar: sidecarStatus, dbError };
}

// The route handler is added in Task 4 — intentionally skeletal here so
// Task 3's tests can import the helper without touching Fastify.
export async function registerAssetMetadataRoute(
  _app: FastifyInstance,
  // Additional params added in Task 4.
): Promise<void> {
  // Registered in Task 4.
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test test/asset-metadata-route.test.ts
```
Expected: 5 helper tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "asset-metadata" | head -10
```
Expected: no errors in `asset-metadata.ts` or the test file.

- [ ] **Step 6: Commit the helper**

```bash
git add services/control-plane/src/routes/asset-metadata.ts \
        services/control-plane/test/asset-metadata-route.test.ts
git commit -m "feat(control-plane): resolveSourcesStatus pure helper

Merges parallel DB + sidecar fetch outcomes into a single sources object
for the upcoming /assets/:id/metadata route. 5 unit tests covering all
combinations of db=ok|empty|unreachable|disabled and sidecar=ok|missing.
Route handler lands in the next commit."
```

---

## Task 4 — control-plane: `GET /api/v1/assets/:id/metadata` route

The actual Fastify handler. Parallel DB + sidecar fetch with injected dependencies so tests can stub both. Registered in `app.ts`.

**Files:**
- Modify: `services/control-plane/src/routes/asset-metadata.ts` (add route handler)
- Modify: `services/control-plane/src/routes/exr-metadata.ts` (re-export `proxyToVastdbQuery` is already exported — no change needed; confirm only)
- Modify: `services/control-plane/src/routes/storage-metadata.ts` (export the sidecar fetch as a reusable function if not already — read to confirm)
- Modify: `services/control-plane/src/app.ts` (import + register)
- Modify: `services/control-plane/test/asset-metadata-route.test.ts` (add contract tests)

- [ ] **Step 1: Confirm reusable dependencies exist**

Run from `services/control-plane`:
```bash
grep -n "export.*proxyToVastdbQuery\|export.*resolveSidecarLocation\|export.*fetchSidecar" \
  src/routes/exr-metadata.ts src/routes/storage-metadata.ts src/storage/sidecar-resolver.ts
```
Expected: `proxyToVastdbQuery` is exported from `exr-metadata.ts`. Note whether a sidecar-fetching function is exported from `storage-metadata.ts`. If yes, note its name; if no, use step 2 below.

- [ ] **Step 2: If the sidecar fetch is not already exported, extract it**

Read `services/control-plane/src/routes/storage-metadata.ts` to find the handler body. Extract the "derive path → GET from S3 → build response body" logic into an exported function `fetchSidecar(sourceUri: string): Promise<SidecarFetchResult>` with this signature:

```typescript
export type SidecarFetchResult =
  | { ok: true; data: { schema_version: string; file_kind: string; source_uri: string;
                        sidecar_key: string; bucket: string; bytes: number; data: unknown } }
  | { ok: false; code: "SIDECAR_NOT_FOUND" | "SIDECAR_READ_ERROR"; message: string };

export async function fetchSidecar(sourceUri: string): Promise<SidecarFetchResult> { /* existing logic */ }
```

The existing handler then calls `fetchSidecar` and maps the result to the HTTP response. No behavior change for existing callers.

*If already exported under a different name, use that name and skip this step.*

- [ ] **Step 3: Write failing contract tests**

Append to `services/control-plane/test/asset-metadata-route.test.ts`:

```typescript
import { test } from "node:test";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

async function withApp<T>(body: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const app = buildApp();
  try { return await body(app); } finally { await app.close(); }
}

async function seedProjectAndAsset(app: FastifyInstance): Promise<{ assetId: string }> {
  const proj = await app.inject({
    method: "POST", url: "/api/v1/hierarchy/projects",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ code: "PROJ_NOVA", name: "Project Nova", type: "feature", status: "active" }),
  });
  assert.equal(proj.statusCode, 201, proj.body);

  const asset = await app.inject({
    method: "POST", url: "/api/v1/assets/ingest",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      title: "pixar_5603.exr",
      sourceUri: "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
    }),
  });
  assert.equal(asset.statusCode, 201, asset.body);
  return { assetId: JSON.parse(asset.body).asset.id };
}

test("GET /api/v1/assets/:id/metadata — 404 when asset missing", async () => {
  await withApp(async (app) => {
    const r = await app.inject({ method: "GET", url: "/api/v1/assets/bogus/metadata" });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, "ASSET_NOT_FOUND");
  });
});

test("GET /api/v1/assets/:id/metadata — happy path returns db rows + pipeline", async () => {
  await withApp(async (app) => {
    const { assetId } = await seedProjectAndAsset(app);

    // Inject a stub queryFetcher that returns canned rows.
    (app as unknown as {
      __assetMetadataDeps: { queryFetcher: (path: string) => Promise<unknown>;
                             sidecarFetcher: (uri: string) => Promise<unknown> };
    }).__assetMetadataDeps = {
      queryFetcher: async () => ({ ok: true, status: 200, data: {
        rows: [{ source_uri: "uploads/pixar_5603.exr", width: 2048, height: 858 }],
        bucket: "sergio-db", schema: "frame_metadata", table: "files",
        matched_by: "source_uri", count: 1,
      } }),
      sidecarFetcher: async () => ({ ok: false, code: "SIDECAR_NOT_FOUND", message: "no sidecar" }),
    };

    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.sources.db, "ok");
    assert.equal(body.sources.sidecar, "missing");
    assert.equal(body.pipeline?.targetSchema, "frame_metadata");
    assert.equal(body.dbRows.length, 1);
    assert.equal(body.sidecar, null);
  });
});

test("GET /api/v1/assets/:id/metadata — db unreachable falls through to sidecar", async () => {
  await withApp(async (app) => {
    const { assetId } = await seedProjectAndAsset(app);
    (app as unknown as { __assetMetadataDeps: unknown }).__assetMetadataDeps = {
      queryFetcher: async () => ({ ok: false, status: 503, data: { detail: "circuit open" } }),
      sidecarFetcher: async () => ({ ok: true, data: {
        schema_version: "1.0.0", file_kind: "image",
        source_uri: "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
        sidecar_key: "uploads/.proxies/pixar_5603_metadata.json",
        bucket: "sergio-spaceharbor", bytes: 123, data: { width: 2048 },
      } }),
    };
    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.sources.db, "unreachable");
    assert.equal(body.sources.sidecar, "ok");
    assert.match(body.dbError, /circuit open/);
    assert.equal(body.dbRows.length, 0);
    assert.ok(body.sidecar);
  });
});

test("GET /api/v1/assets/:id/metadata — non-s3 sourceUri → db=disabled", async () => {
  await withApp(async (app) => {
    const proj = await app.inject({
      method: "POST", url: "/api/v1/hierarchy/projects",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ code: "PROJ_LOCAL", name: "Local", type: "feature", status: "active" }),
    });
    assert.equal(proj.statusCode, 201);
    const asset = await app.inject({
      method: "POST", url: "/api/v1/assets/ingest",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "local.exr", sourceUri: "file:///tmp/local.exr" }),
    });
    const assetId = JSON.parse(asset.body).asset.id;

    (app as unknown as { __assetMetadataDeps: unknown }).__assetMetadataDeps = {
      // queryFetcher should NOT be called when sourceUri is non-s3; assert by failing.
      queryFetcher: async () => { throw new Error("queryFetcher should not be called"); },
      sidecarFetcher: async () => ({ ok: false, code: "SIDECAR_NOT_FOUND", message: "no sidecar" }),
    };
    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().sources.db, "disabled");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx tsx --test test/asset-metadata-route.test.ts 2>&1 | tail -20
```
Expected: 4 new contract tests FAIL with 404 (route not registered).

- [ ] **Step 5: Replace the stub `registerAssetMetadataRoute` with the real handler**

Replace the skeletal function at the bottom of `services/control-plane/src/routes/asset-metadata.ts` with:

```typescript
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { inferFileKind } from "../storage/file-kinds.js";
import { proxyToVastdbQuery } from "./exr-metadata.js";
import { fetchSidecar, type SidecarFetchResult } from "./storage-metadata.js";
import { getDataEnginePipelines } from "./platform-settings.js";

// Dependency injection points — tests can stub via `app.__assetMetadataDeps`.
export interface AssetMetadataDeps {
  queryFetcher: (pathArgs: { path: string; schema: string; table: string })
    => Promise<{ ok: boolean; status: number; data: unknown }>;
  sidecarFetcher: (sourceUri: string) => Promise<SidecarFetchResult>;
}

const DEFAULT_DEPS: AssetMetadataDeps = {
  queryFetcher: async ({ path, schema, table }) => {
    const q = new URLSearchParams({ path, schema, table }).toString();
    return proxyToVastdbQuery(`/api/v1/metadata/lookup?${q}`);
  },
  sidecarFetcher: fetchSidecar,
};

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith("s3://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash < 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

export async function registerAssetMetadataRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opId = prefix === "/api/v1" ? "v1AssetMetadata" : "legacyAssetMetadata";
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/metadata"),
      {
        schema: {
          tags: ["assets"],
          operationId: opId,
          summary: "Unified DB + sidecar metadata reader for an asset",
          response: {
            200: { type: "object", additionalProperties: true },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const deps: AssetMetadataDeps =
          (app as unknown as { __assetMetadataDeps?: AssetMetadataDeps }).__assetMetadataDeps
          ?? DEFAULT_DEPS;

        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "ASSET_NOT_FOUND",
            `Asset not found: ${request.params.id}`);
        }
        const sourceUri = asset.sourceUri ?? "";
        const fileKind = inferFileKind(sourceUri);
        const s3 = parseS3Uri(sourceUri);

        const pipelines = await getDataEnginePipelines();
        const pipeline = pipelines.find(
          (p) => p.fileKind === fileKind && p.enabled !== false
        ) ?? null;

        // DB branch — disabled if no pipeline or non-s3 URI; otherwise call deps.queryFetcher.
        let dbResult: DbResult;
        if (!pipeline || !s3) {
          dbResult = { kind: "disabled", reason: !pipeline ? "no pipeline for file kind" : "non-s3 sourceUri" };
        } else {
          try {
            const q = await deps.queryFetcher({
              path: s3.key,
              schema: pipeline.targetSchema,
              table: pipeline.targetTable,
            });
            if (q.ok) {
              const rows = (q.data as { rows?: Record<string, unknown>[] }).rows ?? [];
              dbResult = { kind: "rows", rows };
            } else {
              const msg = (q.data as { detail?: string })?.detail ?? `HTTP ${q.status}`;
              dbResult = { kind: "error", message: msg };
            }
          } catch (e) {
            dbResult = { kind: "error", message: e instanceof Error ? e.message : String(e) };
          }
        }

        // Sidecar branch.
        const sc = await deps.sidecarFetcher(sourceUri);
        const sidecarResult: SidecarResult = sc.ok
          ? { kind: "sidecar", data: sc.data as unknown as Record<string, unknown> }
          : { kind: "missing" };

        const sources = resolveSourcesStatus(dbResult, sidecarResult);

        return reply.send({
          assetId: asset.id,
          sourceUri,
          fileKind,
          pipeline: pipeline ? {
            functionName: pipeline.functionName,
            targetSchema: pipeline.targetSchema,
            targetTable: pipeline.targetTable,
            sidecarSchemaId: pipeline.sidecarSchemaId ?? null,
          } : null,
          sources,
          dbRows: dbResult.kind === "rows" ? dbResult.rows : [],
          sidecar: sc.ok ? sc.data : null,
          ...(sources.dbError ? { dbError: sources.dbError } : {}),
        });
      },
    );
  }
}
```

- [ ] **Step 6: Register the route in `app.ts`**

In `services/control-plane/src/app.ts`, find the block around line 58 where other routes are imported:

```typescript
import { registerExrMetadataRoutes } from "./routes/exr-metadata.js";
```

Add below it:
```typescript
import { registerAssetMetadataRoute } from "./routes/asset-metadata.js";
```

Then find where `registerExrMetadataRoutes` is called (around line 419 — look for `void registerExrMetadataRoutes`) and add below it:
```typescript
    void registerAssetMetadataRoute(app, persistence, prefixes);
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx tsx --test test/asset-metadata-route.test.ts
```
Expected: all 9 tests PASS (5 helper + 4 contract).

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v -E "^(src/app\.ts|src/routes/iam\.ts)" | head -20
```
Expected: no output (preexisting errors in app.ts/iam.ts are fine).

- [ ] **Step 9: Commit**

```bash
git add services/control-plane/src/routes/asset-metadata.ts \
        services/control-plane/src/routes/storage-metadata.ts \
        services/control-plane/src/app.ts \
        services/control-plane/test/asset-metadata-route.test.ts
git commit -m "feat(control-plane): GET /api/v1/assets/:id/metadata

Unified DB + sidecar reader. Looks up the asset's pipeline config
(dataEnginePipelines platform setting) to pick the target schema/table,
fires the vastdb-query /metadata/lookup and the existing S3 sidecar read
in parallel, merges into a response with per-source status. Dependency-
injectable via app.__assetMetadataDeps so contract tests stub both
branches. 4 contract tests covering: 404 on missing asset, happy-path
db+sidecar merge, db-unreachable → sidecar fallback, non-s3 sourceUri
→ db disabled."
```

---

## Task 5 — web-ui: `useAssetMetadata` hook + api client

Replace `useStorageSidecar` in `MetadataTab` with a new hook that hits the unified endpoint. 60s TTL cache keyed by assetId — mirrors the existing sidecar hook's pattern so behavior is consistent.

**Files:**
- Create: `services/web-ui/src/hooks/useAssetMetadata.ts`
- Modify: `services/web-ui/src/api.ts` (add `fetchAssetMetadata` + types)
- Create: `services/web-ui/src/hooks/useAssetMetadata.test.ts`

- [ ] **Step 1: Write the failing hook test**

Create `services/web-ui/src/hooks/useAssetMetadata.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import * as api from "../api";
import { useAssetMetadata, __resetAssetMetadataCacheForTests } from "./useAssetMetadata";

const sampleResponse: api.AssetMetadataResponse = {
  assetId: "asset-1",
  sourceUri: "s3://sergio-spaceharbor/uploads/x.exr",
  fileKind: "image",
  pipeline: {
    functionName: "frame-metadata-extractor",
    targetSchema: "frame_metadata",
    targetTable: "files",
    sidecarSchemaId: "frame@1",
  },
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [{ width: 2048 }],
  sidecar: null,
};

describe("useAssetMetadata", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
    vi.restoreAllMocks();
  });

  it("starts in loading, transitions to ready with data", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue(sampleResponse);
    const { result } = renderHook(() => useAssetMetadata("asset-1"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.sources.db).toBe("ok");
  });

  it("reuses cache for the same assetId within TTL", async () => {
    const spy = vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue(sampleResponse);
    const { result: r1 } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(r1.current.status).toBe("ready"));
    const { result: r2 } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(r2.current.status).toBe("ready"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces error status when fetch throws", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/boom/);
  });

  it("returns idle for null assetId", () => {
    const { result } = renderHook(() => useAssetMetadata(null));
    expect(result.current.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/web-ui
npx vitest run src/hooks/useAssetMetadata.test.ts 2>&1 | tail -15
```
Expected: imports fail — neither `fetchAssetMetadata` nor the hook exist yet.

- [ ] **Step 3: Add API client types + `fetchAssetMetadata`**

Near the bottom of `services/web-ui/src/api.ts` (before the final line), add:

```typescript
/* ── Asset metadata (Phase 5.4 — unified DB + sidecar reader) ── */

export interface AssetMetadataPipeline {
  functionName: string;
  targetSchema: string;
  targetTable: string;
  sidecarSchemaId: string | null;
}

export interface AssetMetadataSources {
  db: "ok" | "empty" | "unreachable" | "disabled";
  sidecar: "ok" | "missing";
}

export interface AssetMetadataResponse {
  assetId: string;
  sourceUri: string;
  fileKind: string;
  pipeline: AssetMetadataPipeline | null;
  sources: AssetMetadataSources;
  dbRows: Record<string, unknown>[];
  sidecar: Record<string, unknown> | null;
  dbError?: string;
}

export async function fetchAssetMetadata(assetId: string): Promise<AssetMetadataResponse> {
  return apiFetch<AssetMetadataResponse>(`/assets/${encodeURIComponent(assetId)}/metadata`);
}
```

- [ ] **Step 4: Implement the hook**

Create `services/web-ui/src/hooks/useAssetMetadata.ts`:

```typescript
/**
 * 60s-TTL cache around GET /assets/:id/metadata.
 * Mirrors the shape of useStorageSidecar but targets the unified endpoint.
 * Spec: docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md
 */
import { useEffect, useState } from "react";

import { fetchAssetMetadata, type AssetMetadataResponse } from "../api";

const TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  data?: AssetMetadataResponse;
  error?: string;
  promise?: Promise<void>;
}

const cache = new Map<string, CacheEntry>();

export function __resetAssetMetadataCacheForTests(): void {
  cache.clear();
}

export type AssetMetadataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AssetMetadataResponse }
  | { status: "error"; error: string };

export function useAssetMetadata(assetId: string | null): AssetMetadataState & { data?: AssetMetadataResponse; error?: string } {
  const [state, setState] = useState<AssetMetadataState>(() =>
    assetId ? { status: "loading" } : { status: "idle" }
  );

  useEffect(() => {
    if (!assetId) { setState({ status: "idle" }); return; }

    const now = Date.now();
    const cached = cache.get(assetId);
    if (cached && now - cached.at < TTL_MS) {
      if (cached.data) { setState({ status: "ready", data: cached.data }); return; }
      if (cached.error) { setState({ status: "error", error: cached.error }); return; }
    }

    setState({ status: "loading" });
    let cancelled = false;

    const promise = fetchAssetMetadata(assetId)
      .then((data) => {
        cache.set(assetId, { at: Date.now(), data });
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        cache.set(assetId, { at: Date.now(), error: msg });
        if (!cancelled) setState({ status: "error", error: msg });
      });
    cache.set(assetId, { at: now, promise });

    return () => { cancelled = true; };
  }, [assetId]);

  // Flatten so callers can destructure `data`/`error` without switching on status.
  if (state.status === "ready") return { ...state, data: state.data };
  if (state.status === "error") return { ...state, error: state.error };
  return state;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/hooks/useAssetMetadata.test.ts
```
Expected: all 4 tests PASS.

- [ ] **Step 6: Typecheck the web-ui change**

```bash
npx tsc --noEmit 2>&1 | grep -E "useAssetMetadata|api\.ts" | head -10
```
Expected: no errors for the new hook/api additions.

- [ ] **Step 7: Commit**

```bash
git add services/web-ui/src/hooks/useAssetMetadata.ts \
        services/web-ui/src/hooks/useAssetMetadata.test.ts \
        services/web-ui/src/api.ts
git commit -m "feat(web-ui): useAssetMetadata hook + fetchAssetMetadata client

60s-TTL cache keyed by assetId, mirrors useStorageSidecar shape. 4 unit
tests covering loading → ready transition, cache reuse, error surfacing,
idle on null assetId. Consumer wiring in the AssetDetailPanel MetadataTab
lands in the next commit."
```

---

## Task 6 — web-ui: wire `MetadataTab` + update existing test

Swap the hook in `MetadataTab`, render source-status badges and the new db-fields section, keep the existing sidecar section, keep the empty-state behavior (name the pipeline function). Update the existing `metadata-tab.test.tsx` to mock the new hook shape.

**Files:**
- Modify: `services/web-ui/src/components/AssetDetailPanel.tsx` (MetadataTab function)
- Modify: `services/web-ui/src/components/AssetDetailPanel.metadata-tab.test.tsx`

- [ ] **Step 1: Read the current MetadataTab**

Open `services/web-ui/src/components/AssetDetailPanel.tsx` and locate the `MetadataTab` function (approx. lines 358–428 per the recon in Phase 1). Note how it currently renders `sidecarData` and calls `useStorageSidecar`. The new version keeps all that and adds: (a) a source-status badge header, (b) a Database section that renders `dbRows`, (c) empty-state preserved.

- [ ] **Step 2: Define a pure column-grouping helper**

At module top of `AssetDetailPanel.tsx` (near the other helpers), add:

```typescript
type FieldFamily = "Dimensions" | "Codec & color" | "Timing" | "File" | "Other";

const FAMILY_PATTERNS: [FieldFamily, RegExp][] = [
  ["Dimensions",    /^(width|height|channels|bit_depth|pixel_aspect|display_window|data_window)$/i],
  ["Codec & color", /^(codec|pix_fmt|color_space|transfer|primaries|chroma|profile|level|bit_rate)$/i],
  ["Timing",        /^(duration|frame_count|frame_rate|fps|timecode|start_frame|end_frame)$/i],
  ["File",          /^(path|filename|size|sha256|md5|etag|mtime|created_at|modified_at|source_uri|s3_key|file_path|uri)$/i],
];

export function groupColumns(row: Record<string, unknown>): Record<FieldFamily, [string, unknown][]> {
  const groups: Record<FieldFamily, [string, unknown][]> = {
    "Dimensions": [], "Codec & color": [], "Timing": [], "File": [], "Other": [],
  };
  for (const [key, value] of Object.entries(row)) {
    const family = FAMILY_PATTERNS.find(([, re]) => re.test(key))?.[0] ?? "Other";
    groups[family].push([key, value]);
  }
  groups["Other"].sort(([a], [b]) => a.localeCompare(b));
  return groups;
}
```

- [ ] **Step 3: Replace `MetadataTab` with the new implementation**

Replace the existing `MetadataTab` function body with:

```typescript
function MetadataTab({ asset }: { asset: AssetRow }) {
  const metadata = useAssetMetadata(asset.id);
  const { pipelines } = useDataEnginePipelines();
  const matchedPipeline = findPipelineForFilename(pipelines, asset.title);

  if (metadata.status === "loading") {
    return <div className="p-3 text-sm text-[var(--color-ah-text-muted)]">Loading…</div>;
  }
  if (metadata.status === "error") {
    return (
      <div className="p-3 text-sm text-red-400">
        Failed to load metadata: {metadata.error ?? "unknown error"}
      </div>
    );
  }
  if (metadata.status !== "ready" || !metadata.data) {
    // idle (no asset id) — matches parent behavior; shouldn't normally appear here.
    return null;
  }
  const data = metadata.data;

  const badgeVariant = (s: string) =>
    s === "ok" ? "success" : s === "empty" ? "default" : s === "missing" ? "default"
      : s === "disabled" ? "default" : "warning";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={badgeVariant(data.sources.db)}>DB · {data.sources.db}</Badge>
        <Badge variant={badgeVariant(data.sources.sidecar)}>Sidecar · {data.sources.sidecar}</Badge>
        {data.pipeline && (
          <span className="text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">
            {data.pipeline.functionName}
          </span>
        )}
      </div>

      {data.dbError && (
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
          DB unreachable: {data.dbError}
        </div>
      )}

      {data.dbRows.length > 0 && (
        <section aria-label="Database fields">
          <h4 className="text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider mb-1">
            Database ({data.dbRows.length} row{data.dbRows.length === 1 ? "" : "s"})
          </h4>
          {data.dbRows.map((row, i) => (
            <DbRowCard key={i} row={row} index={i + 1} />
          ))}
        </section>
      )}

      {data.sidecar && (
        <section aria-label="Sidecar fields">
          <h4 className="text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider mb-1">Sidecar</h4>
          <pre className="p-2 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] font-[var(--font-ah-mono)] text-xs overflow-auto max-h-80">
            {JSON.stringify(data.sidecar, null, 2)}
          </pre>
        </section>
      )}

      {data.sources.db !== "ok" && !data.sidecar && (
        <p className="text-xs text-[var(--color-ah-text-muted)]">
          {matchedPipeline
            ? `No metadata yet — ${matchedPipeline.config.functionName} has not produced output for this asset.`
            : "No metadata pipeline is configured for this file kind."}
        </p>
      )}
    </div>
  );
}

function DbRowCard({ row, index }: { row: Record<string, unknown>; index: number }) {
  const groups = groupColumns(row);
  return (
    <div className="p-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] mb-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-ah-text-subtle)] mb-1">Row {index}</div>
      {(Object.entries(groups) as [FieldFamily, [string, unknown][]][]).map(([family, rows]) =>
        rows.length === 0 ? null : (
          <div key={family} className="mb-2 last:mb-0">
            <div className="text-[10px] text-[var(--color-ah-text-muted)] mb-1">{family}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {rows.map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{key}</dt>
                  <dd className="font-[var(--font-ah-mono)] break-all">{formatCell(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return "<unserializable>"; }
}
```

- [ ] **Step 4: Add the imports at the top of `AssetDetailPanel.tsx`**

In the import block at the top of the file, add if missing:

```typescript
import React from "react";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { Badge } from "../design-system";
```

Remove the `useStorageSidecar` import from the `MetadataTab` area if it's no longer used in this file (check with `grep useStorageSidecar services/web-ui/src/components/AssetDetailPanel.tsx` — if count is 0 after the edits, drop the import).

- [ ] **Step 5: Update the existing metadata-tab test**

Open `services/web-ui/src/components/AssetDetailPanel.metadata-tab.test.tsx`. Replace the sidecar-based stubs with hook-based stubs. Add these new test cases and revise old ones:

```typescript
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";
import { MetadataTab } from "./AssetDetailPanel";
import type { AssetRow } from "../types";

// Existing pipeline stubs (unchanged from before) — omitted here for brevity;
// keep the `frameDiscovered` / `videoDiscovered` definitions from the original file.

const imageAsset: AssetRow = {
  id: "asset-exr", jobId: null, title: "shot_010.0042.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/shot_010.0042.exr", status: "pending",
};

function stubPipelinesApi() {
  vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
    pipelines: [frameDiscovered, videoDiscovered],
  });
}

function stubAssetMetadataApi(resp: Partial<api.AssetMetadataResponse> = {}) {
  vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
    assetId: imageAsset.id,
    sourceUri: imageAsset.sourceUri,
    fileKind: "image",
    pipeline: { functionName: "frame-metadata-extractor",
                targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
    sources: { db: "empty", sidecar: "missing" },
    dbRows: [], sidecar: null,
    ...resp,
  });
}

describe("MetadataTab", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
    __resetPipelineCacheForTests();
    stubPipelinesApi();
  });
  afterEach(() => cleanup());

  it("renders source badges + db rows on happy path", async () => {
    stubAssetMetadataApi({
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ source_uri: "uploads/shot_010.0042.exr", width: 2048, height: 858, codec: "exr" }],
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/DB · ok/)).toBeInTheDocument());
    expect(screen.getByText(/Sidecar · missing/)).toBeInTheDocument();
    expect(screen.getByText(/width/)).toBeInTheDocument();
    expect(screen.getByText(/2048/)).toBeInTheDocument();
  });

  it("surfaces db unreachable message", async () => {
    stubAssetMetadataApi({
      sources: { db: "unreachable", sidecar: "missing" },
      dbError: "circuit 'vast-trino' is OPEN",
      dbRows: [],
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/DB · unreachable/)).toBeInTheDocument());
    expect(screen.getByText(/circuit 'vast-trino' is OPEN/)).toBeInTheDocument();
  });

  it("names the responsible pipeline function in the empty state when both sources are empty", async () => {
    stubAssetMetadataApi({ sources: { db: "empty", sidecar: "missing" }, dbRows: [], sidecar: null });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/frame-metadata-extractor/)).toBeInTheDocument());
  });

  it("shows sidecar JSON when only sidecar is present", async () => {
    stubAssetMetadataApi({
      sources: { db: "empty", sidecar: "ok" },
      dbRows: [],
      sidecar: { width: 2048, height: 858, codec: "exr" },
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/Sidecar · ok/)).toBeInTheDocument());
    expect(screen.getByText(/"width": 2048/)).toBeInTheDocument();
  });
});
```

(Keep the `frameDiscovered` / `videoDiscovered` definitions from the original test file — only the tests proper change.)

- [ ] **Step 6: Run all metadata-tab tests**

```bash
npx vitest run src/components/AssetDetailPanel.metadata-tab.test.tsx
```
Expected: 4 tests PASS.

- [ ] **Step 7: Run the full web-ui suite to confirm nothing else regressed**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: pass count unchanged or higher than before; no new failures.

- [ ] **Step 8: Vite production build**

```bash
npx vite build 2>&1 | tail -8
```
Expected: `✓ built in ...` with no errors.

- [ ] **Step 9: Commit**

```bash
git add services/web-ui/src/components/AssetDetailPanel.tsx \
        services/web-ui/src/components/AssetDetailPanel.metadata-tab.test.tsx
git commit -m "feat(web-ui): MetadataTab reads from /assets/:id/metadata

Swaps useStorageSidecar for useAssetMetadata. Renders source-status
badges (DB · {status}, Sidecar · {status}), a database-fields section
grouped into Dimensions / Codec & color / Timing / File / Other, and
keeps the sidecar JSON + empty-state pipeline-naming behavior. 4 render
tests cover happy path, db unreachable, empty-state naming, sidecar-only."
```

---

## Task 7 — Deploy + live smoke on `10.143.2.102`

Push the three services, restart the containers, run the full end-to-end flow against a real asset.

**Files:** (none — deploy steps only)

- [ ] **Step 1: Rsync the three changed services + env**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor

sshpass -p 'vastdata' rsync -az -e "ssh -o StrictHostKeyChecking=no" \
  --exclude __pycache__ --exclude .pytest_cache \
  services/vastdb-query/ vastdata@10.143.2.102:~/SpaceHarbor/services/vastdb-query/

sshpass -p 'vastdata' rsync -az -e "ssh -o StrictHostKeyChecking=no" \
  --exclude node_modules --exclude dist \
  services/control-plane/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/control-plane/src/

sshpass -p 'vastdata' rsync -az -e "ssh -o StrictHostKeyChecking=no" \
  --exclude node_modules --exclude dist \
  services/web-ui/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/web-ui/src/
```

- [ ] **Step 2: Rebuild + recreate the three containers**

```bash
sshpass -p 'vastdata' ssh -o StrictHostKeyChecking=no vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build vastdb-query web-ui 2>&1 | tail -5 && \
   docker compose up -d vastdb-query control-plane web-ui 2>&1 | tail -8"
```
Expected output includes `Container spaceharbor-vastdb-query ... Recreated` and healthy restarts.

- [ ] **Step 3: Verify health of the three containers**

```bash
curl -s -o /dev/null -w "control-plane /health: %{http_code}\n" http://10.143.2.102:8080/health
curl -s -o /dev/null -w "web-ui /: %{http_code}\n" http://10.143.2.102:4173/
curl -s -o /dev/null -w "vastdb-query /health: %{http_code}\n" http://10.143.2.102:8070/health
```
Expected: three 200s.

- [ ] **Step 4: Live probe — vastdb-query /metadata/lookup hits a real schema**

First set the pipeline config to use `frame_metadata` (the real schema with data — confirmed in Phase 1 agent probes):

```bash
TOKEN=$(curl -s -X POST http://10.143.2.102:8080/api/v1/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"admin@spaceharbor.dev","password":"Vastdata2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# Verify current pipeline config
curl -s http://10.143.2.102:8080/api/v1/dataengine/pipelines/active \
  -H "authorization: Bearer $TOKEN" | python3 -m json.tool | head -30
```

If `targetSchema` is already `frame_metadata`, proceed to Step 5. Otherwise update via `PUT /api/v1/platform/settings` (JSON body merges `dataEnginePipelines`). The live config as of writing already has `frame_metadata`.

```bash
# Direct probe of the new vastdb-query endpoint
curl -s "http://10.143.2.102:8070/api/v1/metadata/lookup?path=uploads/pixar_5603.exr&schema=frame_metadata&table=files" \
  | python3 -m json.tool
```
Expected: `{"rows": [...], "bucket": "sergio-db", "schema": "frame_metadata", "table": "files", "matched_by": "...", "count": N}`. If `count: 0`, that's still a success — row just isn't there. If 503 with a specific schema/table error, the pipeline config doesn't match reality; note the error and surface to the user before proceeding.

- [ ] **Step 5: Live probe — control-plane unified endpoint**

```bash
# Pick a real asset id
ASSET_ID=$(curl -s "http://10.143.2.102:8080/api/v1/assets?limit=1" \
  -H "authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['assets'][0]['id'])")
echo "Testing asset: $ASSET_ID"

curl -s "http://10.143.2.102:8080/api/v1/assets/$ASSET_ID/metadata" \
  -H "authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: `200` with a payload containing `sources.db`, `sources.sidecar`, `pipeline.targetSchema`, `dbRows`, `sidecar`.

- [ ] **Step 6: Verify the UI renders the new panel**

Open `http://10.143.2.102:4173/library/assets` in a browser, open a pixar EXR asset, confirm the Metadata tab shows:
- Two source badges at the top (DB · <status>, Sidecar · <status>)
- A database-fields section (grouped Dimensions / Codec / …) if `dbRows.length > 0`, otherwise an empty state naming `frame-metadata-extractor`

- [ ] **Step 7: Verify no regression on non-s3 assets**

Find an asset with a non-s3 sourceUri (if any) or create one locally. Open its Metadata tab. Expected: DB · disabled badge, sidecar section or empty state. No error.

- [ ] **Step 8: Commit the deploy evidence**

Nothing to commit — this task is runtime only. Proceed to Task 8.

---

## Task 8 — Trino connectivity fix (one-line env change)

Unrelated to the metadata reader feature but in scope per user direction. The control-plane's `VAST_DATABASE_URL` points at the VAST S3 endpoint instead of the Trino coordinator, keeping the `vast-trino` breaker OPEN.

**Files:** (no repo code change; env-only change on the remote)

- [ ] **Step 1: Inspect the current env on the remote**

```bash
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "grep -n '^VAST_DATABASE_URL' ~/SpaceHarbor/.env"
```
Expected: `VAST_DATABASE_URL=http://172.200.201.67` (or similar wrong value).

- [ ] **Step 2: Update `.env` to the correct coordinator URL**

```bash
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 "
  cd ~/SpaceHarbor
  cp .env .env.bak.$(date +%s)
  sed -i 's|^VAST_DATABASE_URL=.*|VAST_DATABASE_URL=http://trino:8080|' .env
  grep '^VAST_DATABASE_URL' .env
"
```
Expected: `VAST_DATABASE_URL=http://trino:8080`. A timestamped backup exists.

- [ ] **Step 3: Recreate the control-plane container**

```bash
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose up -d control-plane 2>&1 | tail -5"
```

- [ ] **Step 4: Verify the env landed inside the container**

```bash
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "docker exec spaceharbor-control-plane env | grep ^VAST_DATABASE_URL"
```
Expected: `VAST_DATABASE_URL=http://trino:8080`.

- [ ] **Step 5: Reset the `vast-trino` breaker**

```bash
TOKEN=$(curl -s -X POST http://10.143.2.102:8080/api/v1/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"admin@spaceharbor.dev","password":"Vastdata2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

curl -s -X POST http://10.143.2.102:8080/api/v1/admin/breakers/vast-trino/reset \
  -H "authorization: Bearer $TOKEN" -w "\nStatus: %{http_code}\n"
```
Expected: 200.

- [ ] **Step 6: Verify Trino is reachable with a trivial query**

```bash
curl -s -X POST http://10.143.2.102:8080/api/v1/query/execute \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"sql":"SELECT 1 AS one"}' | python3 -m json.tool
```
Expected: `{"rows":[{"one":1}], ...}`.

- [ ] **Step 7: Confirm the breaker returns to `closed`**

```bash
curl -s http://10.143.2.102:8080/api/v1/admin/breakers \
  -H "authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
bs = json.load(sys.stdin).get('breakers', [])
for b in bs:
    print(f\"  {b.get('name'):<20} state={b.get('state'):<8} failures={b.get('failureCount', 0)}\")
"
```
Expected: `vast-trino state=closed`.

- [ ] **Step 8: Commit the ops note to the repo**

No code change was needed, but document the convention so future deploys don't regress. Add a line to `.env.example`:

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
# Confirm the current .env.example entry is empty
grep -n '^VAST_DATABASE_URL' .env.example
```

If the line is `VAST_DATABASE_URL=`, update it with a comment block:

```bash
# In .env.example, replace the VAST_DATABASE_URL= line with:
# ─────────────────────────────────────────────────────────────────────────
# VAST_DATABASE_URL
# Trino coordinator URL. For the bundled docker-compose stack, use the
# docker service name `trino` on its internal port 8080. For a production
# VAST cluster, point at the cluster's Trino coordinator HTTP endpoint.
# IMPORTANT: This is NOT the VAST S3 endpoint — that's SPACEHARBOR_S3_ENDPOINT.
# Mismatching these causes the vast-trino circuit breaker to open after the
# Trino client POSTs /v1/statement to S3 and gets a 400 InvalidBucketName.
# ─────────────────────────────────────────────────────────────────────────
VAST_DATABASE_URL=http://trino:8080
```

```bash
git add .env.example
git commit -m "chore(deploy): document VAST_DATABASE_URL coordinator convention

Adds a block comment to .env.example pointing at the common gotcha where
VAST_DATABASE_URL is accidentally set to the VAST S3 endpoint instead of
the Trino coordinator. Symptom: vast-trino breaker opens with 400
InvalidBucketName errors from S3 parsing /v1/statement as a bucket
name. Bundled compose uses http://trino:8080."
```

---

## Task 9 — Push + validate on GitHub + update wiki release notes

- [ ] **Step 1: Push all commits**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
git push origin main 2>&1 | tail -10
```
Expected: pushed successfully; show the old..new SHA range.

- [ ] **Step 2: Confirm the tip commit on GitHub via gh api**

```bash
git rev-parse HEAD
gh api repos/ssotoa70/SpaceHarbor/commits/$(git rev-parse HEAD) \
  --jq '{sha, message: (.commit.message | split("\n") | .[0]), files: (.files | length)}'
```
Expected: sha matches local, message matches the last commit, files count matches.

- [ ] **Step 3: Update the wiki Release Notes**

```bash
cd /tmp
rm -rf SpaceHarbor.wiki.metadata
git clone https://github.com/ssotoa70/SpaceHarbor.wiki.git SpaceHarbor.wiki.metadata
cd SpaceHarbor.wiki.metadata
```

Edit `Release-Notes.md`, add a new section at the top under the existing 2026-04-16 entries:

```markdown
### `<tip-sha>` — Asset metadata DB reader + Trino config fix

The AssetDetailPanel metadata tab now reads from the VAST DB tables declared in
the pipeline config (via the vastdb-query SDK sidecar), falling back to the S3
sidecar JSON when the DB has no rows or is unreachable. Schema/table names are
fully driven by the `dataEnginePipelines` platform setting — no env-bound
schema coupling.

- New `GET /api/v1/assets/:id/metadata` — unified merger
- New `GET /api/v1/metadata/lookup?path=&schema=&table=` on vastdb-query — schema-agnostic
- Source-status badges in the panel (DB · ok/empty/unreachable/disabled, Sidecar · ok/missing)
- Database fields grouped into Dimensions / Codec & color / Timing / File / Other

Separately, restored Trino connectivity on the dev cluster — `VAST_DATABASE_URL`
was misconfigured (pointing at the VAST S3 endpoint), kept the `vast-trino`
circuit breaker OPEN. `.env.example` updated with a warning block.

See [Asset Metadata](Asset-Metadata) for the new endpoint reference.
```

Also create `Asset-Metadata.md` with a page describing the endpoint, `sources` states, fallback rules, and panel behavior (mirror the Plugins / Naming-Templates wiki style).

```bash
git add Release-Notes.md Asset-Metadata.md
git commit -m "docs(wiki): asset metadata DB reader release notes + reference page"
git push origin master
```

- [ ] **Step 4: Mark the relevant tasks completed**

After everything passes, close out the session's task list using TaskUpdate.

---

## Completion Criteria

- All 9 unit+contract tests pass locally on the pure helpers and routes
- `/api/v1/metadata/lookup` returns data (or a clearly-structured error) when called directly on 10.143.2.102
- `/api/v1/assets/:id/metadata` returns a valid merged payload for a real asset
- Metadata tab in the web UI shows source badges; renders DB rows when present; renders sidecar JSON when present; empty state names the pipeline function
- `vast-trino` circuit breaker is `closed`; `/query/execute` with `SELECT 1` returns 200
- Repo is pushed to `main`; wiki updated; release notes entry links the tip SHA
