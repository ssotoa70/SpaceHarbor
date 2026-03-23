# R4: File Ingest Architecture — VAST DataEngine ScannerFunction

## Decision record

**Date:** 2026-03-05
**Ticket:** SERGIO-140
**Status:** Approved

### What was considered

| Option | Approach | Verdict |
|---|---|---|
| **A — Custom watcher** | chokidar (Node) or watchdog (Python) process polling a directory tree | ❌ Rejected — requires keep-alive process, polling lag, infra to maintain |
| **B — VAST DataEngine function** | `ElementCreated` trigger invokes a serverless Python function per file | ✅ Chosen — real-time, no polling, VAST-native, zero idle cost |
| **C — VAST Catalog polling** | Periodic SQL query against the Catalog (updated every 15–60 min) | ⚠️ Fallback only — acceptable lag for batch workflows, not for real-time review |

**Option B is the target architecture.** Option C is the fallback if S3-native view configuration is not available.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Render Farm / Artist Workstation                                        │
│                                                                          │
│  $ aws s3 cp beauty.0001.exr                                            │
│      s3://spaceharbor-renders/projects/NOVA/SEQ_010/SH040/render/v001/  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  S3 PUT (via NFS-to-S3 gateway or direct S3)
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VAST Element Store (S3-native bucket view: spaceharbor-renders)         │
│  ElementCreated event emitted to VAST Event Broker                       │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  CloudEvent → Kafka topic
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VAST DataEngine Element Trigger                                          │
│  Type:    ElementCreated                                                  │
│  Prefix:  projects/                                                       │
│  Suffix:  .exr  (separate triggers per media type)                        │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  Invokes containerized function
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ScannerFunction  (Python3, Kubernetes pod)                               │
│                                                                           │
│  Input event payload:                                                     │
│    s3.object.key  = "projects/NOVA/SEQ_010/SH040/render/v001/f.exr"     │
│    s3.object.eTag = "5defbfc99..."   ← free MD5                          │
│    s3.object.size = 104857600                                             │
│    eventTime      = "2026-03-05T10:51:35Z"                               │
│    userIdentity   = "render@studio.com"                                   │
│                                                                           │
│  Steps:                                                                   │
│    1. parse_render_path(key)     → project/seq/shot/version codes        │
│    2. resolve_hierarchy(codes)   → UUIDs from VastDB                     │
│    3. auto_create_missing()      → idempotent sequence/shot creation     │
│    4. POST /assets/ingest        → control-plane with resolved IDs       │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  HTTP POST /assets/ingest
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SpaceHarbor Control-Plane  (Fastify)                                     │
│                                                                           │
│  → Asset record created in VastDB                                         │
│  → Version record linked to shot                                          │
│  → WorkflowJob created                                                    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  Kafka event / DataEngine pipeline
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ExrInspectorFunction  (existing DataEngine pipeline)                     │
│  → Reads EXR metadata (resolution, codec, frame range, handles, etc.)    │
│  → Writes VfxMetadata to VastDB                                           │
│  → Publishes completion event                                             │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VastEventSubscriber  (control-plane Kafka consumer)                      │
│  → Receives completion event                                              │
│  → Updates job status → "completed"                                       │
│  → Asset appears in ApprovalPanel                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Path convention

SpaceHarbor expects renders to follow this S3 object key structure:

```
projects/{PROJECT_CODE}/{SEQUENCE_CODE}/{SHOT_CODE}/render/{VERSION_LABEL}/{filename}
```

For episodic projects (with `Episode` entity):
```
projects/{PROJECT_CODE}/{EPISODE_CODE}/{SEQUENCE_CODE}/{SHOT_CODE}/render/{VERSION_LABEL}/{filename}
```

### Examples

| Object key | project | episode | sequence | shot | version |
|---|---|---|---|---|---|
| `projects/NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr` | NOVA | — | SEQ_010 | SH040 | v001 |
| `projects/NOVA/EP02/SEQ_010/SH040/render/v003/comp.####.exr` | NOVA | EP02 | SEQ_010 | SH040 | v003 |
| `projects/NOVA/SEQ_010/SH040/render/v002_colorfix/output.mov` | NOVA | — | SEQ_010 | SH040 | v002_colorfix |

