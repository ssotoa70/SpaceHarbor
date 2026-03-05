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
| Source view | `assetharbor-renders` (S3-native bucket view) |
| Prefix filter | `projects/` |
| Function | `scanner-function:latest` |

## One Trigger Per Supported Extension (Recommended)

Create one trigger per file type for observability and independent filtering:

| Trigger name | Suffix filter |
|---|---|
| `scanner-exr` | `.exr` |
| `scanner-mov` | `.mov` |
| `scanner-dpx` | `.dpx` |
| `scanner-audio` | `.audio` |

Alternatively, create a single trigger with no suffix filter and let
`parse_render_path()` filter unsupported extensions internally.

## Function Environment Variables

| Variable | Description |
|---|---|
| `VAST_TRINO_ENDPOINT` | Trino REST API endpoint (e.g. `http://trino.vast.svc:8080`) |
| `ASSETHARBOR_CONTROL_PLANE_URL` | Control-plane base URL (e.g. `http://control-plane:3000`) |
| `ASSETHARBOR_API_KEY` | Optional API key for authenticated ingest endpoint |

## SCANNER_MODE Fallback (NFS environments)

If the render view cannot be configured as S3-native, set:

```
SCANNER_MODE=catalog   (fallback — 15-min VAST Catalog polling)
```

Default is `SCANNER_MODE=dataengine` (real-time ElementCreated trigger).
The Catalog polling fallback is documented in `docs/r4-file-scanner-architecture.md`.
