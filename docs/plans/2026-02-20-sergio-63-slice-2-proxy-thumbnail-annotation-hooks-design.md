# SERGIO-63 Slice 2: Proxy/Thumbnail + Annotation Hooks Design

## Context

Slice 1 delivered review/QC lifecycle states and gate actions. Slice 2 should make the workflow preview-ready and annotation-ready without introducing a full media processing pipeline.

## Scope (Slice 2)

- Add additive proxy/thumbnail metadata fields to existing API read models.
- Add annotation integration hooks as metadata (provider/context placeholders).
- Update OpenAPI/contracts and UI rendering for preview/hook visibility.
- Keep all fields optional and default-safe.

## Out of Scope

- Actual proxy generation or thumbnail extraction jobs.
- Annotation thread storage/authoring.
- Provider-specific deep integration behavior.
- New storage subsystem for media derivatives.

## Goals

- Provide stable API surface for future proxy/thumbnail generation.
- Provide annotation-ready integration hooks for future slices.
- Preserve backward compatibility and low migration risk.

## Proposed Model Extensions

Add optional read-model fields on queue/job responses:

- `thumbnail`: `{ uri: string; width: number; height: number; generatedAt: string } | null`
- `proxy`: `{ uri: string; durationSeconds: number; codec: string; generatedAt: string } | null`
- `annotationHook`: `{ enabled: boolean; provider: string | null; contextId: string | null }`

Defaults:

- `thumbnail: null`
- `proxy: null`
- `annotationHook.enabled: false`
- `annotationHook.provider/contextId: null`

## API Strategy

- Keep endpoint set unchanged (`GET /api/v1/assets`, `GET /api/v1/jobs/:id`).
- Extend response schema additively with optional fields.
- No new required request fields in Slice 2.

Compatibility guarantees:

- Existing clients continue functioning if they ignore new fields.
- Existing tests for current required fields remain unchanged.

## UI Strategy

In queue/operations views:

- Display preview readiness states:
  - `Preview not available` when proxy/thumbnail is null
  - `Preview metadata available` when proxy or thumbnail exists
- Show annotation placeholder action only when `annotationHook.enabled` is true.
- Keep action disabled/no-op semantics explicit (no hidden side effects).

## Data and Persistence Strategy

- Reuse current persistence adapter and asset/job read projection.
- Add nullable metadata properties to stored model in local adapter.
- For this slice, values may remain null/default unless explicitly seeded in tests.

## Risks and Mitigations

Risks:

- Schema drift between runtime payload and OpenAPI contract.
- UI assumptions that preview metadata is always present.
- Overbuilding toward full pipeline too early.

Mitigations:

- Contract tests assert presence + optionality of new fields.
- UI tests for null and non-null metadata branches.
- Strict YAGNI boundary: no derivative generation workflow in this slice.

## Testing Plan

- Contract tests for additive field exposure in v1 responses.
- OpenAPI tests for schema definitions and optionality.
- Control-plane behavior tests for default null/disabled values.
- Web UI tests for preview/hook rendering logic.
- Full regression: `npm run test:all`.

## Acceptance Criteria

- Existing endpoints return optional proxy/thumbnail/annotation hook fields.
- OpenAPI and docs describe new fields as additive and optional.
- UI correctly reflects preview/hook availability states.
- Existing ingest/review/replay flows continue to pass unchanged.