### Rules

- `render/` segment is the sentinel — paths without it are ignored by the parser
- `{VERSION_LABEL}` must start with `v` followed by digits (e.g., `v001`, `v012_wip`)
- Non-render paths (dailies, plates, reference, etc.) are silently skipped
- Unsupported extensions are silently skipped (only `.exr`, `.mov`, `.dpx`, `.audio`, `.vdb`, `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc` trigger ingestion)

---

## VAST platform capabilities used

### DataEngine Element Trigger

| Property | Value |
|---|---|
| Trigger type | Element |
| Event type | `ElementCreated` |
| Source view | `spaceharbor-renders` (S3-native bucket) |
| Prefix filter | `projects/` |
| Suffix filter | `.exr` (one trigger per media type) |
| Function | `scanner-function:latest` |

**What VAST fires on:** Every S3 PUT to a matching key. Fires once per object, in real-time.

**What VAST does NOT do:** Parse path segments, resolve VFX hierarchy codes, or enforce naming conventions. All of that lives in `ScannerFunction`.

### Event payload (S3 format)

```python
{
  "Records": [{
    "eventName": "s3:ObjectCreated:Put",
    "eventTime": "2026-03-05T10:51:35.859365Z",
    "s3": {
      "bucket": { "name": "spaceharbor-renders" },
      "object": {
        "key":       "projects/NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr",
        "size":      104857600,
        "eTag":      "5defbfc99890b0538929cca518a1fe7f",  # ← free MD5
        "sequencer": "000300000000000f4241"
      }
    },
    "userIdentity": { "principalId": "render@studio.com" }
  }]
}
```

### VAST Catalog (fallback / auditing)

Updated every 15–60 minutes. Not used for real-time triggering. Useful for:
- "What files exist in VAST that we haven't ingested?" — reconciliation queries
- Backfill jobs when re-processing old renders
- Audit: "when was this file first written to VAST?"

```sql
-- Find all render files not yet in SpaceHarbor
SELECT c.name, c.parent_path, c.mtime, c.size
FROM vast."spaceharbor/production".catalog c
WHERE c.search_path = '/projects/'
  AND c.extension IN ('exr', 'mov', 'dpx')
  AND c.parent_path LIKE '%/render/%'
  AND NOT EXISTS (
    SELECT 1 FROM vast."spaceharbor/production".assets a
    WHERE a.source_uri LIKE '%' || c.name
  )
ORDER BY c.mtime DESC;
```

### Critical constraint: S3-native views only

DataEngine element triggers currently fire **only for S3 protocol views**. NFS writes to a non-S3-native view do not emit `ElementCreated` events.

**Resolution options:**

| Scenario | Solution |
|---|---|
| Render farm uses S3 directly | ✅ No changes needed |
| Render farm uses NFS, view is S3-native | ✅ NFS and S3 share the Element Store — events fire for NFS writes too when view is S3-native |
| NFS-only, view cannot be reconfigured | ⚠️ Use Catalog polling fallback (15-60 min lag) |

Set `SCANNER_MODE` env var to switch modes:
```
SCANNER_MODE=dataengine   # default — real-time ElementCreated trigger
SCANNER_MODE=catalog      # fallback — Catalog polling every N minutes
```

---

## ScannerFunction code structure

```
services/scanner-function/
  function.py              ← DataEngine entry point: handler(event, context)
  path_parser.py           ← parse_render_path(key) → dict | None
  hierarchy_resolver.py    ← resolve_hierarchy(parsed, trino) → UUIDs
  trino_client.py          ← thin Trino REST client
  ingest_client.py         ← HTTP POST to control-plane /assets/ingest
  Dockerfile
  requirements.txt
  trigger-config.md        ← DataEngine trigger settings reference
  tests/
    test_path_parser.py
    test_hierarchy_resolver.py
    test_function.py
```

### Path parser regex

