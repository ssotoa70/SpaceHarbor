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

The function is a **thin forwarder** as of Phase 6 — it no longer talks to
VAST DB, parses paths, or knows the asset model. All it does is HMAC-sign
the S3 event and POST it to the control-plane. The control-plane handles
parsing, hierarchy resolution, and ingest in TypeScript.

| Variable | Required | Description |
|---|---|---|
| `SPACEHARBOR_CONTROL_PLANE_URL` | yes | Control-plane base URL, e.g. `http://control-plane.spaceharbor.svc:8080`. The forwarder POSTs to `{base}/api/v1/scanner/ingest`. |
| `SPACEHARBOR_SCANNER_SECRET`    | yes | Shared HMAC secret. Must match the same env var on the control-plane. Generate with `openssl rand -hex 32`. |
| `SCANNER_HTTP_TIMEOUT_S`        | no  | Request timeout in seconds (default `10`). |

The legacy `VAST_DATABASE_URL`, `VAST_TRINO_ENDPOINT`, and
`SPACEHARBOR_API_KEY` env vars are no longer read — the control-plane
holds all DB credentials, and the HMAC signature is the only auth.

## SCANNER_MODE Fallback (NFS environments)

If the render view cannot be configured as S3-native, set:

```
SCANNER_MODE=catalog   (fallback — 15-min VAST Catalog polling)
```

Default is `SCANNER_MODE=dataengine` (real-time ElementCreated trigger).
The Catalog polling fallback is documented in `docs/r4-file-scanner-architecture.md`.
