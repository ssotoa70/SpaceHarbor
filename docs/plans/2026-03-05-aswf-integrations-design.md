# ASWF Integrations Design — AssetHarbor
**Date:** 2026-03-05
**Status:** Approved
**Scope:** 5 ASWF tools integrated into VAST-native MAM pipeline

---

## Overview

This document covers the design for integrating five ASWF tools into AssetHarbor's VAST-native architecture. The integration strategy is **Option C**: full integration for OIIO + OCIO (pure library calls, run inside VAST DataEngine functions), and scaffolded stubs with real contracts for OpenAssetIO, OTIO, and OpenRV (require DCC app presence to fully test).

---

## Service Structure

```
services/
  openassetio-manager/          ← NEW Python FastAPI service
    src/
      manager.py                ← OpenAssetIO Manager Plugin (resolve/browse/register)
      resolver.py               ← VastDB URI resolution via Trino REST API
      timeline.py               ← OTIO ingest + conform logic (Python OTIO library)
      main.py                   ← FastAPI app (uvicorn)
    tests/
    Dockerfile
  dataengine-functions/         ← NEW VAST DataEngine container functions
    oiio-proxy-generator/
      function.py               ← entrypoint (ElementCreated trigger)
      oiio_processor.py         ← OIIO thumbnail + H.264 proxy generation
      ocio_transform.py         ← OCIO LogC→sRGB / LogC→Rec.709 transform
      Dockerfile
  web-ui/src/components/
    ReviewButton.tsx             ← "Open in RV" rvlink:// URI launcher
  control-plane/src/
    routes/
      review.ts                 ← GET /assets/:id/review-uri
      timeline.ts               ← POST /timeline/ingest (stub + contracts)
    data-engine/functions/
      oiio-proxy.ts             ← OiioProxyFunction registration
```

---

## 1. OpenAssetIO — DCC ↔ MAM Bridge

**Integration depth:** Stub with real contracts
**Location:** `services/openassetio-manager/` (new Python FastAPI service)

### Role
Standardized asset resolution bridge between DCC applications (Maya, Nuke, Houdini) and AssetHarbor. Implements the OpenAssetIO Manager Plugin interface so DCC hosts can resolve, browse, and register assets without custom per-app integrations.

### Flow
```
DCC app (Maya/Nuke/Houdini) → OpenAssetIO host plugin
  → POST /resolve   → openassetio-manager FastAPI
  → queries VastDB via Trino REST for asset VAST view path
  → returns S3/NFS URI to DCC host
```

### API Contracts

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/resolve` | Given an entity reference, return VAST URI for that asset version |
| POST | `/register` | Register new asset from DCC export → calls control-plane POST /ingest |
| GET  | `/browse`  | List assets for a shot/project from VastDB |

### Control-Plane Integration
Existing `dcc.ts` stubs gain a `manager_uri` field in responses pointing to the openassetio-manager service. No breaking changes to existing DCC contracts.

### Dev Mode
Returns mock VAST URIs. No VastDB connection required.

---

## 2. OpenTimelineIO (OTIO) — Editorial Lineage

**Integration depth:** Stub with real contracts
**Location:** `services/openassetio-manager/src/timeline.py` + `control-plane/src/routes/timeline.ts`

### Role
Ingest editorial timelines (EDL, XML, OTIO format) and auto-conform the MAM — flagging asset versions as "in-cut" or "out-of-cut" based on the current edit.

### Flow
```
Editor uploads EDL/XML/OTIO → POST /api/v1/timeline/ingest
  → Control-plane stub receives file
  → Calls openassetio-manager POST /timeline/parse (Python OTIO library)
  → Returns shot list with version references
  → File stored in VAST timelines/ view
  → VAST ElementCreated event fires on new OTIO file
  → DataEngine conform function runs:
      - Reads OTIO from VAST
      - Queries VastDB for matching asset versions by shot/version_label
      - Sets asset.in_cut = true/false in VastDB
  → Publishes timeline.conformed CloudEvent to Event Broker
  → Control-plane VastEventSubscriber receives event
  → Updates asset metadata in VastDB
```

### New Events
- `timeline.ingested` — published when OTIO file lands in VAST view
- `timeline.conformed` — published after conform function updates in-cut status

### New Routes (control-plane stubs)
- `POST /api/v1/timeline/ingest` — accepts multipart file upload (EDL/XML/OTIO)
- `GET  /api/v1/timeline/:id` — get timeline conform status

---

## 3. OpenRV / xSTUDIO — Review & Playback

**Integration depth:** Stub with real contracts
**Location:** `services/web-ui/src/components/ReviewButton.tsx` + `control-plane/src/routes/review.ts`

### Role
"Open in RV" button in the Web UI launches the artist's locally-installed RV player pointed directly at the asset's VAST NFS/S3 path. Leverages VAST's all-flash throughput for uncompressed EXR sequence streaming.

### Flow
```
Artist clicks "Open in RV" on AssetRow or ApprovalPanel
  → Web UI calls GET /api/v1/assets/:id/review-uri
  → Control-plane queries VastDB for asset VAST NFS path
  → Returns { uri: "rvlink://path/to/exr_sequence/*.exr", format: "exr_sequence" }
  → Web UI opens rvlink:// URL in new window
  → RV catches it via OS-registered URI scheme handler