```python
RENDER_PATTERN = re.compile(
    r"^projects/"
    r"(?P<project>[^/]+)/"
    r"(?:(?P<episode>EP\w+)/)?"   # optional — episodic projects
    r"(?P<sequence>[^/]+)/"
    r"(?P<shot>[^/]+)/"
    r"render/"
    r"(?P<version>v\d+[^/]*)/"
    r"(?P<filename>[^/]+)$"
)
```

### Hierarchy resolution rules

| Code found in path | VastDB action |
|---|---|
| `project_code` not in VastDB | Raise `HierarchyNotFoundError` — do NOT auto-create projects |
| `sequence_code` not in VastDB | Auto-create `Sequence` row linked to resolved project |
| `shot_code` not in VastDB | Auto-create `Shot` row linked to resolved sequence |
| `version_label` already exists for shot | Skip ingest (idempotent — same file, same version) |
| All found | Proceed to ingest |

Projects are not auto-created because they require human decisions (project type, frame rate, color space, delivery specs). A render arriving for an unknown project code is an ops error, not a scanner error.

---

## Control-plane ingest route changes

`POST /assets/ingest` extended body (all new fields optional — backward compatible):

```typescript
{
  title:         string,           // filename
  sourceUri:     string,           // s3:// path
  annotationHook?: ...,            // existing
  // New optional fields (provided by ScannerFunction):
  shotId?:       string,           // UUID — links asset to shot
  projectId?:    string,           // UUID — denormalized for fast queries
  versionLabel?: string,           // "v001", "v002_colorfix"
  fileSizeBytes?: number,          // from S3 event size
  md5Checksum?:  string,           // from S3 event eTag (free MD5)
  createdBy?:    string,           // from S3 event userIdentity
}
```

When `shotId` is present:
1. `createVersion` is called on the adapter, linking asset to shot
2. `shots.latest_version_id` is updated
3. Version appears in `listVersionsByShot` immediately

When `shotId` is absent: existing behavior unchanged (manual ingest, no hierarchy link).

---

## Idempotency

The same file can trigger multiple `ElementCreated` events (S3 multipart upload, retry, etc.). The ScannerFunction must be idempotent:

```python
# Before calling ingest, check if version already exists
existing = trino.query(
    "SELECT id FROM versions WHERE shot_id = ? AND version_label = ?",
    [shot_id, version_label]
)
if existing:
    logger.info(f"Version already exists, skipping: {version_label}")
    return {"status": "skipped", "reason": "already_ingested"}
```

---

## "Is the render complete?" problem

A render job writes frames one at a time:
```
beauty.0001.exr  → ElementCreated
beauty.0002.exr  → ElementCreated
...
beauty.0100.exr  → ElementCreated
```

Each file triggers a separate function invocation. Ingesting on the first frame is wrong — the sequence is incomplete.

**Chosen approach: sentinel file.**

Render pipelines write a `.ready` file when the sequence is complete:
```
projects/NOVA/SEQ_010/SH040/render/v001/.ready
```

Configure the element trigger with suffix `.ready` only. The function:
1. Receives the `.ready` event
2. Parses the directory path (strips `.ready` filename)
3. Queries the Catalog: `SELECT count(*) WHERE parent_path = .../render/v001/` to get frame count
4. Proceeds with ingest

If the render pipeline cannot write a `.ready` file: use a frame count threshold (ingest when `count(files) >= expected_frame_count` from shot metadata).

---

## Error handling and DLQ

| Error | Action |
|---|---|
| `HierarchyNotFoundError` (unknown project) | Raise — DataEngine routes to DLQ after max retries |
| VastDB connection failure | Raise — DataEngine retries with backoff |
| Control-plane ingest HTTP error (5xx) | Raise — DataEngine retries |
| Control-plane ingest HTTP error (4xx) | Log + return `{"status": "error"}` — do not retry |
| Non-render path | Return `{"status": "skipped"}` — not an error |
| Already ingested (idempotent) | Return `{"status": "skipped"}` — not an error |

DLQ items (repeated failures) should be routed to the existing SpaceHarbor DLQ table in VastDB and surface in the admin UI (existing DLQ route at `GET /queue/dlq`).

---

