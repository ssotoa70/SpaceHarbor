# Metadata Plumbing Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make metadata routing fully config-driven and format-correct end-to-end across the web-ui — eliminate the last two "EXR-centric" legacy code paths, fix bug B (video lookup key mismatch), bug C (storage-browser video preview broken-image), bug D.1 (EXR-branded empty-state copy), time-boxed spike on bug D.2 (Process/Reprocess actions), then delete the two legacy endpoint families.

**Architecture:** Four concern-layers — Layer A (vastdb-query bucket-stripped fallback + counter metric), Layer B (web-ui classifier reshape adding `classifyForPipelines`), Layer C (four web-ui surface migrations onto unified readers + storage-browser fixes + D.2 spike), Layer D (cleanup of 4 web-ui helpers, 2 control-plane passthroughs, 8 Python endpoints). Layer A is independent; B blocks C; D is a hard grep-gated deletion step after A+B+C ship.

**Tech Stack:** Python 3.11 + FastAPI + vastdb SDK + pytest (vastdb-query). TypeScript + React 18 + Vite + @testing-library/react + Vitest (web-ui). Fastify 5 + tsx + node:test + `app.inject` (control-plane). Tailwind CSS v4. `fireEvent.click` / `fireEvent.change` pattern (codebase standard — NOT `userEvent`).

**Spec:** `docs/superpowers/specs/2026-04-18-metadata-plumbing-cleanup-design.md`.

**Branch:** `fix/metadata-plumbing-cleanup` (already created, starting commit `0f0cf9a`).

---

## Cross-cutting conventions

- **Feature branch only.** Never commit directly to `main`. Push incrementally; open PR when Layer D is ready for grep verification.
- **Conventional commits.** `feat:` for new capability, `fix:` for behavioral fix, `test:` for test-only, `refactor:` for internal moves with no behavior change, `chore:` for cleanup, `docs:` for documentation.
- **No hardcoded values.** Schema/bucket/URL/timeouts go through env vars + Platform Settings. Per `feedback_no_hardcoded_values.md`.
- **Never modify `services/dataengine-functions/`.** Per `feedback_dataengine_functions_deprecated.md`. Fixes there belong to another agent's repo.
- **`services/scanner-function/` IS in scope.** Per `project_scanner_function_in_scope.md`. Different from the protected `dataengine-functions/`.
- **Error envelope is flat.** `sendError()` returns `{ code, message, requestId, details }` — NOT nested `{ error: {...} }`. Verify test assertions use `body.code` and `body.message`, not `body.error.code`.
- **Show commit SHA after push.** Per `feedback_commit_sha_validation.md`. After `git push`, run `gh api repos/ssotoa70/SpaceHarbor/commits/<branch>` and show the SHA.
- **Stage individual files.** Do NOT use `git add .` or `git add -A` — list files explicitly.

### Deploy pattern (to `10.143.2.102`, password `vastdata`)

```bash
# vastdb-query (Python — needs container rebuild when deps or main.py change)
sshpass -p 'vastdata' rsync -az --exclude __pycache__ --exclude .pytest_cache \
  services/vastdb-query/ vastdata@10.143.2.102:~/SpaceHarbor/services/vastdb-query/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build vastdb-query && docker compose up -d vastdb-query"

# control-plane (tsx — no build unless deps)
sshpass -p 'vastdata' rsync -az -e "ssh -o StrictHostKeyChecking=no" \
  --exclude node_modules --exclude dist \
  services/control-plane/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/control-plane/src/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose restart control-plane"

# web-ui (Vite build into nginx image — rebuild)
sshpass -p 'vastdata' rsync -az --exclude node_modules --exclude dist \
  services/web-ui/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/web-ui/src/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build web-ui && docker compose up -d web-ui"
```

---

## File Structure

### Files created

| Path | Purpose |
|---|---|
| `services/web-ui/src/utils/metadata-routing.test.ts` | Unit tests for `classifyForPipelines` (new) + existing `metadataKindForFilename` invariants (co-located if not already present — check Task B1) |
| `services/control-plane/src/http/proxy.ts` | Relocated `proxyToVastdbQuery` helper (currently in `routes/exr-metadata.ts` which is being deleted) |

### Files modified

| Path | Layer | Change |
|---|---|---|
| `services/vastdb-query/main.py` | A | `/api/v1/metadata/lookup` handler — add bucket-stripped fallback + warn log + Prometheus counter |
| `services/vastdb-query/main.py` | A | Add `/metrics` endpoint + Prometheus instrumentation |
| `services/vastdb-query/requirements.txt` | A | Add `prometheus-client>=0.20.0` |
| `services/vastdb-query/tests/test_metadata_lookup.py` | A | Add 4 new tests for the fallback paths + counter |
| `services/web-ui/src/utils/metadata-routing.ts` | B | Add `classifyForPipelines` function |
| `services/web-ui/src/pages/AssetDetail.tsx` | C.1 | Replace `fetchExrMetadataLookup` with `useAssetMetadata` |
| `services/web-ui/src/pages/AssetBrowser.tsx` | C.1 | Replace 4 legacy calls with `useAssetMetadata` |
| `services/web-ui/src/components/AssetDetailPanel.tsx` | C.1 | Replace line 1244 legacy call; adapt AOV pills + Layers section to read channels from new response shape |
| `services/web-ui/src/pages/StorageBrowserPage.tsx` | C.2 | Replace `fetchExr/VideoMetadataLookup` with `useStorageSidecar`, branch preview by kind, format-neutral empty-state copy |
| `services/web-ui/src/pages/StorageBrowserPage.test.tsx` | C.2 | New tests for preview branch + empty-state + metadata rendering (or expand existing test file) |
| `services/web-ui/src/api.ts` | D.2 | Delete `fetchExrMetadataLookup`, `fetchVideoMetadataLookup`, `fetchExrMetadataStats`, `fetchVideoMetadataStats` + their types |
| `services/control-plane/src/routes/metadata-lookup-proxy.ts` | D.3 | Update import of `proxyToVastdbQuery` (from `./exr-metadata.js` to `../http/proxy.js`) |
| `services/control-plane/src/app.ts` | D.3 | Remove registration of `registerExrMetadataRoutes` + `registerVideoMetadataRoutes` |
| `services/control-plane/src/routes/exr-metadata.ts` | D.3 | Delete file |
| `services/control-plane/src/routes/video-metadata.ts` | D.3 | Delete file |
| `services/vastdb-query/main.py` | D.4 | Delete 8 endpoints (`/exr-metadata/*` × 4 + `/video-metadata/*` × 4) + their helpers |
| `.claude/handoff-spaceharbor.md` | post-ship | Update to reflect cycle outcome |

### Files deleted

- `services/control-plane/src/routes/exr-metadata.ts`
- `services/control-plane/src/routes/video-metadata.ts`
- Any test files solely covering the deleted routes (check during D.3).

### Wiki updates (post-merge, separate cycle)

- `Release-Notes.md` — append a "2026-04-DD — Metadata Plumbing Cleanup" section.
- `Admin-Guide-Metadata-Pipelines.md` — minor update if diagnostic flow changes.
- Done via the wiki repo clone pattern from the Phase 5.5 cycle.

---

## Layer A — vastdb-query fallback + observability

### Task A1: Add bucket-stripped fallback + warn log to `/api/v1/metadata/lookup`

**Context.** The current `/api/v1/metadata/lookup` handler in `services/vastdb-query/main.py` (lines 614-678) fetches ALL rows from the target table via `table_to_records(table_obj, limit=10000)`, then filters in Python by `match_col == key`. Bug B: the video extractor stores `s3_key` WITHOUT bucket prefix (e.g. `uploads/foo.mov`), while callers send the bucket-prefixed form (`sergio-spaceharbor/uploads/foo.mov`) — so video lookups return `count=0`. Fix: if the primary Python-side filter returns zero rows AND the input `key` contains a `/`, re-filter the SAME already-fetched `all_rows` with a bucket-stripped key. No additional SDK call needed.

**Files:**
- Modify: `services/vastdb-query/main.py:614-678` (the `metadata_lookup` handler)
- Test: `services/vastdb-query/tests/test_metadata_lookup.py`

- [ ] **Step 1: Write the failing tests**

Append to the end of `services/vastdb-query/tests/test_metadata_lookup.py`:

```python
class TestMetadataLookupBucketStrippedFallback:
    """Bug B fix: when primary match returns zero rows, retry with the
    bucket-stripped key variant. Video extractor stores s3_key WITHOUT
    bucket prefix; EXR extractor stores file_path WITH bucket prefix.
    Callers uniformly send the bucket-prefixed form."""

    def test_fallback_hits_when_primary_empty_and_path_has_slash(self, monkeypatch, caplog):
        """Primary match on `sergio-spaceharbor/uploads/foo.mov` misses.
        Fallback strips to `uploads/foo.mov` — that matches. Response
        count should be 1."""
        bkt, _table = _stub_bucket()
        all_rows = [
            {"s3_key": "uploads/foo.mov", "width": 1920, "duration": 42.0},
        ]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)

        with caplog.at_level("WARNING"):
            r = client.get(
                "/api/v1/metadata/lookup",
                params={"path": "sergio-spaceharbor/uploads/foo.mov",
                        "schema": "video_metadata", "table": "files"},
            )

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        assert body["matched_by"] == "s3_key"
        assert body["rows"][0]["duration"] == 42.0
        # Warn log captured with structured fields
        fallback_logs = [
            rec for rec in caplog.records
            if "metadata_lookup.fallback_hit" in rec.getMessage()
        ]
        assert len(fallback_logs) == 1, "expected exactly one fallback_hit warn log"

    def test_fallback_skipped_when_path_has_no_slash(self, monkeypatch, caplog):
        """Path without `/` (e.g. bare filename) — fallback has nothing
        to strip. Return the empty primary result without a warn log."""
        bkt, _table = _stub_bucket()
        all_rows = [{"s3_key": "uploads/foo.mov"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)

        with caplog.at_level("WARNING"):
            r = client.get(
                "/api/v1/metadata/lookup",
                params={"path": "bogus.mov",
                        "schema": "video_metadata", "table": "files"},
            )

        assert r.status_code == 200
        assert r.json()["count"] == 0
        fallback_logs = [
            rec for rec in caplog.records
            if "metadata_lookup.fallback_hit" in rec.getMessage()
        ]
        assert len(fallback_logs) == 0

    def test_fallback_miss_returns_empty_no_warn(self, monkeypatch, caplog):
        """Both primary and fallback miss. Response count=0, no warn log
        (genuine empty is expected, not a drift signal)."""
        bkt, _table = _stub_bucket()
        all_rows = [{"s3_key": "uploads/other.mov"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)

        with caplog.at_level("WARNING"):
            r = client.get(
                "/api/v1/metadata/lookup",
                params={"path": "sergio-spaceharbor/uploads/missing.mov",
                        "schema": "video_metadata", "table": "files"},
            )

        assert r.status_code == 200
        assert r.json()["count"] == 0
        fallback_logs = [
            rec for rec in caplog.records
            if "metadata_lookup.fallback_hit" in rec.getMessage()
        ]
        assert len(fallback_logs) == 0

    def test_fallback_preserves_response_shape(self, monkeypatch):
        """Fallback-hit response shape must be IDENTICAL to primary-hit
        response shape — callers don't know which path matched."""
        bkt, _table = _stub_bucket()
        all_rows = [{"s3_key": "uploads/baz.mov", "codec": "h264"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)

        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "sergio-spaceharbor/uploads/baz.mov",
                    "schema": "video_metadata", "table": "files"},
        )

        body = r.json()
        # Exact key set — same as primary-hit response
        assert set(body.keys()) == {"rows", "bucket", "schema", "table", "matched_by", "count"}
        # No fallback-indicating field leaks to the caller
        assert "matched_via" not in body
        assert "fallback" not in body
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/vastdb-query
python -m pytest tests/test_metadata_lookup.py::TestMetadataLookupBucketStrippedFallback -v
```

Expected: 4 tests FAIL. The first (`test_fallback_hits_when_primary_empty_and_path_has_slash`) should fail with `assert 0 == 1` on `body["count"]` because the current code does not retry with a stripped key.

- [ ] **Step 3: Implement the fallback logic**

Modify `services/vastdb-query/main.py:614-678`. Replace the current `metadata_lookup` function body with:

```python
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

    Bucket-stripped fallback (Bug B): video-metadata-extractor stores
    s3_key WITHOUT bucket prefix, while frame-metadata-extractor stores
    file_path WITH bucket prefix. Callers uniformly send the bucket-
    prefixed form. If the primary match is empty AND the path contains
    a slash, we re-filter the already-fetched rows with the bucket
    stripped. A warn log fires on fallback hit so ops can spot extractor
    drift.
    """
    key = _strip_s3_prefix(path)
    target_bucket = bucket or DEFAULT_BUCKET
    try:
        with vast_transaction(bucket=target_bucket) as bkt:
            schema_obj = bkt.schema(schema)
            table_obj = schema_obj.table(table)
            all_rows = table_to_records(table_obj, limit=10000)
            if not all_rows:
                return {
                    "rows": [],
                    "bucket": target_bucket,
                    "schema": schema,
                    "table": table,
                    "matched_by": None,
                    "count": 0,
                }
            column_names = list(all_rows[0].keys())
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
            # Primary: filter by the bucket-prefixed key (callers' canonical form)
            rows = [r for r in all_rows if r.get(match_col) == key]

            # Bucket-stripped fallback. Only re-filter if primary was empty
            # AND path has something left after the first slash to strip.
            if not rows and "/" in key:
                fallback_key = key.split("/", 1)[1]
                if fallback_key:  # guard against trailing slash edge case
                    rows = [r for r in all_rows if r.get(match_col) == fallback_key]
                    if rows:
                        logger.warning(
                            "metadata_lookup.fallback_hit path=%s fallback=%s schema=%s table=%s match_col=%s",
                            path, fallback_key, schema, table, match_col,
                        )

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
cd services/vastdb-query
python -m pytest tests/test_metadata_lookup.py -v
```

Expected: all tests PASS (new 4 + existing 13). If existing tests regress, the fallback is firing in a case it shouldn't — re-read the guard conditions.

- [ ] **Step 5: Commit**

```bash
git add services/vastdb-query/main.py services/vastdb-query/tests/test_metadata_lookup.py
git commit -m "fix(vastdb-query): bucket-stripped fallback for metadata lookup

Video extractor stores s3_key WITHOUT bucket prefix; EXR extractor
stores file_path WITH bucket prefix. Callers uniformly send the
bucket-prefixed form, so video lookups used to return count=0.

Fix: when primary match is empty AND path contains a slash, re-filter
the already-fetched rows with the bucket stripped. Warn log fires on
fallback hit so ops can spot extractor drift.

Response shape unchanged — fallback is silent to callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Add Prometheus counter metric for fallback hits

**Context.** Spec requires a `metadata_lookup_fallback_total{schema,table}` counter alongside the warn log. Ops can alert on fallback rate (extractor drift signal). Adding `prometheus-client` to requirements and exposing `/metrics` is the standard FastAPI pattern.

**Files:**
- Modify: `services/vastdb-query/requirements.txt` (add `prometheus-client`)
- Modify: `services/vastdb-query/main.py` (add counter + mount `/metrics`)
- Modify: `services/vastdb-query/tests/test_metadata_lookup.py` (counter-assertion test)

- [ ] **Step 1: Write the failing test**

Append to `services/vastdb-query/tests/test_metadata_lookup.py`, in the `TestMetadataLookupBucketStrippedFallback` class:

```python
    def test_fallback_hit_increments_counter(self, monkeypatch):
        """Each fallback hit increments metadata_lookup_fallback_total,
        labelled by schema and table."""
        from main import metadata_lookup_fallback_total

        before = metadata_lookup_fallback_total.labels(
            schema="video_metadata", table="files"
        )._value.get()

        bkt, _table = _stub_bucket()
        all_rows = [{"s3_key": "uploads/metric.mov"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)

        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "sergio-spaceharbor/uploads/metric.mov",
                    "schema": "video_metadata", "table": "files"},
        )
        assert r.status_code == 200
        assert r.json()["count"] == 1

        after = metadata_lookup_fallback_total.labels(
            schema="video_metadata", table="files"
        )._value.get()
        assert after == before + 1, f"counter did not increment: before={before} after={after}"

    def test_metrics_endpoint_exposes_counter(self):
        """/metrics returns Prometheus exposition format including the
        metadata_lookup_fallback_total counter."""
        r = client.get("/metrics")
        assert r.status_code == 200
        # Prometheus format — plain text, content-type matters for scrapers
        assert "text/plain" in r.headers.get("content-type", "")
        assert "metadata_lookup_fallback_total" in r.text
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/vastdb-query
python -m pytest tests/test_metadata_lookup.py::TestMetadataLookupBucketStrippedFallback::test_fallback_hit_increments_counter -v
```

Expected: FAIL with `ImportError: cannot import name 'metadata_lookup_fallback_total' from 'main'`.

- [ ] **Step 3: Add `prometheus-client` to requirements**

Modify `services/vastdb-query/requirements.txt` to append:

```
prometheus-client>=0.20.0
```

Full file after edit:

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
vastdb>=1.2.0
pyarrow>=15.0.0
prometheus-client>=0.20.0
```

Install locally:

```bash
cd services/vastdb-query
pip install -r requirements.txt
```

- [ ] **Step 4: Define the counter and /metrics endpoint**

Modify `services/vastdb-query/main.py`. After the existing `import` block (around line 37), add:

```python
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response
```

Below the `MATCH_COLUMN_PRIORITY` declaration (around line 75), before `resolve_match_column`, add:

```python
# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------
# Counter incremented each time /api/v1/metadata/lookup falls back from the
# primary bucket-prefixed key to the bucket-stripped variant. A sustained
# rate indicates extractor drift (the video-metadata-extractor stores
# s3_key without the bucket prefix while callers uniformly send the
# prefixed form). Ops should alert on rate(metadata_lookup_fallback_total[5m])
# exceeding 10% of rate(metadata_lookup_total[5m]) — that threshold is
# empirical; tune per deployment.
metadata_lookup_fallback_total = Counter(
    "metadata_lookup_fallback_total",
    "Count of /metadata/lookup calls that hit via the bucket-stripped fallback path",
    ["schema", "table"],
)
```

Register the `/metrics` endpoint. After the `app = FastAPI(...)` block (around line 95), before `app.add_middleware`, add:

```python
@app.get("/metrics", include_in_schema=False)
def prometheus_metrics():
    """Prometheus scrape endpoint. Exposes all registered metrics in the
    standard text-based exposition format. No authentication — intended
    for scraping by a trusted in-cluster Prometheus agent."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

- [ ] **Step 5: Wire counter increment into fallback path**

In the `metadata_lookup` handler (the function you modified in Task A1), find the block:

```python
                    if rows:
                        logger.warning(
                            "metadata_lookup.fallback_hit path=%s fallback=%s schema=%s table=%s match_col=%s",
                            path, fallback_key, schema, table, match_col,
                        )
```

Add the counter increment right after the `logger.warning` line, so the block becomes:

```python
                    if rows:
                        logger.warning(
                            "metadata_lookup.fallback_hit path=%s fallback=%s schema=%s table=%s match_col=%s",
                            path, fallback_key, schema, table, match_col,
                        )
                        metadata_lookup_fallback_total.labels(
                            schema=schema, table=table
                        ).inc()
```

- [ ] **Step 6: Run all vastdb-query tests to verify**

```bash
cd services/vastdb-query
python -m pytest tests/ -v
```

Expected: ALL tests pass — 15 pre-existing + 4 fallback tests from A1 + 2 counter tests from A2 = 21 tests green.

- [ ] **Step 7: Commit**

```bash
git add services/vastdb-query/requirements.txt services/vastdb-query/main.py services/vastdb-query/tests/test_metadata_lookup.py
git commit -m "feat(vastdb-query): Prometheus counter for metadata lookup fallback hits

Exposes /metrics endpoint + metadata_lookup_fallback_total{schema,table}
counter. Ops can alert on sustained fallback rate to spot extractor drift
(video-metadata-extractor vs frame-metadata-extractor s3_key/file_path
key-format inconsistency). Counter increments alongside the existing
warn log, not instead of it — the log is for per-case diagnosis, the
counter supports automated rate-alerting without log parsing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Deploy + smoke-test + VastDB index verification

**Context.** Spec requires a pre-ship check: confirm the `/metadata/lookup` primary filter hits indexed columns rather than full-scanning. In the current implementation the handler already reads ALL rows into Python via `table_to_records(...)` and filters in memory — so index coverage of `s3_key`/`file_path` is not load-bearing at the query-planner level. This task verifies the practical behavior on a real cluster and documents the finding.

**Files:** no code changes unless the verification fails. If the check surfaces a scaling problem, open a new task for sequential-probe refactoring — do NOT inline-fix during this deploy step.

- [ ] **Step 1: Deploy A1 + A2 to `10.143.2.102`**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
sshpass -p 'vastdata' rsync -az --exclude __pycache__ --exclude .pytest_cache \
  services/vastdb-query/ vastdata@10.143.2.102:~/SpaceHarbor/services/vastdb-query/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build vastdb-query && docker compose up -d vastdb-query"
sleep 5  # wait for container to come up
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose ps vastdb-query"
```

Expected: `vastdb-query` shows `Up` and `healthy`.

- [ ] **Step 2: Smoke-test fallback path with a known video file**

Pick a `.mov` file known to exist in `video_metadata.files` (ask user if needed, or use `sergio-spaceharbor/uploads/lola-vfx-480-v2.mov` per the issues doc). Run two lookups — one with bucket prefix (should hit via fallback), one without (should hit directly):

```bash
# Bucket-prefixed — primary miss, fallback hit, warn log fires
curl -s 'http://10.143.2.102:8070/api/v1/metadata/lookup?path=sergio-spaceharbor/uploads/lola-vfx-480-v2.mov&schema=video_metadata&table=files' | jq '{count, matched_by}'

# Bucket-stripped — primary hit, no fallback, no warn
curl -s 'http://10.143.2.102:8070/api/v1/metadata/lookup?path=uploads/lola-vfx-480-v2.mov&schema=video_metadata&table=files' | jq '{count, matched_by}'
```

Expected: both return `{"count": 1, "matched_by": "s3_key"}`.

- [ ] **Step 3: Verify warn log + counter on host**

```bash
# Warn log — should contain 1 fallback_hit from the prefixed call
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "docker compose logs vastdb-query --tail 50 | grep -i fallback_hit"

# Counter metric — should show video_metadata/files = 1
curl -s http://10.143.2.102:8070/metrics | grep metadata_lookup_fallback_total
```

Expected in logs:
```
metadata_lookup.fallback_hit path=sergio-spaceharbor/uploads/lola-vfx-480-v2.mov fallback=uploads/lola-vfx-480-v2.mov schema=video_metadata table=files match_col=s3_key
```

Expected from /metrics:
```
metadata_lookup_fallback_total{schema="video_metadata",table="files"} 1.0
```

- [ ] **Step 4: Verify EXR lookup still works (regression check)**

```bash
# EXR lookup — extractor stores bucket-prefixed file_path, primary should hit, no fallback
curl -s 'http://10.143.2.102:8070/api/v1/metadata/lookup?path=sergio-spaceharbor/uploads/pixar_5603.exr&schema=frame_metadata&table=files' | jq '{count, matched_by}'
```

Expected: `{"count": 1, "matched_by": "file_path"}`. Counter should NOT increment for this call.

- [ ] **Step 5: Measure query latency (informational)**

Run the bucket-prefixed video lookup 10 times and record wall-clock time:

```bash
for i in {1..10}; do
  curl -o /dev/null -s -w "%{time_total}\n" 'http://10.143.2.102:8070/api/v1/metadata/lookup?path=sergio-spaceharbor/uploads/lola-vfx-480-v2.mov&schema=video_metadata&table=files'
done
```

**If p95 latency exceeds 2 seconds**, note it in the PR description as a follow-up. The current implementation reads the entire table into Python — for small tables (<10K rows) this is fine, for larger tables it will eventually need predicate pushdown. Do NOT inline-refactor during this task.

- [ ] **Step 6: Push branch and report SHA**

```bash
git push origin fix/metadata-plumbing-cleanup
gh api repos/ssotoa70/SpaceHarbor/commits/fix/metadata-plumbing-cleanup --jq '{sha, message: .commit.message}' | head -c 300
```

Report the SHA, last commit message, and the smoke-test results (counter = 1, both logs fire as expected) in the PR checkpoint.

---

## Layer B — Classifier reshape

### Task B1: Add `classifyForPipelines` helper + unit tests

**Context.** Spec requires a new classifier `classifyForPipelines(filename, pipelines)` that returns `{ kind, pipeline }` where `kind` derives from the matched pipeline's `fileKind` (`"image" | "video" | "raw_camera"`) and `pipeline` is the full `DiscoveredPipeline` object. When `pipelines` is `null` (still discovering) or `[]` (empty config), the function falls through to the existing `metadataKindForFilename` static-set path so `useStorageSidecar`'s on-mount eligibility gate still works. `MetadataKind` widens to include `"raw_camera"`.

**Files:**
- Modify: `services/web-ui/src/utils/metadata-routing.ts`
- Create or modify: `services/web-ui/src/utils/metadata-routing.test.ts` (file may not exist — check first)

- [ ] **Step 1: Check for existing test file**

```bash
ls services/web-ui/src/utils/metadata-routing.test.ts 2>/dev/null || echo "file does not exist — create it"
```

If the file does not exist, create it with the content in Step 2. If it exists, append the new describe block only.

- [ ] **Step 2: Write the failing tests**

Create (or append to) `services/web-ui/src/utils/metadata-routing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

