# Metadata plumbing follow-ups (post-Phase 5.5 smoke-test)

**Date:** 2026-04-17
**Context:** During Phase 5.5 (Metadata Pipelines admin UI) smoke-test on `10.143.2.102`, four distinct bugs surfaced across asset-detail, asset-browser, and storage-browser surfaces. All are pre-Phase-5.5 plumbing issues that Phase 5.5 has made more visible by exposing the routing config. Bug **A** is being fixed in the Phase 5.5 branch (clear regression with a localized fix). Bugs **B / C / D** are tracked here for a follow-up cycle.

## B. Video C-1b lookup misses the DB row

**Surface:** asset-browser side panel (MetadataTab). Status pill reads `DB · empty` for a video that has a known row in `video_metadata.files`.

**Root cause.** The two metadata extractors store rows with inconsistent path keys:

| Extractor | Key used | Example |
|---|---|---|
| `frame-metadata-extractor` (EXR, etc.) | `file_path` with bucket prefix | `sergio-spaceharbor/uploads/XYZ.exr` |
| `video-metadata-extractor` (video) | `s3_key` without bucket prefix | `uploads/lola-vfx-480-v2.mov` |

Our C-1b `/assets/:id/metadata` route uniformly sends the bucket-prefixed form (per commit `a4e5790 "fix(metadata): preserve bucket in the match path"`). That matched EXR but breaks video.

**Proof from live host.**
- `GET /api/v1/metadata/lookup?path=sergio-spaceharbor/uploads/lola-vfx-480-v2.mov&schema=video_metadata&table=files` → `count=0, matched_by=s3_key`.
- `GET /api/v1/metadata/lookup?path=uploads/lola-vfx-480-v2.mov&schema=video_metadata&table=files` → `count=1, matched_by=s3_key`.

**Fix shape (two options, pick one with design input).**
1. **Fallback in vastdb-query.** On primary miss, auto-retry with `path.split('/', 1)[1]` (bucket stripped) against `s3_key`. Pros: one place, covers every caller. Cons: masks the underlying inconsistency; future extractors could drift further.
2. **Align the extractors** to store a consistent key (the project-wide convention should be `bucket/key` per the frame-metadata-extractor). Requires touching `services/dataengine-functions/`, which is owned by another agent and off-limits to the main repo's agents per `feedback_dataengine_functions_deprecated.md`. Needs coordination.

**Recommendation:** option 1 as an operational backstop; option 2 as the long-term correctness fix once extractor ownership permits.

**Est. effort:** option 1 — ~2h including tests in `services/vastdb-query/`.

## C. Storage Browser video preview broken

**Surface:** `/library/storage` → select a `.mov` → side panel. Filename renders inside a broken-image placeholder instead of playing the proxy.

**Observation.** Metadata renders fully (52 attributes correctly shown), so the issue is isolated to the preview/player component. Likely an `<img>` tag being used where a `<video>` tag is required, or a proxy URL that isn't resolving for the selected format.

**Fix shape.** Locate the storage-browser side-panel preview component in `services/web-ui/src/pages/` (likely `StorageBrowserPage.tsx` or a nested preview component). Branch on `fileKind`:
- `image` → `<img src={presignedUrl} />`
- `video` → `<video src={proxyUrl} controls />`
- fall back to a format-neutral "No preview available" panel.

Probably reuses `fetchMediaUrls` or `fetchPresignedUrl` from `api.ts`. Requires a quick component inspection.

**Est. effort:** ~1–2h depending on how the preview component is structured.

## D. Storage Browser metadata panel is EXR-only + process/reprocess actions dead

**Surface:** Same `/library/storage` side panel. Selecting a JPG shows "No EXR metadata available for this file." The `.jpg` extension is not in the frame-metadata-extractor's configured extensions (`.exr, .dpx, .cin, .tif, .tiff, .png, .tga, .hdr, .rgbe, .jp2, .j2c, .j2k`) — so any lookup is expected to miss. The problem is the error copy is EXR-branded AND (per user report) the Process / Reprocess buttons don't trigger the pipeline.

**Fix shape:**
1. Route the storage-browser metadata query through the same `dataEnginePipelines` config the rest of the app now uses. Match on extension → find the pipeline → query `schema.table`. If no pipeline matches the extension, show "No pipeline configured for `.jpg`" with a CTA linking to `/automation/pipelines`.
2. Separately investigate Process / Reprocess button wiring — the triggered-state UI (`Triggered` pill) shows for at least `pixar.mp4`, so the action fires for some files but not others. Likely a routing / permission / extension-matching bug on the action-side.

**Est. effort:** ~3–4h combined. Best split into two sub-tasks.

## Also worth doing at the same time

Handoff open task #3 already called this out: deprecate the legacy `/exr-metadata/*` and `/video-metadata/*` endpoints on `vastdb-query` now that `/metadata/lookup` covers the same ground via runtime schema routing. Bug A's fix (C-1b migration of the asset-detail page) will remove one of the last callers of `/exr-metadata/*`. Audit remaining callers and delete the endpoints.

## Proposed next-cycle approach

Open a new branch `fix/metadata-plumbing-cleanup` (post-Phase-5.5 merge). Brainstorm the bundle — these four are coherent as a single "finish the metadata story" cycle, not as four isolated fixes. Likely one spec + one plan covering B, C, D plus the legacy-endpoint cleanup.