## Fallback: VAST Catalog polling (NFS-only environments)

When `SCANNER_MODE=catalog`, a scheduled DataEngine function (not an element trigger) runs every N minutes:

```python
# Scheduled function — runs every 15 min
def poll_catalog(event, context):
    cutoff = datetime.utcnow() - timedelta(minutes=POLL_INTERVAL_MINUTES)
    new_files = trino.query("""
        SELECT name, parent_path, size, mtime
        FROM vast."spaceharbor/production".catalog
        WHERE search_path = '/projects/'
          AND extension IN ('exr', 'mov', 'dpx')
          AND parent_path LIKE '%/render/%'
          AND mtime > ?
          AND NOT EXISTS (
              SELECT 1 FROM vast."spaceharbor/production".assets
              WHERE source_uri LIKE '%' || name
          )
        ORDER BY mtime ASC
    """, [cutoff.isoformat()])

    for f in new_files:
        key = f["parent_path"].lstrip("/") + "/" + f["name"]
        handle_new_file(key, f)
```

Lag: 15–60 minutes. Suitable for overnight render review workflows; not suitable for real-time dailies review.

---

## Extending the scanner for new file types

To add support for a new media type (e.g., `.vdb` for VDB volumes):

1. Add the extension to `SUPPORTED_EXTENSIONS` in `path_parser.py`
2. Add a new DataEngine trigger with `suffix: .vdb` (or add to existing `.ready` sentinel approach)
3. Add a unit test in `test_path_parser.py`
4. No other changes needed — the rest of the pipeline is extension-agnostic

To add support for a new path convention (e.g., plates stored differently):

1. Add a new regex pattern in `path_parser.py` (e.g., `PLATE_PATTERN`)
2. Update `parse_render_path` to try multiple patterns
3. Add unit tests

---

## Relationship to existing DataEngine functions

| Function | Trigger | Purpose |
|---|---|---|
| `ScannerFunction` (new) | `ElementCreated` on render files | Detect new renders → create asset/version in SpaceHarbor |
| `ExrInspectorFunction` (existing) | Called by control-plane DataEngine pipeline | Extract VFX metadata from EXR file |
| Scheduled polling (fallback) | Scheduled trigger (every N min) | Catalog-based fallback for NFS-only environments |

`ScannerFunction` runs **before** `ExrInspectorFunction`. It creates the asset record. `ExrInspectorFunction` then enriches it with metadata.

---

## Ops runbook: deploying the trigger

```bash
# 1. Build and push the container image
cd services/scanner-function
docker build -t ghcr.io/dev-ss/spaceharbor/scanner-function:latest .
docker push ghcr.io/dev-ss/spaceharbor/scanner-function:latest

# 2. Register the function in VAST DataEngine (via VAST CLI or UI)
vast dataengine function create \
  --name scanner-function \
  --image ghcr.io/dev-ss/spaceharbor/scanner-function:latest \
  --env VAST_TRINO_ENDPOINT=$VAST_TRINO_ENDPOINT \
  --env SPACEHARBOR_CONTROL_PLANE_URL=$SPACEHARBOR_CONTROL_PLANE_URL

# 3. Create element trigger (one per media type)
vast dataengine trigger create \
  --name scanner-exr \
  --type element \
  --event ElementCreated \
  --source-view spaceharbor-renders \
  --prefix "projects/" \
  --suffix ".ready" \
  --function scanner-function

# 4. Verify (write a test file and check logs)
echo "" | aws s3 cp - s3://spaceharbor-renders/projects/TEST/SEQ_001/SH001/render/v001/.ready
vast dataengine logs scanner-function --tail 50
```

---

## Questions requiring ops decisions (before implementation starts)

| Question | Impact |
|---|---|
| Is the render bucket an S3-native view? | Determines if DataEngine triggers fire for NFS writes |
| What is the render path convention used by the farm? | Determines regex pattern in path_parser.py |
| Does the render farm write a `.ready` sentinel? | Determines frame-completion detection approach |
| What container registry is available? | Required for DataEngine function deployment |
| What Kubernetes cluster runs DataEngine functions? | Required for resource allocation |