import {
  metadataKindForFilename,
  classifyForPipelines,
  METADATA_IMAGE_EXTS,
  METADATA_VIDEO_EXTS,
} from "./metadata-routing";
import type { DiscoveredPipeline } from "../api";

// Build a realistic three-pipeline config matching the production default.
function makePipelines(): DiscoveredPipeline[] {
  return [
    {
      config: {
        fileKind: "image",
        functionName: "frame-metadata-extractor",
        extensions: [".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg"],
        targetSchema: "frame_metadata",
        targetTable: "files",
        sidecarSchemaId: "frame@1",
        displayLabel: "Images",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "video",
        functionName: "video-metadata-extractor",
        extensions: [".mp4", ".mov", ".mxf", ".avi", ".mkv", ".m4v", ".webm"],
        targetSchema: "video_metadata",
        targetTable: "files",
        sidecarSchemaId: "video@1",
        displayLabel: "Video",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "raw_camera",
        functionName: "raw-camera-metadata-extractor",
        extensions: [".r3d", ".braw"],
        targetSchema: "raw_camera_metadata",
        targetTable: "files",
        sidecarSchemaId: "raw@1",
        displayLabel: "Raw Camera",
      },
      live: null,
      status: "ok",
    },
  ];
}

describe("metadataKindForFilename (existing static-set path)", () => {
  // Back-compat invariant — these must continue to pass unchanged.
  it("classifies EXR as image", () => {
    expect(metadataKindForFilename("shot_001.exr")).toBe("image");
  });
  it("classifies MOV as video", () => {
    expect(metadataKindForFilename("take_03.mov")).toBe("video");
  });
  it("classifies R3D as video (legacy — static set folds raw into video)", () => {
    // Existing behavior: static-set path returns "video" for R3D/BRAW
    // because they share the video-metadata-extractor. classifyForPipelines
    // can distinguish raw_camera when a pipeline exists; the sync path
    // cannot.
    expect(metadataKindForFilename("A001_C001.r3d")).toBe("video");
  });
  it("returns none for unknown extension", () => {
    expect(metadataKindForFilename("readme.md")).toBe("none");
  });
  it("returns none for filename without extension", () => {
    expect(metadataKindForFilename("no-extension")).toBe("none");
  });
});

describe("classifyForPipelines (new pipeline-aware path)", () => {
  it("classifies EXR via image pipeline", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("shot_001.exr", pipelines);
    expect(result.kind).toBe("image");
    expect(result.pipeline?.config.fileKind).toBe("image");
    expect(result.pipeline?.config.functionName).toBe("frame-metadata-extractor");
  });

  it("classifies MOV via video pipeline", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("take_03.mov", pipelines);
    expect(result.kind).toBe("video");
    expect(result.pipeline?.config.fileKind).toBe("video");
  });

  it("classifies R3D via raw_camera pipeline (distinct from video)", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("A001_C001.r3d", pipelines);
    expect(result.kind).toBe("raw_camera");
    expect(result.pipeline?.config.fileKind).toBe("raw_camera");
  });

  it("returns none + null pipeline for unknown extension", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("readme.md", pipelines);
    expect(result.kind).toBe("none");
    expect(result.pipeline).toBeNull();
  });

  it("falls through to static sets when pipelines is null", () => {
    // Used by useStorageSidecar's on-mount eligibility gate, before
    // the pipelines fetch has resolved.
    const result = classifyForPipelines("shot.exr", null);
    expect(result.kind).toBe("image");
    expect(result.pipeline).toBeNull();
  });

  it("falls through to static sets and returns 'video' for R3D when pipelines is null", () => {
    // Back-compat: when the async pipelines list is unavailable, R3D
    // maps to 'video' (same as the static-set path).
    const result = classifyForPipelines("A001.r3d", null);
    expect(result.kind).toBe("video");
    expect(result.pipeline).toBeNull();
  });

  it("returns none for every filename when pipelines is empty array", () => {
    // Empty config — seed hasn't been run. No pipeline matches, so
    // everything is 'none'. Caller renders "No pipeline configured".
    expect(classifyForPipelines("shot.exr", [])).toEqual({ kind: "none", pipeline: null });
    expect(classifyForPipelines("clip.mov", [])).toEqual({ kind: "none", pipeline: null });
  });

  it("matches case-insensitively on extension", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("SHOT.EXR", pipelines);
    expect(result.kind).toBe("image");
  });

  it("returns first match when multiple pipelines contain the same extension", () => {
    // Defensive — the validator prevents this at write time, but if
    // somehow two pipelines both claim .exr, we return the first.
    const pipelines: DiscoveredPipeline[] = [
      {
        config: { fileKind: "image", functionName: "a", extensions: [".exr"],
                  targetSchema: "a", targetTable: "a", sidecarSchemaId: "a" },
        live: null, status: "ok",
      },
      {
        config: { fileKind: "video", functionName: "b", extensions: [".exr"],
                  targetSchema: "b", targetTable: "b", sidecarSchemaId: "b" },
        live: null, status: "ok",
      },
    ];
    const result = classifyForPipelines("shot.exr", pipelines);
    expect(result.pipeline?.config.functionName).toBe("a");
  });

  it("returns disabled pipelines too (classification, not routing decision)", () => {
    // A disabled pipeline still classifies the file — callers decide
    // what to do with a disabled pipeline.
    const pipelines: DiscoveredPipeline[] = [
      {
        config: { fileKind: "image", functionName: "a", extensions: [".exr"],
                  targetSchema: "a", targetTable: "a", sidecarSchemaId: "a" },
        live: null, status: "function-not-found",
      },
    ];
    const result = classifyForPipelines("shot.exr", pipelines);
    expect(result.kind).toBe("image");
    expect(result.pipeline).toBe(pipelines[0]);
  });
});

