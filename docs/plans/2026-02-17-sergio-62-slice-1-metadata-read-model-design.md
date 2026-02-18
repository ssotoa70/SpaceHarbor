# SERGIO-62 Slice 1 Metadata Read Model Design

## Context

SERGIO-62 introduces postproduction metadata and role-focused operations workflows. To reduce risk and preserve contract stability, Slice 1 is limited to additive metadata on queue read models.

Parallel specialist validation was completed before finalizing this design:

- Solutions architect: YELLOW (go with guardrails)
- Postproduction/media workflow expert: YELLOW (go with guardrails)

## Goal

Expose production metadata on `GET /api/v1/assets` rows while keeping ingest, worker, and event contracts unchanged.

## Guardrails

- Metadata is additive on queue read models only.
- `POST /api/v1/assets/ingest` request/response contract remains unchanged.
- Worker/event/outbox contracts remain unchanged.
- No role boards, filters/search, bulk actions, or dependency graph in this slice.
- Null-first metadata defaults to avoid synthetic data being treated as production truth.

## Scope

In scope:

- Add `productionMetadata` to `AssetQueueRow` returned by `GET /assets` and `GET /api/v1/assets`.
- Persist metadata initialization at ingest write-time.
- Read-time coalescing for legacy rows that lack metadata.
- OpenAPI/schema coverage for assets list response shape.
- Contract and regression tests for additive behavior.

Out of scope:

- Metadata write/update endpoints beyond ingest-time initialization.
- Role-specific operational views.
- Queue filtering/search APIs and aging indicators.
- Bulk-safe actions.
- Dependency visibility and handoff graph semantics.

## Chosen Approach

Use a nested additive object on queue rows:

- `AssetQueueRow` adds `productionMetadata`.
- `Asset` and `IngestResult` remain unchanged.
- A single default factory defines canonical metadata defaults.
- Defaults are applied both at write-time and read-time.

Rationale:

- Keeps API evolution clean and forward-compatible.
- Preserves current ingest and worker contracts.
- Supports incremental follow-on slices without contract churn.

## Data Model

Add `ProductionMetadata` with fields:

- `show: string | null`
- `episode: string | null`
- `sequence: string | null`
- `shot: string | null`
- `version: number | null`
- `vendor: string | null`
- `priority: "low" | "normal" | "high" | "urgent" | null`
- `dueDate: string | null` (ISO 8601 date-time with timezone when set)
- `owner: string | null`

`AssetQueueRow` shape becomes:

- existing required fields (`id`, `jobId`, `title`, `sourceUri`, `status`)
- additive required `productionMetadata`

Important boundary:

- Do not add `productionMetadata` to `Asset` or `IngestResult`.

## API and OpenAPI Contract

- Add explicit schema metadata for `GET /assets` and `GET /api/v1/assets` responses.
- Add `productionMetadataSchema` and wire into assets response schema.
- Keep ingest, queue/job, events, and outbox schemas unchanged.

## Compatibility and Safety

- Existing consumers that ignore new fields continue to function.
- Legacy rows without stored metadata still return a full metadata object via read-time defaulting.
- Adapter parity is required between local and VAST fallback behavior.
- No event payload changes in this slice.

## Testing Strategy

Add or update tests to verify:

- `GET /api/v1/assets` includes `productionMetadata` for every row.
- Defaulted metadata shape is deterministic for newly ingested and legacy rows.
- `POST /api/v1/assets/ingest` contract remains unchanged.
- OpenAPI documents `/api/v1/assets` response with metadata.

Verification commands:

- `npm --prefix services/control-plane test`
- `npm run test:contracts`
- `npm run test:all`

## Acceptance Criteria (Slice 1)

- Assets list rows return additive `productionMetadata` with stable keys.
- Unknown metadata values are `null`; `priority` is enum-or-null; `dueDate` is ISO date-time when set.
- Ingest and worker/event contracts remain unchanged.
- OpenAPI and contract tests pin the new additive assets list shape and ingest non-regression.

## Deferred Follow-On Slices

- Role-based operations boards.
- Search/filter and aging indicators.
- Bulk-safe actions.
- Dependency visibility.
- Explicit metadata authoring/update APIs.
