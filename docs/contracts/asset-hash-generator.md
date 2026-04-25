# Data Contract — `asset-hash-generator`

**Status:** Authored by SpaceHarbor (Phase 6.0). Implementation lives in the external DataEngine functions team's repository on their schedule.

**Purpose:** Compute content + perceptual hashes for an ingested asset and write them to `asset_integrity.hashes`.

## Trigger

Kafka topic: `spaceharbor.assets.ingested`, published by `services/control-plane/src/routes/scanner-ingest.ts` when a new asset lands in a watched bucket. The function is an additional consumer of this existing topic; no new topic is added for Phase 6.0.

## Input envelope

```json
{
  "assetId": "abc123",
  "sourceUri": "s3://<bucket>/<key>",
  "bucket": "<bucket>",
  "key": "<key>",
  "sizeBytes": 24567890,
  "mime": "image/x-exr",
  "fileKind": "image",
  "ingestedAt": "2026-04-19T12:00:00Z"
}
```

## Output table

Schema/table: `asset_integrity.hashes` (VAST DB, inside `vast."spaceharbor/production"`).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `asset_id` | VARCHAR(128) | no | Primary identifier; upsert key |
| `source_uri` | VARCHAR(2048) | no | `s3://…` URI of the hashed object |
| `sha256` | VARCHAR(64) | no | Hex-encoded SHA-256 of the object body |
| `perceptual_hash` | VARCHAR(255) | yes | pdqhash or equivalent; only populated for image/video kinds |
| `algorithm_version` | VARCHAR(64) | no | e.g. `"pdqhash-1.0"`, `"sha256-v1"` |
| `bytes_hashed` | BIGINT | no | Size of the object body in bytes |
| `hashed_at` | TIMESTAMP(6) | no | UTC instant of the hash computation |
| `hash_duration_ms` | BIGINT | no | Wall-clock milliseconds consumed |

Sort keys (for VAST DB): `['asset_id']`.

## Idempotency

Upsert keyed by `asset_id`. Re-running on the same asset produces the same row (SHA-256 is deterministic); `algorithm_version` and `hashed_at` reflect the most recent run. No history rows are written.

## Failure reporting

The function MUST NOT write a partial row. If SHA-256 computes successfully but perceptual hashing fails, the row is either written fully (with `perceptual_hash = null`) or not at all — never with a stale mix of fields.

On non-retryable failure the function writes a DLQ entry in the function team's own dead-letter topic; SpaceHarbor's control-plane surfaces `sources.hashes = "empty"` in `GET /assets/:id/integrity` for that asset.

## Tunable knobs

Read from `function_configs` scope `asset-integrity`:

- `hash_timeout_seconds` (duration_seconds, default 120, min 10, max 600)
- `hash_concurrency_max` (int, default 4, min 1, max 16)
- `perceptual_hash_enabled` (bool, default true)

## Non-requirements

- No cross-asset dedup. The function never reads another asset's row.
- No write to `relationships` or any table outside `asset_integrity.hashes`.
- No destructive writes (no DELETE on the target table).

## Ownership note

This contract is authored by SpaceHarbor. The function implementation lives in the DataEngine functions team's repository. This contract depends only on infrastructure SpaceHarbor runs directly (VAST DB, Event Broker, media buckets). No assumption is made about any other project's schemas, tables, buckets, functions, or runtime endpoints.