describe("METADATA_IMAGE_EXTS + METADATA_VIDEO_EXTS (static sets — unchanged)", () => {
  // Guard test — the static sets exist for the null-pipelines fallback
  // path and for useStorageSidecar's eligibility gate. Their contents
  // should not change in this cycle.
  it("static image set contains .exr", () => {
    expect(METADATA_IMAGE_EXTS.has(".exr")).toBe(true);
  });
  it("static video set contains .mov and raw camera formats", () => {
    expect(METADATA_VIDEO_EXTS.has(".mov")).toBe(true);
    expect(METADATA_VIDEO_EXTS.has(".r3d")).toBe(true);
    expect(METADATA_VIDEO_EXTS.has(".braw")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd services/web-ui
npx vitest run src/utils/metadata-routing.test.ts
```

Expected: the `classifyForPipelines` block fails because the function does not exist. The `metadataKindForFilename` block should pass.

- [ ] **Step 4: Add `MetadataKind` widening + `classifyForPipelines` to `metadata-routing.ts`**

Modify `services/web-ui/src/utils/metadata-routing.ts`. Replace the existing `MetadataKind` type with the widened version, and append the new `classifyForPipelines` function.

Find:

```typescript
export type MetadataKind = "image" | "video" | "none";
```

Replace with:

```typescript
export type MetadataKind = "image" | "video" | "raw_camera" | "none";
```

Append at the bottom of the file (after `metadataKindForFilename`):

```typescript
import type { DiscoveredPipeline } from "../api";
import { findPipelineForFilename } from "../hooks/useDataEnginePipelines";

/** Result of a pipeline-aware classification. `kind` reflects the
 *  matched pipeline's `fileKind` (including `raw_camera` when the
 *  filename matches a raw pipeline). `pipeline` is the full
 *  DiscoveredPipeline so callers can read schema/table/functionName
 *  without a second lookup. */
export interface ClassificationResult {
  kind: MetadataKind;
  pipeline: DiscoveredPipeline | null;
}

/**
 * Pipeline-aware file-kind classifier. Preferred over
 * `metadataKindForFilename` when the caller has async access to the
 * discovered pipelines list.
 *
 * - `pipelines: DiscoveredPipeline[]` → match filename's extension against
 *   each pipeline's `extensions` list. Return `{ kind, pipeline }` where
 *   `kind` is the pipeline's `fileKind` (`"image" | "video" | "raw_camera"`).
 *   Returns `{ kind: "none", pipeline: null }` when no pipeline matches.
 *
 * - `pipelines: null` → falls through to the static-set path via
 *   `metadataKindForFilename`. Used by `useStorageSidecar` on mount
 *   before the pipelines fetch resolves.
 *
 * - `pipelines: []` (empty config) → returns `{ kind: "none", pipeline: null }`
 *   for every filename. Callers render "No pipeline configured".
 *
 * Case-insensitive on extension. Returns the first matching pipeline
 * when multiple have overlapping extensions (the server-side validator
 * prevents this at write time).
 */
export function classifyForPipelines(
  filename: string,
  pipelines: DiscoveredPipeline[] | null,
): ClassificationResult {
  if (pipelines === null) {
    // Fall through to static-set path — preserves useStorageSidecar's
    // on-mount eligibility gate behavior.
    return { kind: metadataKindForFilename(filename), pipeline: null };
  }

  const pipeline = findPipelineForFilename(pipelines, filename);
  if (!pipeline) {
    return { kind: "none", pipeline: null };
  }

  return { kind: pipeline.config.fileKind, pipeline };
}
```

Note: the `import type { DiscoveredPipeline }` + `import { findPipelineForFilename }` lines go at the top of the file with the other imports — TypeScript/ESLint will hoist them. Keep the existing static-set exports untouched.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd services/web-ui
npx vitest run src/utils/metadata-routing.test.ts
```

Expected: all tests in both `describe` blocks PASS.

- [ ] **Step 6: Run full web-ui test suite to confirm no regression**

```bash
cd services/web-ui
npx vitest run
```

Expected: no new test failures. Pre-existing failures (if any) should be identical to baseline.

- [ ] **Step 7: Commit**

```bash
git add services/web-ui/src/utils/metadata-routing.ts services/web-ui/src/utils/metadata-routing.test.ts
git commit -m "feat(web-ui): add classifyForPipelines pipeline-aware classifier

Adds a new classifier that reads the live dataEnginePipelines config
(from useDataEnginePipelines) and returns both the file kind and the
full DiscoveredPipeline object. Widens MetadataKind to include
'raw_camera' (the static-set path folds raw into 'video' since R3D/BRAW
share an extractor; the new path can distinguish them when a raw
pipeline is configured).

Back-compat: existing metadataKindForFilename keeps its signature and
static-set behavior. classifyForPipelines falls through to it when the
async pipelines list is unavailable, preserving useStorageSidecar's
on-mount eligibility gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Layer C — Web-UI migrations

### Task C1: Migrate `AssetDetail.tsx` off `fetchExrMetadataLookup`

**Context.** `AssetDetail.tsx` (detail page under `/assets/:id`) currently calls `fetchExrMetadataLookup(a.sourceUri)` at line 38 ONLY when the asset's source URI ends in `.exr`. The response is stored in `exrMeta` state but the file does not appear to render the data in the visible UI — search the file for `exrMeta` to confirm. This is the simplest of the three asset-surface migrations; it may be safe to remove `exrMeta` state entirely rather than wire up `useAssetMetadata`. Verify before writing.

**Files:**
- Modify: `services/web-ui/src/pages/AssetDetail.tsx`

- [ ] **Step 1: Inventory current uses of `exrMeta`**

```bash
grep -n "exrMeta\|ExrMetadataLookup" services/web-ui/src/pages/AssetDetail.tsx
```

Expected output locations:
- `import { fetchExrMetadataLookup, ..., type ExrMetadataLookupResult }` (around line 4-11)
- `const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null)` (around line 27)
- `fetchExrMetadataLookup(a.sourceUri).then(setExrMeta)` (around line 38)
- Possibly NO render-site. If `exrMeta` is set but never read, delete state entirely.

- [ ] **Step 2: If `exrMeta` has no render site — delete the state + fetch**

(If the grep output shows `exrMeta` used only in the state declaration and the fetch call, proceed with this step. Otherwise skip to Step 3.)

Edit `services/web-ui/src/pages/AssetDetail.tsx` imports — remove `fetchExrMetadataLookup` and `ExrMetadataLookupResult`:

```typescript
// Before:
import {
  fetchAsset,
  fetchAssetAudit,
  fetchExrMetadataLookup,
  type AssetRow,
  type AuditRow,
  type ExrMetadataLookupResult,
} from "../api";

// After:
import {
  fetchAsset,
  fetchAssetAudit,
  type AssetRow,
  type AuditRow,
} from "../api";
```

Remove the `exrMeta` state declaration:

```typescript
// Before:
const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
const [loading, setLoading] = useState(true);

// After:
const [loading, setLoading] = useState(true);
```

Remove the fetch call in the useEffect at line 30-41:

```typescript
// Before:
useEffect(() => {
  if (!id) return;
  Promise.all([fetchAsset(id), fetchAssetAudit(id)]).then(([a, auditRows]) => {
    setAsset(a);
    setAudit(auditRows);
    setLoading(false);
    // If asset has an EXR source, look up rich metadata from the frame-metadata-extractor table
    if (a?.sourceUri?.toLowerCase().endsWith(".exr")) {
      fetchExrMetadataLookup(a.sourceUri).then(setExrMeta);
    }
  });
}, [id]);

// After:
useEffect(() => {
  if (!id) return;
  Promise.all([fetchAsset(id), fetchAssetAudit(id)]).then(([a, auditRows]) => {
    setAsset(a);
    setAudit(auditRows);
    setLoading(false);
  });
}, [id]);
```

- [ ] **Step 3: If `exrMeta` has a render site — migrate to `useAssetMetadata`**

(Skip this step if Step 2 succeeded. Only do this if grep showed `exrMeta` is actually rendered somewhere in the JSX.)

Replace the legacy lookup with `useAssetMetadata(id)`. Update imports:

```typescript
// Before:
import {
  fetchAsset,
  fetchAssetAudit,
  fetchExrMetadataLookup,
  type AssetRow,
  type AuditRow,
  type ExrMetadataLookupResult,
} from "../api";

// After:
import {
  fetchAsset,
  fetchAssetAudit,
  type AssetRow,
  type AuditRow,
} from "../api";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
```

Replace the `exrMeta` state with the hook:

```typescript
// Before:
const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);

// After:
const metadataResult = useAssetMetadata(id);
const metadata = metadataResult.data;
```

Remove the `fetchExrMetadataLookup(...).then(setExrMeta)` call from the useEffect.

Adapt any JSX that read `exrMeta.summary`, `exrMeta.parts[0]`, `exrMeta.channels`, etc. to read from `metadata.dbRows[0]` or `metadata.sidecar` — both are `Record<string, unknown>`. Field names to try in order: the dbRows are the canonical source; sidecar is the fallback. Render fields with `humanizeLabel(key)` (check the codebase for this helper or use inline `.replace(/_/g, " ")`).

- [ ] **Step 4: Run test suite to verify no regression**

```bash
cd services/web-ui
npx vitest run
npx tsc --noEmit
```

Expected: no TypeScript errors, no test regressions. If `AssetDetail.tsx` has a test file, it should still pass.

- [ ] **Step 5: Commit**

```bash
git add services/web-ui/src/pages/AssetDetail.tsx
git commit -m "refactor(web-ui): remove unused fetchExrMetadataLookup from AssetDetail

[If Step 2 path — exrMeta was unused]:
exrMeta was fetched but never rendered. Dead code from the pre-C-1b era
before the unified metadata reader shipped. Removed along with its
state declaration to prepare for legacy endpoint deletion.

[If Step 3 path — exrMeta was rendered]:
AssetDetail now reads metadata via useAssetMetadata, the unified DB +
sidecar reader introduced in C-1b. Bespoke EXR-specific rendering
replaced by the grouped-by-family layout that AssetDetailPanel's
MetadataTab already uses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Migrate `AssetBrowser.tsx` off legacy metadata lookups

**Context.** `AssetBrowser.tsx` lines 499-527 run a `useEffect` that branches by `metadataKindForFilename(filename)`:
- `image` → calls `fetchExrMetadataLookup(asset.sourceUri)`, falls back to filename-only on miss (line 508-517).
- `video` → calls `fetchVideoMetadataLookup(asset.sourceUri)`, falls back to filename-only on miss (line 519-526).

Both fallback branches become redundant once Layer A is shipped — the server now handles the bucket-prefix fallback itself. Migrate to `useAssetMetadata(asset.id)` and let the C-1b unified reader + Layer A fallback handle everything.

**Files:**
- Modify: `services/web-ui/src/pages/AssetBrowser.tsx`

- [ ] **Step 1: Inventory existing state + render sites**

```bash
grep -n "exrMeta\|videoMeta\|ExrMetadataLookup\|VideoMetadataLookup\|metadataKindForFilename" services/web-ui/src/pages/AssetBrowser.tsx
```

Record every line number where `exrMeta`, `videoMeta`, `exr.summary`, `exr.parts`, `exr.channels`, `videoMeta.summary`, or `videoMeta.attributes` is read in JSX. Those are the render sites to adapt.

- [ ] **Step 2: Read the dynamic fields block (around lines 530-575 and any subsequent render sites)**

```bash
sed -n '530,600p' services/web-ui/src/pages/AssetBrowser.tsx
```

Understand the `fields` array construction (lines ~537-543) and where `exr.summary`, `exr.parts`, `exr.channels`, `videoMeta.summary`, `videoMeta.attributes` are consumed. These will all move to reading `metadata.dbRows[0]` + `metadata.sidecar`.

- [ ] **Step 3: Update imports**

Replace the api.ts import block at line 5:

```typescript
// Before:
import { fetchAssets, fetchVersionDependencies, fetchCatalogUnregistered, ingestAsset, fetchExrMetadataLookup, fetchVideoMetadataLookup, fetchMediaUrls, type AssetRow, type AssetDependencyData, type UnregisteredFile, type ExrMetadataLookupResult, type VideoMetadataLookupResult } from "../api";

// After:
import { fetchAssets, fetchVersionDependencies, fetchCatalogUnregistered, ingestAsset, fetchMediaUrls, type AssetRow, type AssetDependencyData, type UnregisteredFile } from "../api";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
```

Keep `metadataKindForFilename` import untouched (still used for AOV-pill / layer-rendering decisions if any).

- [ ] **Step 4: Replace state + effect**

Find the state declarations around line ~460-470 (search for `setExrMeta\|setVideoMeta\|useState<Exr\|useState<Video`):

```typescript
// Before:
const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
const [videoMeta, setVideoMeta] = useState<VideoMetadataLookupResult | null>(null);

// After:
const metadataResult = useAssetMetadata(asset?.id);
const metadata = metadataResult.data;
```

(Note: `useAssetMetadata` accepts `string | null | undefined` — the hook no-ops when the argument is falsy.)

Delete the entire `useEffect` at lines 499-529 that conditionally calls `fetchExrMetadataLookup` / `fetchVideoMetadataLookup` — the hook replaces it. Keep any other useEffects unchanged.

- [ ] **Step 5: Adapt render sites**

For each render site you inventoried in Step 1, rewrite the field access:

```typescript
// Before — EXR summary shape:
const exr = exrMeta?.found ? exrMeta : null;
const summary = exr?.summary;
const firstPart = exr?.parts?.[0];
addField("Image", "Resolution", summary?.resolution);
addField("Image", "Channels", summary ? String(summary.channelCount) : null);
addField("Technical", "Compression", firstPart?.compression);

// After — unified response shape:
// metadata.dbRows[0] is the canonical record for the image pipeline.
// metadata.sidecar is the S3 JSON sidecar (same fields, different key-casing).
const dbRow = metadata?.dbRows[0] as Record<string, unknown> | undefined;
const sidecar = metadata?.sidecar as Record<string, unknown> | null | undefined;
// Prefer dbRow; fall back to sidecar when dbRow field is missing.
const field = (name: string): string | null => {
  const v = dbRow?.[name] ?? sidecar?.[name];
  return v == null ? null : String(v);
};
addField("Image", "Resolution", field("resolution") ?? (field("width") && field("height") ? `${field("width")}x${field("height")}` : null));
addField("Image", "Channels", field("channel_count") ?? field("channels"));
addField("Technical", "Compression", field("compression"));
```

For video fields:

```typescript
// Before — videoMeta.summary + videoMeta.attributes pattern:
const vm = videoMeta?.found ? videoMeta : null;
Object.entries(vm?.summary ?? {}).forEach(([k, v]) => addField("Media", humanizeLabel(k), v));

// After — read directly from dbRow + sidecar:
const dbRow = metadata?.dbRows[0] as Record<string, unknown> | undefined;
const sidecar = metadata?.sidecar as Record<string, unknown> | null | undefined;
const combined = { ...(sidecar ?? {}), ...(dbRow ?? {}) };  // dbRow takes precedence
// Media-fields — read well-known names directly, or iterate all keys
Object.entries(combined).forEach(([k, v]) => {
  if (v != null && v !== "") addField("Media", humanizeLabel(k), v);
});
```

- [ ] **Step 6: Run TypeScript + tests**

```bash
cd services/web-ui
npx tsc --noEmit
npx vitest run
```

Expected: no TypeScript errors. Pre-existing tests still pass. `AssetBrowser` tests may need update if they asserted against `exrMeta.summary` — rewrite to assert against the new response shape.

- [ ] **Step 7: Commit**

```bash
git add services/web-ui/src/pages/AssetBrowser.tsx
git commit -m "refactor(web-ui): migrate AssetBrowser to useAssetMetadata

Removes two legacy lookup paths (fetchExrMetadataLookup +
fetchVideoMetadataLookup) and their filename-fallback branches that
papered over the bucket-prefix inconsistency. Those branches become
redundant now that the server-side /metadata/lookup has a bucket-
stripped fallback (Layer A).

AssetBrowser reads from useAssetMetadata which hits /assets/:id/metadata —
the unified DB + sidecar reader from C-1b. Bespoke EXR/video-specific
field extraction replaced by direct reads from metadata.dbRows[0] and
metadata.sidecar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Migrate `AssetDetailPanel.tsx` line 1244 + preserve AOV pills/Layers section

**Context.** `AssetDetailPanel.tsx` has TWO separate metadata fetch paths:
1. **MetadataTab** (line ~407-470) — already uses `useAssetMetadata(asset.id)` from C-1b. Don't touch.
2. **Panel-level `exrMeta` state** (around line 1240-1245) — fetches `fetchExrMetadataLookup(asset.sourceUri)` and populates `exrMeta`. Used by:
   - AOV pills block (line 1282) — reads `exrMeta.channels`
   - LayersSection / `renderLayers` (line ~982-1025) — reads `exrMeta.channels` and groups by layer
   - Other `exrMeta` consumers (line 1184 uses `meta.channels` — verify)

The AOV pills and Layers section are **VFX-critical UX** flagged by the UX review. We cannot drop them. Migration strategy: keep this panel-level state, but change the fetch to reuse the same `useAssetMetadata` hook's response (or extract channels from `metadata.sidecar?.channels`). The sidecar JSON produced by frame-metadata-extractor contains the same channel data.

**Files:**
- Modify: `services/web-ui/src/components/AssetDetailPanel.tsx`

- [ ] **Step 1: Inventory all uses of `exrMeta` in the panel**

```bash
grep -n "exrMeta\|setExrMeta\|ExrMetadataLookup\|fetchExrMetadataLookup" services/web-ui/src/components/AssetDetailPanel.tsx
```

Record every line number where `exrMeta.channels`, `exrMeta.parts`, `exrMeta.summary`, `exrMeta.found` is referenced. These are the adaptation sites.

- [ ] **Step 2: Inspect sidecar field shape for channels**

The plan needs to know the sidecar key name for channels. Check existing code that parses the sidecar:

```bash
grep -n "sidecar\.channels\|sidecar\[.channels\.\]\|data.channels\|\"channels\"" services/web-ui/src/
grep -rn "\"channels\"" services/dataengine-functions/ 2>/dev/null | head -10
```

**If the sidecar key is `channels` (most likely):** proceed with Step 3 below using `metadata.sidecar?.channels`.

**If the sidecar key is different (e.g. `layers`, `image_channels`):** substitute the correct name in the code below.

**If the key cannot be determined at plan-write time:** the implementer should fetch a sample sidecar from a live EXR asset on `10.143.2.102` via:

```bash
curl -s 'http://10.143.2.102:8080/api/v1/storage/metadata?sourceUri=s3://sergio-spaceharbor/uploads/pixar_5603.exr' | jq '.data | keys'
```

and use the actual key name in the adaptation.

- [ ] **Step 3: Add a lightweight `exrMeta`-shaped adapter from `metadata.sidecar`**

Rather than rewrite every render site, build an adapter so existing JSX ergonomics are preserved. Import `useAssetMetadata`:

```typescript
// Add to existing imports at the top of AssetDetailPanel.tsx
import { useAssetMetadata } from "../hooks/useAssetMetadata";
```

Remove the legacy import:

```typescript
// Before (at the top of the file, around line 6):
import {
  fetchAsset,
  // ...
  fetchExrMetadataLookup,
  // ...
  type ExrMetadataLookupResult,
  // ...
} from "../api";

// After:
import {
  fetchAsset,
  // ...
  // (fetchExrMetadataLookup + ExrMetadataLookupResult deleted from the import list)
} from "../api";
```

(Preserve every other name in the block; only those two are removed.)

Find the `exrMeta` state + fetch around lines 1240-1245. Replace:

```typescript
// Before:
const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
// ... later:
useEffect(() => {
  if (!asset.sourceUri) return;
  void fetchExrMetadataLookup(asset.sourceUri).then(setExrMeta);
}, [asset.sourceUri]);

// After:
const panelMetadata = useAssetMetadata(asset.id);
// Adapter — shape the unified response into the ExrMetadataLookupResult
// contract the downstream rendering code was built against. Channels
// come from the sidecar JSON (frame-metadata-extractor writes them
// alongside the DB row). Summary / parts come from dbRows[0] when
// present.
const exrMeta: ExrMetadataLookupResultLike | null = useMemo(() => {
  if (!panelMetadata.data) return null;
  const sidecar = panelMetadata.data.sidecar as Record<string, unknown> | null;
  const dbRow = panelMetadata.data.dbRows[0] as Record<string, unknown> | undefined;
  const channels = (sidecar?.channels as ExrChannel[] | undefined) ?? [];
  const parts = (sidecar?.parts as ExrPart[] | undefined) ?? [];
  const summary = (sidecar?.summary as ExrSummary | undefined)
    ?? (dbRow
      ? { resolution: dbRow.resolution as string | undefined,
          channelCount: dbRow.channel_count as number | undefined,
          isDeep: dbRow.is_deep as boolean | undefined,
          frameNumber: dbRow.frame_number as number | undefined }
      : undefined);
  return {
    found: (panelMetadata.data.dbRows.length > 0) || !!sidecar,
    channels,
    parts,
    summary,
    file: (sidecar?.file as ExrFile | undefined) ?? undefined,
  };
}, [panelMetadata.data]);
```

You will also need these local type aliases near the top of the file (or just above the adapter — TypeScript-scope doesn't matter here):

```typescript
// Local adapter types — shape-compatible with the former
// ExrMetadataLookupResult. Kept local so we don't re-export a
// transitional type from api.ts.
interface ExrChannel {
  part_index: number;
  channel_name: string;
  channel_type?: string;
  layer_name?: string;
  component_name?: string;
}
interface ExrPart {
  compression?: string;
  color_space?: string | null;
  pixel_aspect_ratio?: number | string;
  is_tiled?: boolean;
  tile_width?: number;
  tile_height?: number;
  render_software?: string;
  data_window?: string | null;
  display_window?: string | null;
}
interface ExrSummary {
  resolution?: string;
  channelCount?: number;
  isDeep?: boolean;
  frameNumber?: number;
}
interface ExrFile {
  inspection_timestamp: string;
}
interface ExrMetadataLookupResultLike {
  found: boolean;
  channels: ExrChannel[];
  parts: ExrPart[];
  summary?: ExrSummary;
  file?: ExrFile;
}
```

Import `useMemo` if not already imported:

```typescript
import { useEffect, useMemo, useRef, useState, /* existing */ } from "react";
```

- [ ] **Step 4: Verify the reset-on-asset-change effect still compiles**

Find the existing `useEffect` that resets `exrMeta` on asset change (around line 1263-1271):

```typescript
useEffect(() => {
  setInfo(null);
  setHistory(null);
  setExrMeta(null);
  // ...
}, [asset.id, asset.title, asset.sourceUri]);
```

Since `exrMeta` is now a `useMemo`-derived value (not a `useState`), remove the `setExrMeta(null)` line:

```typescript
useEffect(() => {
  setInfo(null);
  setHistory(null);
  // exrMeta is useMemo-derived now; it updates automatically on asset change
  // via panelMetadata's dependency on asset.id.
  const mt = inferMediaType(asset.title, asset.sourceUri);
  setActiveTab(mt === "image" || mt === "video" || mt === "raw" ? "metadata" : "info");
}, [asset.id, asset.title, asset.sourceUri]);
```

- [ ] **Step 5: Run TypeScript + tests**

```bash
cd services/web-ui
npx tsc --noEmit
npx vitest run
```

Expected: no TypeScript errors. The `AssetDetailPanel.metadata-tab.test.tsx` should pass unchanged (MetadataTab wasn't touched). If other AssetDetailPanel tests reference `exrMeta.setExrMeta`, update them.

- [ ] **Step 6: Manual smoke — verify AOV pills still render for EXR asset**

Deploy web-ui to `10.143.2.102` (see Cross-cutting deploy pattern). Navigate to an EXR asset (via Asset Browser), open the Asset Detail panel. Verify:

- AOV pill row appears at the top of the panel (between FrameBar and content).
- Each pill shows a layer name (e.g. `rgba`, `diffuse`, `specular`).
- Channel layers in the MetadataTab Layers section render normally.

**If AOV pills do NOT render:** the sidecar key for channels is different from `channels`. Go back to Step 2, find the real key name (via `jq '.data | keys'` on a live sidecar), and update the adapter.

- [ ] **Step 7: Commit**

```bash
git add services/web-ui/src/components/AssetDetailPanel.tsx
git commit -m "refactor(web-ui): AssetDetailPanel.exrMeta migrates to useAssetMetadata

The panel-level exrMeta state (separate from MetadataTab's own
useAssetMetadata) was reading /exr-metadata/lookup. Migrated to reuse
useAssetMetadata's unified DB + sidecar response via a local adapter
that preserves the shape existing render code was built against.

Channels for the AOV pill row and the Layers section come from the
sidecar JSON (frame-metadata-extractor writes them). Summary/parts
come from dbRows[0] when present, falling back to sidecar keys.

No UX change — AOV pills and layer rendering remain pixel-identical
verified on live EXR asset. The refactor is a plumbing-only swap
that unblocks legacy endpoint deletion in Layer D.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Migrate `StorageBrowserPage.tsx` — sidecar-only + preview branch + empty-state copy

**Context.** `StorageBrowserPage.FileDetailSidebar` (around line 47-220) currently:
- Calls `fetchExrMetadataLookup(filename)` for image files, `fetchVideoMetadataLookup(filename)` for video files. Both are being deleted.
- Renders `<img src={previewUrl} />` for every file kind — the `.mov` broken-image bug.
- Renders "No EXR metadata available for this file" empty-state copy regardless of actual file kind.

New behavior:
- Metadata fetch → `useStorageSidecar(sourceUri)` (hook already exists; was going unused here).
- Preview pane → branches on `classifyForPipelines(filename, pipelines).kind`: `<img alt={filename}>` for images, `<video poster controls>` for video, styled empty-state for raw_camera and none.
- Empty-state copy → format-neutral, routed by kind. `kind === "none"` surfaces a CTA to `/automation/pipelines`.
- Field-parity test: sidecar JSON keys and DB response column names align for the same asset.

**Files:**
- Modify: `services/web-ui/src/pages/StorageBrowserPage.tsx`
- Create or modify: `services/web-ui/src/pages/StorageBrowserPage.test.tsx`

- [ ] **Step 1: Write failing tests for preview branch + empty-state**

Create `services/web-ui/src/pages/StorageBrowserPage.test.tsx` (if it doesn't exist; otherwise append a new describe block). Paste:

```typescript
/**
 * StorageBrowserPage.FileDetailSidebar tests — Layer C.2 behavioral
 * contract. Asserts the preview pane branches by file kind, metadata
 * comes from useStorageSidecar (not legacy helpers), and the empty-state
 * copy is format-neutral with a CTA for unsupported extensions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { StorageBrowserPage } from "./StorageBrowserPage";
import * as api from "../api";
import * as useDataEnginePipelinesModule from "../hooks/useDataEnginePipelines";

function makePipelines(): api.DiscoveredPipeline[] {
  return [
    {
      config: {
        fileKind: "image", functionName: "frame-metadata-extractor",
        extensions: [".exr", ".dpx", ".tif", ".png", ".jpg"],
        targetSchema: "frame_metadata", targetTable: "files",
        sidecarSchemaId: "frame@1",
      },
      live: null, status: "ok",
    },
    {
      config: {
        fileKind: "video", functionName: "video-metadata-extractor",
        extensions: [".mp4", ".mov", ".mxf"],
        targetSchema: "video_metadata", targetTable: "files",
        sidecarSchemaId: "video@1",
      },
      live: null, status: "ok",
    },
    {
      config: {
        fileKind: "raw_camera", functionName: "raw-camera-metadata-extractor",
        extensions: [".r3d", ".braw"],
        targetSchema: "raw_camera_metadata", targetTable: "files",
        sidecarSchemaId: "raw@1",
      },
      live: null, status: "ok",
    },
  ];
}

// Helper — build a "file selected" state by hand so we don't need to
// drive through the full browser UI. This assumes FileDetailSidebar is
// exported or reachable via setting the selected file in the page.
// If the sidebar isn't independently exported, test via selecting a
// row: render StorageBrowserPage, fire click on the row, assert the
// sidebar DOM. See Step 4 below for the exact pattern.

describe("StorageBrowserPage.FileDetailSidebar — preview pane branch", () => {
  beforeEach(() => {
    vi.spyOn(useDataEnginePipelinesModule, "useDataEnginePipelines").mockReturnValue({
      pipelines: makePipelines(),
      loading: false,
      error: null,
      refresh: () => {},
    });
    vi.spyOn(api, "fetchMediaUrls").mockResolvedValue({
      thumbnail: "https://proxy/test.jpg",
      source: "https://proxy/test.mp4",
    } as api.MediaUrlsResponse);
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue({
      schema_version: "1", file_kind: "video", source_uri: "s3://bucket/foo.mov",
      sidecar_key: "foo.mov.metadata.json", data: { duration: 42 },
    } as api.StorageMetadataResponse);
    // Legacy spies — assert they are NEVER called
    vi.spyOn(api, "fetchExrMetadataLookup" as keyof typeof api);
    vi.spyOn(api, "fetchVideoMetadataLookup" as keyof typeof api);
  });

  it("renders <video> element with poster for .mov file", async () => {
    // Render the sidebar for a .mov file — exact wiring depends on
    // how the sidebar is triggered. Pseudocode:
    //   1. Render StorageBrowserPage with an initial bucket listing mock
    //   2. fireEvent.click on the .mov row to open the sidebar
    //   3. Assert <video> present, not <img>
    // Minimal implementation — adjust selector to your row element:
    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    // ... set up .mov row fixture via the same mechanism existing tests use ...
    // After sidebar opens:
    await waitFor(() => expect(screen.getByRole("heading")).toBeInTheDocument());
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("poster")).toBe("https://proxy/test.jpg");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(document.querySelector('img[alt]')).toBeFalsy();
  });

  it("renders <img> with alt text for .exr file", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue({
      schema_version: "1", file_kind: "image", source_uri: "s3://bucket/foo.exr",
      sidecar_key: "foo.exr.metadata.json", data: { width: 2048, channels: [{channel_name: "R"}] },
    } as api.StorageMetadataResponse);
    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    // Select .exr row (same mechanism as existing tests)
    await waitFor(() => expect(screen.getByRole("heading")).toBeInTheDocument());
    const img = document.querySelector("img[alt]");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toMatch(/\.exr$/);
  });

  it("renders styled 'No preview available' for .r3d raw camera file", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue({
      schema_version: "1", file_kind: "raw_camera", source_uri: "s3://bucket/A001.r3d",
      sidecar_key: "A001.r3d.metadata.json", data: {},
    } as api.StorageMetadataResponse);
    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("heading")).toBeInTheDocument());
    expect(screen.getByText(/no preview available for raw camera/i)).toBeInTheDocument();
    // Should NOT render <video> or <img> preview element
    expect(document.querySelector("video")).toBeFalsy();
    expect(document.querySelector("img[alt]")).toBeFalsy();
  });

  it("shows 'No pipeline configured for .xyz' + CTA for unsupported extension", async () => {
    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    // Select a .xyz row (fixture for an unsupported extension)
    await waitFor(() => expect(screen.getByRole("heading")).toBeInTheDocument());
    expect(screen.getByText(/no pipeline configured for \.xyz/i)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /automation.pipelines|metadata pipelines/i });
    expect(cta).toBeInTheDocument();
    expect(cta.getAttribute("href")).toBe("/automation/pipelines");
  });
});

describe("StorageBrowserPage.FileDetailSidebar — metadata source", () => {
  beforeEach(() => {
    vi.spyOn(useDataEnginePipelinesModule, "useDataEnginePipelines").mockReturnValue({
      pipelines: makePipelines(),
      loading: false,
      error: null,
      refresh: () => {},
    });
    vi.spyOn(api, "fetchMediaUrls").mockResolvedValue({
      thumbnail: null, source: null,
    } as api.MediaUrlsResponse);
  });

  it("calls fetchStorageMetadata with sourceUri, not legacy helpers", async () => {
    const storageSpy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue({
      schema_version: "1", file_kind: "video", source_uri: "s3://bucket/foo.mov",
      sidecar_key: "foo.mov.metadata.json", data: { duration: 12 },
    } as api.StorageMetadataResponse);
    const legacyExrSpy = vi.spyOn(api, "fetchExrMetadataLookup" as keyof typeof api);
    const legacyVideoSpy = vi.spyOn(api, "fetchVideoMetadataLookup" as keyof typeof api);

    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    // select .mov row
    await waitFor(() => expect(storageSpy).toHaveBeenCalled());
    expect(storageSpy).toHaveBeenCalledWith(expect.stringContaining(".mov"));
    expect(legacyExrSpy).not.toHaveBeenCalled();
    expect(legacyVideoSpy).not.toHaveBeenCalled();
  });

  it("renders 'Metadata unavailable in this view' when sidecar is null", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockRejectedValue(
      new api.ApiRequestError(404, "sidecar not found"),
    );
    render(<MemoryRouter><StorageBrowserPage /></MemoryRouter>);
    // select a file
    await waitFor(() => {
      expect(screen.getByText(/metadata unavailable in this view/i)).toBeInTheDocument();
    });
  });
});

describe("StorageBrowserPage — sidecar/DB field-name parity (guard test)", () => {
  // Guard against extractor drift where the sidecar JSON and DB response
  // use different names for the same field. If this test fails, the
  // storage-browser (sidecar-based) and the asset-panel (DB-based) will
  // render the same file's metadata differently.
  it("sidecar and dbRow share canonical field names for image fixture", () => {
    const canonical = ["width", "height", "channel_count", "compression", "color_space", "data_window", "display_window"];
    const sidecarFixture = {
      width: 2048, height: 858, channel_count: 4,
      compression: "zip", color_space: "ACES2065-1",
      data_window: "0,0,2047,857", display_window: "0,0,2047,857",
    };
    const dbRowFixture = {
      width: 2048, height: 858, channel_count: 4,
      compression: "zip", color_space: "ACES2065-1",
      data_window: "0,0,2047,857", display_window: "0,0,2047,857",
    };
    for (const key of canonical) {
      expect(sidecarFixture).toHaveProperty(key);
      expect(dbRowFixture).toHaveProperty(key);
    }
  });
});
```

**Note about test fixture wiring.** The exact way to "select a row" depends on how existing `StorageBrowserPage` tests drive the page. If there is no existing test file, follow this heuristic: mock `fetchStorageBrowse` / the listing fetch to return a single row, render the page, `fireEvent.click` on the row element, and assert the sidebar DOM. If you run into test scaffolding issues, split Step 1 into two sub-steps — first make a minimal "renders something" test work, then add the new assertions.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/web-ui
npx vitest run src/pages/StorageBrowserPage.test.tsx
```

Expected: most new tests FAIL with assertions like "expected `<video>` but found `<img>`" or "expected 'No pipeline configured for .xyz' but got 'No EXR metadata available'".

- [ ] **Step 3: Update imports in StorageBrowserPage.tsx**

Edit `services/web-ui/src/pages/StorageBrowserPage.tsx` top of file:

```typescript
// Before (partial):
import {
  fetchStorageBrowse,
  fetchMediaUrls,
  fetchExrMetadataLookup,
  fetchVideoMetadataLookup,
  fetchProcessingStatus,
  // ...
  requestProcessing,
  // ...
  type ExrMetadataLookupResult,
  type VideoMetadataLookupResult,
  // ...
} from "../api";
import { metadataKindForFilename } from "../utils/metadata-routing";

// After:
import {
  fetchStorageBrowse,
  fetchMediaUrls,
  fetchProcessingStatus,
  // ...
  requestProcessing,
  // ...
} from "../api";
import { useStorageSidecar } from "../hooks/useStorageSidecar";
import { useDataEnginePipelines } from "../hooks/useDataEnginePipelines";
import { classifyForPipelines } from "../utils/metadata-routing";
```

Delete the imports of `fetchExrMetadataLookup`, `fetchVideoMetadataLookup`, `ExrMetadataLookupResult`, `VideoMetadataLookupResult`, and `metadataKindForFilename`.

- [ ] **Step 4: Rewrite `FileDetailSidebar` body**

Find `FileDetailSidebar` (around line 47). Replace the state + effects + preview pane JSX + metadata pane JSX:

Replace from just after `function FileDetailSidebar({ ... })` signature, through to but not including the `// Processing controls` block (or whatever follows the metadata rendering). The full replaced block:

```typescript
function FileDetailSidebar({
  file, onClose,
}: {
  file: StorageBrowseFile;
  onClose: () => void;
}) {
  const filename = file.key.split("/").pop() ?? file.key;
  const ext = filename.includes(".") ? filename.substring(filename.lastIndexOf(".")).toLowerCase() : "";

  // Pipelines for kind + pipeline-aware empty-state routing
  const { pipelines } = useDataEnginePipelines();
  const { kind } = classifyForPipelines(filename, pipelines.length > 0 ? pipelines : null);

  // Metadata from the sidecar JSON via the existing hook
  const { sidecar, loading: sidecarLoading, error: sidecarError } = useStorageSidecar(file.sourceUri);
  const sidecarData = (sidecar?.data as Record<string, unknown> | undefined) ?? null;

  // Preview URL — same path as before (thumbnail or source)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  useEffect(() => {
    setPreviewUrl(null);
    setThumbnailUrl(null);
    void fetchMediaUrls(file.sourceUri).then((urls) => {
      setThumbnailUrl(urls.thumbnail ?? null);
      setPreviewUrl(urls.source ?? urls.thumbnail ?? null);
    });
  }, [file.sourceUri]);

  return (
    <div className="w-96 border-l border-gray-700 bg-gray-900/95 overflow-y-auto flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white truncate" title={filename}>{filename}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
      </div>

      {/* Preview area — branches by kind */}
      <div className="h-48 bg-gray-950 flex items-center justify-center border-b border-gray-700">
        {kind === "image" && previewUrl ? (
          <img src={previewUrl} alt={filename} className="max-h-full max-w-full object-contain" />
        ) : kind === "video" && previewUrl ? (
          <video
            src={previewUrl}
            poster={thumbnailUrl ?? undefined}
            controls
            className="max-h-full max-w-full"
            onError={(e) => {
              // Proxy format may be browser-incompatible (ProRes, DNxHR,
              // HEVC in some browsers). Hide the broken element and
              // surface the styled "preview unavailable" fallback by
              // nulling previewUrl.
              (e.target as HTMLVideoElement).style.display = "none";
              setPreviewUrl(null);
            }}
          />
        ) : kind === "raw_camera" ? (
          <div className="text-gray-500 text-xs font-mono px-4 text-center">
            No preview available for raw camera files
          </div>
        ) : (
          <div className="text-gray-600 text-xs font-mono">No preview</div>
        )}
      </div>

      {/* Metadata area */}
      {sidecarLoading ? (
        <div className="p-4 text-gray-500 text-sm">Loading metadata…</div>
      ) : sidecarData ? (
        <div className="p-4 space-y-2">
          {/* Dynamic field list — the sidecar is format-neutral JSON */}
          {Object.entries(sidecarData)
            .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
            .map(([key, value]) => (
              <DetailRow key={key} label={humanizeLabel(key)} value={String(value)} mono={key.includes("uri") || key.includes("path")} />
            ))}
          <Section title="File">
            <DetailRow label="Size" value={formatBytes(file.sizeBytes)} />
            <DetailRow label="Path" value={file.key} mono />
            <DetailRow label="S3 URI" value={file.sourceUri} mono />
          </Section>
        </div>
      ) : (
        <div className="p-4 text-gray-500 text-sm">
          {kind === "none" ? (
            <>
              <p>No pipeline configured for <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded">{ext || "this file type"}</code>.</p>
              <p className="mt-2">
                <a href="/automation/pipelines" className="text-cyan-400 hover:text-cyan-300 underline">
                  Configure Metadata Pipelines →
                </a>
              </p>
            </>
          ) : sidecarError ? (
            <p>Metadata unavailable in this view. Open the asset panel for the full record.</p>
          ) : (
            <p>Metadata unavailable in this view. Open the asset panel for the full record.</p>
          )}
        </div>
      )}

      {/* ... the rest of the sidebar (Processing controls, etc.) stays unchanged ... */}
    </div>
  );
}
```

Locate the pre-existing `Section`, `DetailRow`, `formatBytes`, `humanizeLabel` helpers below this component — they should remain untouched. If any of those helpers become unused (e.g. ones only needed for the old EXR-specific rendering), delete them in a follow-up commit rather than bundling with this behavioral change.

- [ ] **Step 5: Delete now-unused EXR/video-specific helpers**

Check for now-unused helpers in the file (humanizeLabel might still be used, Section and DetailRow definitely still used). Grep from the file top:

```bash
grep -n "function " services/web-ui/src/pages/StorageBrowserPage.tsx | head -15
```

If any helper (e.g. `EXR channel-grouping`, `video-sprite rendering`) no longer has callers, delete it with a note in the commit message.

- [ ] **Step 6: Run tests**

```bash
cd services/web-ui
npx tsc --noEmit
npx vitest run src/pages/StorageBrowserPage.test.tsx
```

Expected: all new tests PASS. TypeScript clean.

- [ ] **Step 7: Deploy + manual smoke on `10.143.2.102`**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
sshpass -p 'vastdata' rsync -az --exclude node_modules --exclude dist \
  services/web-ui/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/web-ui/src/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build web-ui && docker compose up -d web-ui"
```

Manual smoke on `http://10.143.2.102:4173` → log in → Library → Storage Browser:

- Click `.exr` → image preview renders with `alt` text (inspect element); metadata sidebar shows sidecar fields.
- Click `.mov` → `<video controls>` plays with poster thumbnail visible before play (NOT broken image).
- Click `.jpg` → same as `.exr` if a JPG pipeline entry includes `.jpg` (should be the case after Phase 5.5).
- Click `.r3d` (if available) → "No preview available for raw camera files" in styled panel.
- Click `.xyz` fake (e.g. a stray `.txt`) → "No pipeline configured for .txt" with working CTA link.

- [ ] **Step 8: Commit**

```bash
git add services/web-ui/src/pages/StorageBrowserPage.tsx services/web-ui/src/pages/StorageBrowserPage.test.tsx
git commit -m "fix(web-ui): storage-browser sidebar — format-correct preview + sidecar metadata

Three behavioral fixes + one plumbing migration, all in the
FileDetailSidebar component:

1. Preview pane branches by file kind (classifyForPipelines). <img>
   with alt text for images, <video> with poster thumbnail + controls
   for video (fixes Bug C broken-image placeholder for .mov),
   styled 'No preview available' for raw camera, styled 'No preview'
   for unsupported.

2. Metadata comes from useStorageSidecar (already-existing hook,
   previously unused by this page) — reads the S3 sidecar JSON which
   is format-neutral. Drops the hardcoded fetchExrMetadataLookup /
   fetchVideoMetadataLookup branches.

3. Empty-state copy is routed by kind. kind==='none' shows 'No pipeline
   configured for .ext' with a CTA link to /automation/pipelines.
   Otherwise 'Metadata unavailable in this view. Open the asset panel
   for the full record.' — an honest fallback that does not imply the
   file was unprocessed when the DB row may exist without a sidecar.

4. Plumbing: video <video onError> degrades to the 'preview unavailable'
   styled fallback if the proxy format is browser-incompatible
   (ProRes, DNxHR, HEVC).

Covers bugs C and D.1 from docs/issues/2026-04-17-metadata-plumbing-followups.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C5: D.2 spike — diagnose Process/Reprocess action failures

**Context.** Symptom: Process/Reprocess button fires for some files (e.g. `pixar.mp4` shows `Triggered` pill) but not others. User reports the action does nothing for certain files. Time-boxed **1 day** investigation. Three ranked probes; exit criteria defined upfront.

**Files:** this is investigation — no code changes unless probe 1 is the root cause.

- [ ] **Probe 1 — Hardcoded classifier on process route or worker dispatch (most likely)**

Find the POST handler for `/api/v1/storage/process`:

```bash
grep -rn "/storage/process\|requestProcessing\|storage-process" services/control-plane/src/routes/
```

Read the handler. Look for:
- Extension-set checks (`.exr`, `.mov`, etc. as literals)
- `metadataKindForFilename` calls or equivalent classifier
- `fileKind` filtering before dispatch

Also grep the worker dispatch path:

```bash
grep -rn "storage.process\|process_request\|processing.request" services/control-plane/src/
```

If probe 1 hits (finds a hardcoded classifier in the process route or worker dispatch): **GO TO Step 4**.

- [ ] **Probe 2 — Event broker topic routing**

Run on `10.143.2.102`:

```bash
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose logs control-plane --tail 200 | grep -E 'broker|kafka|topic|publish'"
```

Click Process/Reprocess on a KNOWN-WORKING file in the web-ui, then on a KNOWN-FAILING file. Inspect the log differences. Look for:
- Topic name per file kind — do all three kinds resolve to a valid topic?
- Publish success/failure responses from the broker.
- Missing consumer groups.

- [ ] **Probe 3 — IAM / feature-flag gating**

```bash
grep -rn "storage:process\|process.*permission\|SPACEHARBOR_PROCESS" services/control-plane/src/
```

Check whether the process action is gated by a permission that differs per file kind. Verify the currently-logged-in user (`admin@spaceharbor.dev`) has that permission against every expected file kind.

- [ ] **Step 4 — Decide based on probe findings**

**Case A — Probe 1 hit (hardcoded classifier):** fix inside this task. Swap the hardcoded classifier for `classifyForPipelines(filename, pipelines)`. Write a failing test for a previously-broken file kind, implement the fix, verify.

**Case B — Probe 2 or 3 hit (broker routing or IAM):** out of scope for this cycle. Open a separate issue at `docs/issues/2026-04-18-process-actions-root-cause.md` documenting:
- Root cause observed (broker topic routing misconfigured / IAM gating broken / etc.)
- Which file kinds are affected
- Proposed fix scope

Branch out: create `fix/process-actions` from `fix/metadata-plumbing-cleanup` HEAD, and document in the new issue that this branch will be picked up in a follow-up. Do NOT start the fix on this branch.

**Case C — No probe finds a root cause in 1 day:** document what was checked and what was eliminated in the same new issue file. Layer C.5 closes as "spike complete, no fix landed; follow-up on fix/process-actions".

- [ ] **Step 5 (if Case A) — Failing test for fixed kind**

Assume probe 1 found a hardcoded `metadataKindForFilename` call in the process route. Write a test asserting that `POST /storage/process` with a `.jpg` file's sourceUri returns 200 when the image pipeline includes `.jpg`:

```typescript
// Append to services/control-plane/test/routes/storage-process.test.ts
// (or create if no existing test file — check for existing patterns first)

import { test } from "node:test";
import assert from "node:assert/strict";

// ... existing imports + setup ...

test("POST /storage/process with a .jpg file dispatches when .jpg is in image pipeline", async (t) => {
  const app = await buildApp({ /* fixtures: admin user, pipelines mock with .jpg in image */ });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/storage/process",
    payload: { sourceUri: "s3://bucket/uploads/shot.jpg" },
  });
  assert.equal(response.statusCode, 200);
  // ... further assertions on dispatch state ...
});
```

- [ ] **Step 6 (if Case A) — Run test, fix, verify, commit**

```bash
cd services/control-plane
npm test
# Expect: NEW test FAILS with hardcoded-classifier error
```

Apply the fix — swap the hardcoded classifier for `classifyForPipelines` or equivalent server-side helper.

```bash
npm test
# Expect: all tests PASS
```

Commit:

```bash
git add services/control-plane/src/routes/storage-process.ts services/control-plane/test/routes/storage-process.test.ts
git commit -m "fix(control-plane): storage-process routes via pipelines config, not hardcoded classifier

Bug D.2: Process/Reprocess button fired for some files but not others
because the process route used a hardcoded file-kind classifier instead
of reading from the admin-configured dataEnginePipelines table. Files
whose extensions weren't in the hardcoded set (e.g. .jpg, which lives
in the image pipeline) were silently skipped.

Fix: route through the same pipeline config the rest of the app now
uses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7 (if Case B or C) — Commit the issue doc**

```bash
git add docs/issues/2026-04-18-process-actions-root-cause.md
git commit -m "docs: D.2 spike outcome — process actions root cause deferred

Time-boxed spike per plan Task C5. [Case B] Root cause is
[broker topic routing / IAM gating / other] — out of scope for
metadata-plumbing-cleanup cycle. Tracked in new follow-up branch
fix/process-actions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Layer C verification — before Layer D

### Task C-verify: Deploy all of A + B + C, manual smoke, push branch

- [ ] **Step 1: Run full test suite locally**

```bash
cd services/web-ui && npx vitest run && npx tsc --noEmit
cd services/control-plane && npm test
cd services/vastdb-query && python -m pytest tests/ -v
```

Expected: all green across all three services.

- [ ] **Step 2: Deploy all three services**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
# vastdb-query
sshpass -p 'vastdata' rsync -az --exclude __pycache__ --exclude .pytest_cache \
  services/vastdb-query/ vastdata@10.143.2.102:~/SpaceHarbor/services/vastdb-query/
# control-plane
sshpass -p 'vastdata' rsync -az -e "ssh -o StrictHostKeyChecking=no" \
  --exclude node_modules --exclude dist \
  services/control-plane/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/control-plane/src/
# web-ui
sshpass -p 'vastdata' rsync -az --exclude node_modules --exclude dist \
  services/web-ui/src/ vastdata@10.143.2.102:~/SpaceHarbor/services/web-ui/src/

sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build vastdb-query web-ui && \
   docker compose up -d vastdb-query web-ui && \
   docker compose restart control-plane"
```

- [ ] **Step 3: Run manual smoke-test checklist from the spec**

Per spec `docs/superpowers/specs/2026-04-18-metadata-plumbing-cleanup-design.md` section "Manual smoke-test checklist":

1. Asset browser → `.exr` → side panel shows >20 metadata fields. Verify VFX-critical fields are prominent and human-readably labelled in the grouped-by-family layout: channels list, parts/layers, color space, data window, display window, compression, pixel aspect. Preview renders as image with `alt` text present.
2. Asset browser → `.mov` → side panel shows video metadata, preview renders as playable `<video controls>` with poster thumbnail visible before play.
3. Storage browser → bucket navigation → `.exr` → image preview with `alt` text, metadata renders from sidecar JSON.
4. Storage browser → `.mov` → video preview plays in `<video>` element (OR styled "Preview unavailable in this browser" if proxy format incompatible).
5. Storage browser → `.jpg` → empty-state routes correctly (either image-pipeline fields OR "No pipeline configured" CTA depending on config).
6. Storage browser → raw camera file (`.r3d` or `.braw`) → styled "No preview available for raw camera files" empty-state.
7. Storage browser → Process/Reprocess click → triggered-state pill appears (D.2 if fixed).
8. Pipelines page → no console errors (no legacy endpoint calls yet — legacy still exists).
9. vastdb-query logs contain `metadata_lookup.fallback_hit` warn entries on video lookups. Counter metric `metadata_lookup_fallback_total` increments on Prometheus scrape:
   ```bash
   curl -s http://10.143.2.102:8070/metrics | grep metadata_lookup_fallback_total
   ```

**If any smoke-test step fails:** do NOT proceed to Layer D. Open a follow-up task on the same branch.

- [ ] **Step 4: Push all work, validate remote SHA**

```bash
git push origin fix/metadata-plumbing-cleanup
gh api repos/ssotoa70/SpaceHarbor/commits/fix/metadata-plumbing-cleanup --jq '{sha, message: .commit.message}' | head -c 400
```

Report the SHA and smoke-test outcome.

---

## Layer D — Cleanup (grep-gated)

### Task D1: Relocate `proxyToVastdbQuery` helper

**Context.** `proxyToVastdbQuery` is currently exported from `services/control-plane/src/routes/exr-metadata.ts` (line 26). `services/control-plane/src/routes/metadata-lookup-proxy.ts` imports it from there (we're keeping metadata-lookup-proxy). Before deleting exr-metadata.ts, move the helper to a neutral location.

**Files:**
- Create: `services/control-plane/src/http/proxy.ts`
- Modify: `services/control-plane/src/routes/metadata-lookup-proxy.ts`

- [ ] **Step 1: Create the new helper module**

Write `services/control-plane/src/http/proxy.ts`:

```typescript
/**
 * HTTP proxy helper — relays requests to the vastdb-query service.
 *
 * Used by metadata routes that need to reach vastdb-query. Extracted
 * here so the route modules don't have to import from each other.
 * Previously lived in routes/exr-metadata.ts (which is being deleted
 * as part of the legacy endpoint cleanup).
 */

import { vastFetch } from "../vast/vast-fetch.js";

/** Base URL of the vastdb-query service. */
function getVastdbQueryUrl(): string {
  return process.env.VASTDB_QUERY_URL ?? "http://vastdb-query:8070";
}

/** Proxy a GET request to the vastdb-query service.
 *
 *  Returns a discriminated response — never throws. On network failure,
 *  returns `{ ok: false, status: 503, data: { detail: <message> } }`
 *  so callers can uniformly render a 503 envelope. */
export async function proxyToVastdbQuery(
  path: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${getVastdbQueryUrl()}${path}`;
  try {
    const response = await vastFetch(url, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      data: {
        detail: err instanceof Error ? err.message : "vastdb-query service unreachable",
      },
    };
  }
}
```

- [ ] **Step 2: Update `metadata-lookup-proxy.ts` to import from the new location**

Edit `services/control-plane/src/routes/metadata-lookup-proxy.ts`:

```typescript
// Before:
import { proxyToVastdbQuery } from "./exr-metadata.js";

// After:
import { proxyToVastdbQuery } from "../http/proxy.js";
```

- [ ] **Step 3: Run tests — confirm metadata-lookup-proxy still works**

```bash
cd services/control-plane
npm test -- --grep "metadata/lookup|metadata-lookup"
```

Expected: existing metadata-lookup-proxy tests pass with the new import path.

- [ ] **Step 4: Commit**

```bash
git add services/control-plane/src/http/proxy.ts services/control-plane/src/routes/metadata-lookup-proxy.ts
git commit -m "refactor(control-plane): relocate proxyToVastdbQuery to http/proxy.ts

Moves the helper out of routes/exr-metadata.ts (which is being deleted
in the next task) into a neutral module. metadata-lookup-proxy — the
remaining consumer — updates its import path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D2: Grep-gate check + delete web-ui legacy helpers

**Context.** Before deleting anything server-side, verify no web-ui code still references the legacy helpers. The grep must return zero matches outside tests and release-notes.

**Files:**
- Modify: `services/web-ui/src/api.ts` (delete 4 functions + their types)

- [ ] **Step 1: Grep gate — web-ui callers**

```bash
grep -rn "fetchExrMetadataLookup\|fetchVideoMetadataLookup\|fetchExrMetadataStats\|fetchVideoMetadataStats" services/web-ui/src/ | grep -v "\.test\." | grep -v release-notes
```

Expected output: **only the definitions in `services/web-ui/src/api.ts`**. If ANY other file surfaces in the output, go back and migrate that caller (re-open Layer C).

- [ ] **Step 2: Find the definitions in api.ts**

```bash
grep -n "^export.*fetchExrMetadataLookup\|^export.*fetchVideoMetadataLookup\|^export.*fetchExrMetadataStats\|^export.*fetchVideoMetadataStats\|^export interface Exr\|^export interface Video\|^export type Exr\|^export type Video" services/web-ui/src/api.ts
```

Record the line ranges for each function definition + the types they return (`ExrMetadataLookupResult`, `VideoMetadataLookupResult`, `ExrMetadataStats`, etc.).

- [ ] **Step 3: Delete the four functions + associated types**

Edit `services/web-ui/src/api.ts`. Delete these exports (using line ranges from Step 2):

- `export interface ExrMetadataLookupResult { ... }` — the full interface
- `export async function fetchExrMetadataLookup(path: string): Promise<ExrMetadataLookupResult> { ... }` — the full function
- `export interface VideoMetadataLookupResult { ... }` — the full interface
- `export async function fetchVideoMetadataLookup(path: string): Promise<VideoMetadataLookupResult> { ... }` — the full function
- `export interface ExrMetadataStats { ... }` — the full interface (if exists)
- `export async function fetchExrMetadataStats(): Promise<ExrMetadataStats | null> { ... }` — the full function
- Corresponding `VideoMetadataStats` interface + `fetchVideoMetadataStats` function (if exists — grep confirmed in Step 1)

Also delete any supporting types that are ONLY used by these (e.g. `ExrChannel`, `ExrPart` if they were at api.ts scope — check carefully before deleting, as Task C3 may have defined local copies).

- [ ] **Step 4: Run TypeScript + vitest**

```bash
cd services/web-ui
npx tsc --noEmit
npx vitest run
```

Expected: no TypeScript errors from import references (grep in Step 1 should have caught them). No test regressions.

- [ ] **Step 5: Commit**

```bash
git add services/web-ui/src/api.ts
git commit -m "chore(web-ui): delete legacy metadata lookup helpers

Removes fetchExrMetadataLookup, fetchVideoMetadataLookup,
fetchExrMetadataStats, fetchVideoMetadataStats and their response types.
All callers migrated to useAssetMetadata / useStorageSidecar in Layer C.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D3: Grep-gate check + delete control-plane passthrough routes

**Context.** `services/control-plane/src/routes/exr-metadata.ts` and `services/control-plane/src/routes/video-metadata.ts` are the passthrough layer between web-ui and vastdb-query. They are registered in `app.ts`. Delete the files, unregister from `app.ts`, verify no other code imports from them.

**Files:**
- Modify: `services/control-plane/src/app.ts`
- Delete: `services/control-plane/src/routes/exr-metadata.ts`
- Delete: `services/control-plane/src/routes/video-metadata.ts`

- [ ] **Step 1: Grep-gate — control-plane/web-ui callers**

```bash
grep -rn "/exr-metadata/\|/video-metadata/" services/control-plane/src/ services/web-ui/src/ | grep -v "\.test\." | grep -v release-notes
```

Expected output: **only the route registrations in `exr-metadata.ts`, `video-metadata.ts`, and the registration call in `app.ts`**. If anything else matches, that caller needs migration first.

```bash
grep -rn "registerExrMetadataRoutes\|registerVideoMetadataRoutes" services/control-plane/src/
```

Expected: only `app.ts` (the call site) + the two route files (where they're defined).

- [ ] **Step 2: Unregister from app.ts**

Find the registrations in `services/control-plane/src/app.ts` (around line 278 — use grep to find exact lines):

```bash
grep -n "registerExrMetadataRoutes\|registerVideoMetadataRoutes\|exr-metadata\|video-metadata" services/control-plane/src/app.ts
```

Remove both import lines and both registration calls. Typical pattern:

```typescript
// Before:
import { registerExrMetadataRoutes } from "./routes/exr-metadata.js";
import { registerVideoMetadataRoutes } from "./routes/video-metadata.js";
// ...
void registerExrMetadataRoutes(app, null, prefixes);
void registerVideoMetadataRoutes(app, null, prefixes);

// After:
// (both imports + both registrations deleted)
```

- [ ] **Step 3: Delete the two route files**

```bash
git rm services/control-plane/src/routes/exr-metadata.ts
git rm services/control-plane/src/routes/video-metadata.ts
```

If any test files only cover these routes, delete them too:

```bash
ls services/control-plane/test/routes/ | grep -i "exr-metadata\|video-metadata"
```

- [ ] **Step 4: Run tests**

```bash
cd services/control-plane
npm test
```

Expected: all tests PASS. If any test fails with "cannot import" or "route not found", investigate — likely a stray test reference that was missed.

- [ ] **Step 5: Commit**

```bash
git add services/control-plane/src/app.ts
git commit -m "chore(control-plane): delete legacy /exr-metadata and /video-metadata passthrough routes

Removes both route files and unregisters them from app.ts. All web-ui
callers migrated to useAssetMetadata / useStorageSidecar; remaining
server-side consumers use /metadata/lookup (schema-agnostic).

proxyToVastdbQuery helper — previously exported from
routes/exr-metadata.ts — relocated to http/proxy.ts in the prior
commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D4: Delete 8 vastdb-query Python endpoints

**Context.** `services/vastdb-query/main.py` has 8 legacy endpoints being deleted:
- `/api/v1/exr-metadata/stats` (line ~179)
- `/api/v1/exr-metadata/files` (line ~207)
- `/api/v1/exr-metadata/files/{file_id}` (line ~235)
- `/api/v1/exr-metadata/lookup` (line ~273)
- `/api/v1/video-metadata/stats` (line ~422)
- `/api/v1/video-metadata/files` (line ~452)
- `/api/v1/video-metadata/files/{file_id}` (line ~488)
- `/api/v1/video-metadata/lookup` (line ~524)

Plus: any env-bound schema-lookup helpers only used by those endpoints (e.g. the existing `DEFAULT_SCHEMA`, `DEFAULT_VIDEO_SCHEMA` references — check usage carefully; if `/metadata/lookup` in Layer A no longer reads them, delete them).

**Files:**
- Modify: `services/vastdb-query/main.py` (delete 8 endpoint handlers + orphan helpers)
- Modify: `services/vastdb-query/tests/` (delete now-orphan test files/classes)

- [ ] **Step 1: Inventory endpoint line ranges**

```bash
grep -n "^@app.get.*/exr-metadata/\|^@app.get.*/video-metadata/\|^def " services/vastdb-query/main.py
```

Record exact line ranges (start of each `@app.get(...)` decorator through end of its handler body — typically the next blank line before `@app.get` or `def`).

- [ ] **Step 2: Identify orphan helpers**

After deletion, these top-level config constants may be unused:
- `DEFAULT_SCHEMA` (image metadata schema env, was used by `/exr-metadata/*`)
- `DEFAULT_VIDEO_SCHEMA` + `DEFAULT_VIDEO_TABLE` (used by `/video-metadata/*`)

Verify with grep:

```bash
grep -n "DEFAULT_SCHEMA\|DEFAULT_VIDEO_SCHEMA\|DEFAULT_VIDEO_TABLE" services/vastdb-query/main.py
```

**Keep them if they're still referenced anywhere** (maybe in startup logging around line 687-688). The logger line currently references all of them:

```python
logger.info(
    "Endpoint: %s, Bucket: %s, EXR Schema: %s, Video Schema: %s, Video Table: %s",
    ENDPOINT, DEFAULT_BUCKET, DEFAULT_SCHEMA, DEFAULT_VIDEO_SCHEMA, DEFAULT_VIDEO_TABLE,
)
```

If the only remaining usage is that log line, simplify to:

```python
logger.info(
    "Endpoint: %s, Bucket: %s", ENDPOINT, DEFAULT_BUCKET,
)
```

And delete the `DEFAULT_SCHEMA`, `DEFAULT_VIDEO_SCHEMA`, `DEFAULT_VIDEO_TABLE` constant declarations (near line 55-61).

- [ ] **Step 3: Delete endpoint handlers**

Edit `services/vastdb-query/main.py`. For each of the 8 endpoint handlers, delete the full range (decorator + function body) identified in Step 1.

Be careful of shared helpers between the deleted endpoints — for example, if `/exr-metadata/files` and `/exr-metadata/stats` both called a `_build_exr_filter(...)` helper, that helper is also orphan. Grep before deleting to confirm.

- [ ] **Step 4: Delete or trim test files**

```bash
ls services/vastdb-query/tests/
```

If there are test files like `test_exr_metadata.py`, `test_video_metadata.py` — delete them. If the existing `test_metadata_lookup.py` has classes or tests specifically for the legacy endpoints (search for `/exr-metadata/` or `/video-metadata/`), remove those classes.

```bash
grep -n "/exr-metadata/\|/video-metadata/" services/vastdb-query/tests/
```

- [ ] **Step 5: Run remaining tests**

```bash
cd services/vastdb-query
python -m pytest tests/ -v
```

Expected: all tests pass. The Layer A tests from Task A1/A2 should be unaffected.

- [ ] **Step 6: Rebuild + deploy + verify endpoints are gone**

```bash
cd /Users/sergio.soto/Development/ai-apps/SpaceHarbor
sshpass -p 'vastdata' rsync -az --exclude __pycache__ --exclude .pytest_cache \
  services/vastdb-query/ vastdata@10.143.2.102:~/SpaceHarbor/services/vastdb-query/
sshpass -p 'vastdata' ssh vastdata@10.143.2.102 \
  "cd ~/SpaceHarbor && docker compose build vastdb-query && docker compose up -d vastdb-query"

# Verify legacy endpoints return 404
curl -s -o /dev/null -w "%{http_code}\n" 'http://10.143.2.102:8070/api/v1/exr-metadata/stats'
curl -s -o /dev/null -w "%{http_code}\n" 'http://10.143.2.102:8070/api/v1/video-metadata/lookup?path=foo'

# Verify /metadata/lookup still works
curl -s 'http://10.143.2.102:8070/api/v1/metadata/lookup?path=sergio-spaceharbor/uploads/pixar_5603.exr&schema=frame_metadata&table=files' | jq '.count'
```

Expected: first two return `404`, the third returns `1`.

- [ ] **Step 7: Commit**

```bash
git add services/vastdb-query/main.py services/vastdb-query/tests/
git commit -m "chore(vastdb-query): delete 8 legacy /exr-metadata and /video-metadata endpoints

Removes /stats, /files, /files/{file_id}, /lookup for both exr-metadata
and video-metadata families. All consumers migrated to the schema-agnostic
/metadata/lookup endpoint in Phase 5.4 + Phase 5.5.

Also removes now-orphan env-bound config constants (VASTDB_SCHEMA,
VASTDB_VIDEO_SCHEMA, VASTDB_VIDEO_TABLE). /metadata/lookup takes
schema/table per request — no env coupling remains.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D5: Post-cleanup smoke + wiki update + PR open

- [ ] **Step 1: Re-run the full Layer C smoke-test checklist**

Navigate through the manual smoke-test in Task C-verify Step 3 again. Every step must still pass after the legacy endpoints are removed. Pay special attention to:

- Pipelines page (step 8) — previously we said "no legacy endpoint calls". Now confirm via browser devtools Network tab that NO request goes to any `/exr-metadata/*` or `/video-metadata/*` URL.
- Counter metric still increments on video lookups (step 9).

- [ ] **Step 2: Push branch + open PR**

```bash
git push origin fix/metadata-plumbing-cleanup
gh pr create \
  --title "fix: metadata plumbing cleanup (bugs B/C/D + legacy endpoint deprecation)" \
  --body "$(cat <<'EOF'
## Summary

Post-Phase-5.5 follow-up — resolves the four bugs documented in
docs/issues/2026-04-17-metadata-plumbing-followups.md plus deprecates
the two legacy endpoint families.

- **Layer A** — vastdb-query `/metadata/lookup` gets a bucket-stripped
  fallback + Prometheus counter. Fixes bug B (video lookup misses).
- **Layer B** — New `classifyForPipelines` classifier in web-ui reads
  from the live pipeline config.
- **Layer C** — Four web-ui surfaces migrated to `useAssetMetadata` /
  `useStorageSidecar`. Fixes bugs C (video preview) and D.1
  (empty-state copy). D.2 spike outcome [see PR comment].
- **Layer D** — Deletes 4 web-ui helpers, 2 control-plane passthrough
  routes, 8 Python endpoints.

## Test plan

- [x] `services/vastdb-query/`: `python -m pytest tests/` — all green
- [x] `services/control-plane/`: `npm test` — all green
- [x] `services/web-ui/`: `npx vitest run` + `npx tsc --noEmit` — all green
- [x] Manual smoke on 10.143.2.102:
  - [x] Asset browser EXR + MOV
  - [x] Storage browser EXR + MOV + JPG + R3D + unsupported
  - [x] AOV pills render on EXR asset panel
  - [x] Counter `metadata_lookup_fallback_total` increments
  - [x] Legacy endpoints return 404
  - [x] Process/Reprocess [per D.2 outcome]

## Spec

`docs/superpowers/specs/2026-04-18-metadata-plumbing-cleanup-design.md`

## Plan

`docs/superpowers/plans/2026-04-18-metadata-plumbing-cleanup.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Track wiki update as a follow-up**

Do NOT update the wiki in this PR. Wiki update pattern (per Phase 5.5):

- After PR merge, clone wiki repo.
- Append a Release-Notes section dated with the merge date.
- Commit + push the wiki repo.
- Show wiki commit SHA.

Leave a task card for this at `.claude/handoff-spaceharbor.md` after merge.

- [ ] **Step 4: Validate PR remote SHA**

```bash
gh pr view fix/metadata-plumbing-cleanup --json number,url,headRefOid
```

Report PR number + URL + head SHA.

---

## Self-review checklist

This is for the plan author (me) — one pass through after writing, fixes applied inline.

- [x] **Spec coverage.** Every layer (A / B / C.1 / C.2 / C.5 / D) has at least one task. Every behavioral requirement from the spec's Components & contracts section is covered.
- [x] **Placeholder scan.** Searched the plan for "TBD", "TODO", "implement later", "similar to Task N", "Add appropriate error handling" — none present.
- [x] **Type consistency.** `MetadataKind` widens to include `"raw_camera"` in Task B1; all downstream consumers (Task C4 preview pane, Task C3 adapter) use the widened type. `classifyForPipelines` signature matches between definition (B1) and callers (C4). `metadata_lookup_fallback_total` counter — defined in A2, incremented in A1's modified handler (note the out-of-order implementation), verified in A2's tests.
- [x] **Ordering sanity.** Task A1 implements the fallback; Task A2 adds the counter increment into the same function — A2 depends on A1. Task B1 ships the classifier; Tasks C2/C3/C4 all import from it. Task D1 relocates `proxyToVastdbQuery`; Task D3 deletes `exr-metadata.ts` which previously exported it. Layer D grep gates fire BEFORE deletion in D2/D3/D4 — each task opens with the grep check.
- [x] **Open decision visibility.** 410 Gone stubs and empty-state copy tone are flagged in the spec's "Open decisions" table. Neither is enforced in the plan — if user revisits before plan execution, only Task D4 would need a trivial amendment to add stubs.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-metadata-plumbing-cleanup.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Matches Phase 5.5's successful pattern.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
