# SERGIO-17: Review Annotation + Approval Event Contracts Design

## Context

SERGIO-63 is merged and established review/QC workflow capabilities. SERGIO-17 adds versioned event contracts for review annotation and approval outcomes so downstream integrations can consume a stable, additive contract surface.

## Scope

- Additive event taxonomy on existing `POST /api/v1/events` envelope.
- Keep `eventVersion: "1.0"` and existing endpoint unchanged.
- Define required payload fields for review, annotation, and task traceability.
- Add contract/OpenAPI tests and documentation updates.

## Out of Scope

- New event endpoint or envelope version migration.
- Multi-stage approvals, escalation/reminder events, or SLA timers.
- Full read-model/state-machine expansion derived from new events.

## Goals

- Preserve backward compatibility for existing event producers/consumers.
- Provide practical review-to-task traceability for artist/coordinator/supervisor workflows.
- Enforce deterministic validation and idempotency behavior using current envelope rules.

## Event Architecture

Keep the existing canonical envelope:

```json
{
  "eventId": "evt-123",
  "eventType": "asset.review.annotation_created",
  "eventVersion": "1.0",
  "occurredAt": "2026-02-21T00:00:00.000Z",
  "correlationId": "corr-123",
  "producer": "rv-review-web",
  "data": {}
}
```

Additive event types:

- `asset.review.annotation_created`
- `asset.review.annotation_resolved`
- `asset.review.task_linked`
- `asset.review.submission_created`
- `asset.review.decision_recorded`
- `asset.review.decision_overridden`

## Payload Contract Strategy

Common required `data` fields for all six event types:

- `projectId: string`
- `shotId: string`
- `reviewId: string`
- `submissionId: string`
- `versionId: string`
- `actorId: string`
- `actorRole: "artist" | "coordinator" | "supervisor" | "producer"`

Event-specific required fields:

- `asset.review.annotation_created`
  - `annotationId: string`
  - `content: string`
  - `anchor: { frame?: number; timecodeIn?: string; timecodeOut?: string }`
- `asset.review.annotation_resolved`
  - `annotationId: string`
  - `resolvedBy: string`
  - `resolutionNote: string | null`
- `asset.review.task_linked`
  - `annotationId: string`
  - `taskId: string`
  - `taskSystem: string`
- `asset.review.submission_created`
  - `submissionStatus: "in_review"`
- `asset.review.decision_recorded`
  - `decision: "approved" | "changes_requested" | "rejected"`
  - `decisionReasonCode: string`
- `asset.review.decision_overridden`
  - `priorDecisionEventId: string`
  - `decision: "approved" | "changes_requested" | "rejected"`
  - `overrideReasonCode: string`

Optional compatibility fields:

- `relatedEventId?: string` (causal linkage)

## Correlation and Idempotency

- `eventId` remains the idempotency key.
- `correlationId` groups multi-step workflow actions and should not be reused as idempotency key.
- Duplicate `eventId` handling remains a no-op contract (`202` with `duplicate: true`).

## Validation and Test Strategy

Contract tests (`services/control-plane/test/events-v1-contract.test.ts`):

- Accept valid payloads for each new `asset.review.*` event type.
- Reject invalid payloads with `400` and `code: CONTRACT_VALIDATION_ERROR`.
- Preserve duplicate idempotency behavior for new event types.

API v1 contract tests (`services/control-plane/test/api-v1-contracts.test.ts`):

- Verify envelope and error consistency when posting new review events.

OpenAPI contract tests (`services/control-plane/test/openapi-contract.test.ts`):

- Assert additive `eventType` enum coverage.
- Assert `data` schema field coverage and required-field behavior.

Regression gate:

- `npm run test:contracts`
- `npm run test:control-plane`

## Documentation Plan

- Update `docs/event-contracts.md` with new event taxonomy and sample payloads.
- Update `docs/api-contracts.md` with additive contract notes and traceability field definitions.

## Risks and Mitigations

Risks:

- Producer payload drift across tools.
- Over-constraining first iteration with future workflow semantics.
- Inconsistent identifier usage reducing traceability quality.

Mitigations:

- Centralize schema validation in `http/schemas` and test on contract path.
- Keep v1 to immutable facts; defer computed workflow states.
- Require stable IDs (`reviewId`, `submissionId`, `versionId`, `annotationId`, `taskId`).

## Acceptance Criteria Mapping

- Event schema files and sample payloads added: covered by schema + docs updates.
- `check_event_contracts` passes: covered by `npm run test:contracts`.
- Review-to-task correlation fields documented: covered by required field set in docs.
