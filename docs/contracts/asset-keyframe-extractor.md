# Data Contract — `asset-keyframe-extractor`

**Status:** Authored by SpaceHarbor (Phase 6.0). Implementation lives in the external DataEngine functions team's repository on their schedule.

**Purpose:** Extract `N` keyframes from a video/raw-camera asset, write JPEGs under the media bucket, and record metadata to `asset_integrity.keyframes`.

## Trigger

Kafka topic: `spaceharbor.assets.ingested` (same topic as `asset-hash-generator`). The function MUST filter input internally to `fileKind ∈ {"video", "raw_camera"}`; image and other kinds are skipped without writing a row.

## Input envelope

Same shape as `asset-hash-generator` — see `docs/contracts/asset-hash-generator.md`.

## Output — object side-effect

Up to `keyframe_count` JPEG frames written to the media bucket under:

```
<bucket>/.proxies/<asset_id>/keyframes/0000.jpg
<bucket>/.proxies/<asset_id>/keyframes/0001.jpg
…
```

Names are deterministic (zero-padded 4-digit index) so re-running overwrites existing frames without leaving orphans.

## Output table

Schema/table: `asset_integrity.keyframes` (VAST DB, inside `vast."spaceharbor/production"`).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `asset_id` | VARCHAR(128) | no | Primary identifier; upsert key |
| `source_uri` | VARCHAR(2048) | no | `s3://…` URI of the source video |
| `keyframe_count` | INTEGER | no | Number of frames actually written |
| `keyframe_prefix` | VARCHAR(2048) | no | e.g. `"<bucket>/.proxies/<asset_id>/keyframes/"` |
| `thumbnail_key` | VARCHAR(2048) | no | S3 key of the frame chosen for grid display |
| `extracted_at` | TIMESTAMP(6) | no | UTC instant of extraction |
| `extraction_duration_ms` | BIGINT | no | Wall-clock milliseconds consumed |

Sort keys: `['asset_id']`.

## Idempotency

Upsert keyed by `asset_id`. Re-running overwrites JPEGs under the same deterministic names; table row reflects the most recent run.

## Failure reporting

The function MUST NOT write a partial row. If one keyframe JPEG upload fails the function either writes all JPEGs + the row, or writes nothing.

## Tunable knobs

Read from `function_configs` scope `asset-integrity`:

- `keyframe_count` (int, default 10, min 1, max 30)
- `keyframe_extraction_timeout_seconds` (duration_seconds, default 180, min 30, max 900)
- `keyframe_extraction_enabled` (bool, default true)

## Non-requirements

- No transcript, no OCR, no subclip extraction.
- No destructive writes outside the owned `<bucket>/.proxies/<asset_id>/keyframes/` prefix.

## Ownership note

This contract is authored by SpaceHarbor. The function implementation lives in the DataEngine functions team's repository. This contract depends only on infrastructure SpaceHarbor runs directly (VAST DB, Event Broker, media buckets). No assumption is made about any other project's schemas, tables, buckets, functions, or runtime endpoints.
