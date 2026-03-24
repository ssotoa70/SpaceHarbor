# ScannerFunction — VAST DataEngine Trigger Configuration

## Overview

The ScannerFunction is registered as a VAST DataEngine serverless function.
It fires automatically on every `ElementCreated` event when a render file lands
in the designated S3-native VAST view.

## Prerequisites

> **Important:** DataEngine element triggers only fire on S3-protocol views (not NFS).
> Confirm the render output view is configured as S3-native before deployment.
>
> Environment check:
> - `VAST_RENDER_BUCKET` env var must exist and point to an S3-native bucket view
> - If NFS-only and cannot be changed, use Catalog polling fallback (see architecture doc)

## Trigger Settings

| Field | Value |
|---|---|
| Trigger type | Element |
| Event type | `ElementCreated` |
| Source view | `spaceharbor-renders` (S3-native bucket view) |
| Prefix filter | `projects/` |
| Function | `scanner-function:latest` |

## Recommended Trigger Configuration: Sentinel-Only

For render sequences (EXR, DPX), configure the trigger to fire **only on
`.ready` files** rather than on every individual frame file. Renderers write a
zero-byte `<shot>_<version>.ready` file after all frames are complete. The
ScannerFunction detects this sentinel and ingests the entire render directory
as a single asset.

**Why sentinel-only for frame sequences:**

- A sequence of 1 000 frames without sentinel handling → 1 000 separate asset
  ingest calls flooding the control-plane.
- With sentinel: 1 `.ready` file → 1 ingest call for the whole sequence.

### Trigger Table

| Trigger name | Suffix filter | Purpose |
|---|---|---|
| `scanner-ready` | `.ready` | Render sequence sentinel (EXR/DPX sequences) |
| `scanner-mov` | `.mov` | Single-file video outputs |
| `scanner-audio` | `.audio` | Audio renders |
| `scanner-wav` | `.wav` | WAV audio files |
| `scanner-usd` | `.usd` | USD scene files |
| `scanner-usda` | `.usda` | USD ASCII files |
| `scanner-usdc` | `.usdc` | USD crate files |
| `scanner-usdz` | `.usdz` | USD zip archives |
| `scanner-alembic` | `.abc` | Alembic geometry caches |

> **Note:** Do not add individual `.exr` or `.dpx` triggers when using sentinel
> mode. Renderers must write the `.ready` file after the last frame; this is the
> contract between the render pipeline and SpaceHarbor.

Alternatively, create a single trigger with no suffix filter and let
`parse_render_path()` filter unsupported extensions internally. In this case
both sentinel and individual-file paths are handled: sentinels aggregate into
one asset, and non-sentinel supported extensions are ingested per-file.

## Function Environment Variables

| Variable | Description |
|---|---|
| `VAST_TRINO_ENDPOINT` | (Deprecated) Use `VAST_DATABASE_URL` instead. Trino REST API endpoint |
| `VAST_DATABASE_URL` | VAST Database SQL endpoint (e.g. `http://vast-db.svc:8080`) |
| `SPACEHARBOR_CONTROL_PLANE_URL` | Control-plane base URL (e.g. `http://control-plane:3000`) |
| `SPACEHARBOR_API_KEY` | Optional API key for authenticated ingest endpoint |

## SCANNER_MODE Fallback (NFS environments)

If the render view cannot be configured as S3-native, set:

```
SCANNER_MODE=catalog   (fallback — 15-min VAST Catalog polling)
```

Default is `SCANNER_MODE=dataengine` (real-time ElementCreated trigger).
The Catalog polling fallback is documented in `docs/r4-file-scanner-architecture.md`.
