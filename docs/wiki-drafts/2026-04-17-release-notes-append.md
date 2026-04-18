# Wiki Release Notes — append this section

Paste this block into the **Release-Notes** wiki page, at the top of the current in-development version (or under a new heading if that version has already shipped).

---

## Phase 5.5 — Metadata Pipelines admin page

_Shipped 2026-04-18 on `main` via [PR #13](https://github.com/ssotoa70/SpaceHarbor/pull/13) (merge commit `1e236a6`)._

Operators can now view and edit the `dataEnginePipelines` platform setting directly from the UI: **Automation → Metadata Pipelines**.

**What's in the page**

- Table of all configured pipelines — one row each for `image`, `video`, `raw_camera`.
- **Live status pill** per row — now probes both VAST DataEngine function resolution _and_ VastDB schema/table reachability. Five states:
  - `OK` — function resolves and the target `schema.table` is reachable.
  - `Not found` — the configured VAST function name doesn't exist.
  - `Unreachable` — VAST DataEngine is unreachable.
  - `Target missing` — the `schema.table` doesn't exist in VastDB.
  - `Target unreachable` — vastdb-query is down.
  - Hover any non-OK pill for a one-line diagnosis.
- **Refresh button** — bypasses the 60-second discovery cache.
- **Enable / Disable toggle** — inline, with optimistic update and rollback on save failure.
- **Empty-state "Seed defaults"** — one-click populate from the canonical seed JSON (`services/control-plane/src/data-engine/default-pipelines.json`).
- **Partial-state "Seed missing"** — surfaces when some `fileKind` entries are absent; appends only the missing kinds, preserving existing entries.
- **Edit dialog with three panes**:
  1. **Form pane** — `functionName`, `extensions` (comma-separated), `targetSchema`, `targetTable`, `sidecarSchemaId`, `displayLabel`, `enabled`. `fileKind` is read-only.
  2. **Live VAST record** — read-only view of the live function metadata (GUID, description, owner, revision, timestamps, VRN).
  3. **Test lookup** — S3 path input + Run button; hits the configured `schema.table` through a thin admin proxy. Useful for verifying a new routing decision **before** saving.

**Validation hardening**

- `targetSchema` and `targetTable` must now be valid SQL-style identifiers (`^[a-zA-Z_][a-zA-Z0-9_]*$`). Invalid input (e.g. "bogus with spaces") returns a 400 with the exact regex message, rendered inline in the edit dialog.
- `enabled` now round-trips through both `GET /platform/settings` and `GET /dataengine/pipelines/active` (the response schemas had been silently stripping the field).

**Also fixed in the same PR (pre-existing regression)**

The legacy `/exr-metadata/*` endpoints had been defaulting to the old schema name `exr_metadata`, returning empty rows for every EXR asset after the 2026-04 schema rename to `frame_metadata`. The asset-detail page and the asset-browser side panel were showing just filename + source instead of the full 60+ field view. Default updated in both `docker-compose.yml` and `services/vastdb-query/main.py`; deployments with a host-side `.env` override should update `VASTDB_SCHEMA=frame_metadata`.

**Tracked as follow-ups (separate cycle)**

Three related pre-Phase-5.5 bugs surfaced during smoke-test and are documented in `docs/issues/2026-04-17-metadata-plumbing-followups.md`:

- C-1b video lookup misses rows due to extractor path-key inconsistency.
- Storage Browser video preview renders a broken-image placeholder instead of the proxy player.
- Storage Browser metadata panel is EXR-branded and doesn't route through the pipeline config.

**Deploy notes**

- Control-plane: `docker compose restart control-plane` (tsx, no build needed for src-only changes).
- Web-UI: `docker compose build web-ui && docker compose up -d web-ui`.
- vastdb-query: `docker compose build vastdb-query && docker compose up -d vastdb-query`. Also ensure `VASTDB_SCHEMA=frame_metadata` is set in any host `.env` override.

**New endpoints**

- `GET /api/v1/dataengine/pipelines/defaults` — canonical seed list (backs the "Seed defaults" button).
- `GET /api/v1/metadata/lookup?path=&schema=&table=` — admin proxy over vastdb-query's schema-agnostic lookup (backs the per-pipeline test-lookup tool).