```

### Key Constraints
- No server-side RV binary needed — URI construction only
- `ReviewButton` renders conditionally: visible when `asset.proxy_uri` or `asset.source_uri` is set
- Dev mode returns mock `rvlink://` URI

### New Route (control-plane)
- `GET /api/v1/assets/:id/review-uri` → `{ uri: string, format: string, asset_id: string }`

---

## 4. OpenImageIO (OIIO) — Proxy Generation

**Integration depth:** Full integration
**Location:** `services/dataengine-functions/oiio-proxy-generator/`

### Role
Auto-generate JPEG thumbnails and H.264 proxies when EXR or DPX files land in a VAST view. Runs as a containerized VAST DataEngine function triggered by element events.

### Flow
```
Artist writes EXR sequence → VAST view (ingest/)
  → VAST ElementCreated fires on *.exr / *.dpx
  → VAST DataEngine runs oiio-proxy-generator container
  → ocio_transform.py applies OCIO color transform first (see §5)
  → oiio_processor.py calls oiiotool:
      - 256×256 JPEG thumbnail → VAST thumbnails/ view
      - 1920×1080 H.264 proxy → VAST proxies/ view
  → Publishes proxy.generated CloudEvent to Event Broker
  → Control-plane VastEventSubscriber receives event
  → Updates asset.thumbnail_uri + asset.proxy_uri in VastDB
```

### Control-Plane Registration
New `OiioProxyFunction` in `src/data-engine/functions/oiio-proxy.ts` registered at startup. Follows existing function registry pattern.

### Outputs Stored in VAST
| Output | Path | Format |
|--------|------|--------|
| Thumbnail | `thumbnails/{asset_id}.jpg` | JPEG 256×256 |
| Proxy | `proxies/{asset_id}_proxy.mp4` | H.264 1920×1080 |

---

## 5. OpenColorIO (OCIO) — Color Management

**Integration depth:** Full integration
**Location:** `services/dataengine-functions/oiio-proxy-generator/ocio_transform.py` (companion to OIIO)

### Role
Ensure thumbnails and proxies are correctly color-transformed before encoding. Prevents "dark log" plates from displaying incorrectly in the web UI or on review monitors.

### Flow
Runs as a pre-step inside the same DataEngine container as OIIO:
```
EXR input (LogC / ACEScg / linear)
  → ocio_transform.py reads OCIO_CONFIG_PATH env var
  → Applies ACES 1.3 config transform:
      - Source colorspace → sRGB   (for JPEG thumbnail web display)
      - Source colorspace → Rec.709 (for H.264 proxy review)
  → Color-correct pixel buffer passed to oiio_processor.py
  → oiio_processor.py encodes and writes outputs
```

### Configuration
- `OCIO_CONFIG_PATH` — path to OCIO config file on VAST view (default: ACES 1.3)
- Source colorspace detected from EXR metadata (`chromaticities`, `colorspace` attribute) or configurable per-ingest-pipeline

---

## VAST Event Flow — Combined View

```
Artist ingest (EXR) ─────────────────────────────────────────────────────────────────┐
                                                                                      ↓
                                                               VAST view: ingest/*.exr
                                                                    ↓ ElementCreated
                                                         VAST DataEngine:
                                                           1. OCIO color transform
                                                           2. OIIO thumbnail + proxy
                                                           3. Write to thumbnails/ + proxies/
                                                           4. Publish proxy.generated CloudEvent
                                                                    ↓ Kafka
                                                        Control-plane VastEventSubscriber
                                                           → Update VastDB asset record
                                                           → thumbnail_uri + proxy_uri set
                                                                    ↓
                                                         Web UI: ReviewButton visible
                                                                    ↓ click
                                                        GET /assets/:id/review-uri
                                                           → rvlink:// URI returned
                                                           → RV opens EXR sequence
Editor uploads OTIO ─────────────────────────────────────────────────────────────────┐
                                                                                      ↓
                                                        POST /api/v1/timeline/ingest
                                                           → openassetio-manager parses OTIO
                                                           → File stored in VAST timelines/
                                                                    ↓ ElementCreated
                                                         VAST DataEngine: conform function
                                                           → Sets asset.in_cut in VastDB
                                                           → Publishes timeline.conformed
DCC app (Maya/Nuke) ─────────────────────────────────────────────────────────────────┐
                                                                                      ↓
                                                        OpenAssetIO host plugin
                                                           → POST /resolve (openassetio-manager)
                                                           → VastDB query → VAST NFS/S3 URI
                                                           → URI returned to DCC
```

---

## Dependencies Between Integrations

| Integration | Depends On | Blocks |
|-------------|-----------|--------|
| OCIO | nothing | OIIO (must run first) |
| OIIO | OCIO | ReviewButton (needs proxy_uri) |
| OpenRV | OIIO (proxy_uri on asset) | nothing |
| OpenAssetIO | VastDB schema (asset URI fields) | OTIO (uses same resolver) |
| OTIO | OpenAssetIO (resolver.py shared) | nothing |

---

## Implementation Order (parallel tracks)

| Track | Integrations | Owner |
|-------|-------------|-------|
| **Track A** | OCIO + OIIO (DataEngine function) | Agent A |
| **Track B** | OpenAssetIO manager service | Agent B |
| **Track C** | OTIO (within openassetio-manager) | Agent C (after B scaffolds service) |
| **Track D** | OpenRV (Web UI + review route) | Agent D |
