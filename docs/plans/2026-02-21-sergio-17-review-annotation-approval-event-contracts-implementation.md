# SERGIO-17 Review Annotation + Approval Event Contracts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add additive `asset.review.*` annotation/approval event contracts on existing `POST /api/v1/events` with `eventVersion: "1.0"`, including tests and docs, without introducing endpoint/version changes.

**Architecture:** Extend the existing canonical event contract enum and payload validation with a review-specific payload branch while preserving current workflow events. Keep processing semantics additive: new annotation/approval events are accepted and idempotent but do not change job workflow status. Verify OpenAPI/contract tests and document traceability fields.

**Tech Stack:** TypeScript, Fastify schema/OpenAPI, Node test runner (`node --test`), existing control-plane contract tests.

---

### Task 1: Add failing contract tests for new review event types

**Files:**
- Modify: `services/control-plane/test/events-v1-contract.test.ts`

**Step 1: Write the failing test for valid annotation/approval events**

Add a new test that sends each new event type:

- `asset.review.annotation_created`
- `asset.review.annotation_resolved`
- `asset.review.task_linked`
- `asset.review.submission_created`
- `asset.review.decision_recorded`
- `asset.review.decision_overridden`

Use canonical envelope and `data` fields required by design (`projectId`, `shotId`, `reviewId`, `submissionId`, `versionId`, `actorId`, `actorRole`, plus event-specific fields). Assert `202` accepted.

**Step 2: Add a no-status-mutation assertion**

In the same test, fetch `GET /api/v1/jobs/:id` before and after posting one review event and assert status remains unchanged.

**Step 3: Run targeted test to verify it fails**

Run: `npm --prefix services/control-plane run test:contracts -- events-v1-contract.test.ts`
Expected: FAIL due to unknown event types or missing schema support.

**Step 4: Commit checkpoint (after implementation in Task 2 passes)**

```bash
git add services/control-plane/test/events-v1-contract.test.ts
git commit -m "test: cover additive review annotation and approval event contracts"
```

### Task 2: Implement event type + payload schema support

**Files:**
- Modify: `services/control-plane/src/events/types.ts`
- Modify: `services/control-plane/src/routes/events.ts`

**Step 1: Extend event type union and runtime enum**

In `events/types.ts`, add new literals to `AssetEventType` and `EVENT_TYPES` list.

**Step 2: Extend canonical request schema in route**

In `routes/events.ts`, update `canonicalEventBodySchema`:

- Add new `eventType` enum values.
- Expand `data` schema to support both:
  - existing workflow fields (`assetId`, `jobId`, optional `error`)
  - new review event fields via `anyOf`/branch schema keyed by `eventType` (minimal additive approach is acceptable if Fastify schema limits discriminators).

Use explicit enum constraints for:

- `actorRole: ["artist", "coordinator", "supervisor", "producer"]`
- `decision: ["approved", "changes_requested", "rejected"]`

**Step 3: Keep backward compatibility in type guards**

Ensure `isCanonicalAssetEventEnvelope` remains true for existing event payloads and now also for new review events.

**Step 4: Run targeted contracts**

Run: `npm --prefix services/control-plane run test:contracts -- events-v1-contract.test.ts`
Expected: PASS for new acceptance tests and existing tests.

**Step 5: Commit checkpoint**

```bash
git add services/control-plane/src/events/types.ts services/control-plane/src/routes/events.ts services/control-plane/test/events-v1-contract.test.ts
git commit -m "feat: add additive asset.review annotation and approval event contracts"
```

### Task 3: Ensure processor behavior is additive and non-disruptive

**Files:**
- Modify: `services/control-plane/src/events/processor.ts`
- Modify: `services/control-plane/test/events-v1-contract.test.ts`

**Step 1: Write failing behavior test first**

Add a test case asserting new review annotation/approval events do not force workflow status transition and still return `202`.

**Step 2: Implement minimal processor behavior**

Update `processAssetEvent` to treat new annotation/approval events as accepted idempotent events that:

- validate job existence (if required for current envelope consistency)
- call `markProcessedEvent(eventId)`
- return accepted response without changing status

**Step 3: Run targeted test**

Run: `npm --prefix services/control-plane run test:contracts -- events-v1-contract.test.ts`
Expected: PASS.

**Step 4: Commit checkpoint**

```bash
git add services/control-plane/src/events/processor.ts services/control-plane/test/events-v1-contract.test.ts
git commit -m "fix: accept review contract events without mutating workflow status"
```

### Task 4: Add OpenAPI contract coverage for new event types and required fields

**Files:**
- Modify: `services/control-plane/test/openapi-contract.test.ts`

**Step 1: Write failing OpenAPI assertions**

Add assertions under existing `/api/v1/events` OpenAPI checks for:

- six new `eventType` values
- key review payload fields present in request body schema (`projectId`, `shotId`, `reviewId`, `submissionId`, `versionId`, `actorId`, `actorRole`, plus representative event-specific fields)

**Step 2: Run test to verify fail (if schema not yet complete)**

Run: `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`
Expected: FAIL initially; then PASS after schema alignment from earlier tasks.

**Step 3: Verify pass**

Run: `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`
Expected: PASS.

**Step 4: Commit checkpoint**

```bash
git add services/control-plane/test/openapi-contract.test.ts
git commit -m "test: assert openapi coverage for additive review event contracts"
```

### Task 5: Update contract documentation and examples

**Files:**
- Modify: `docs/event-contracts.md`
- Modify: `docs/api-contracts.md`

**Step 1: Update event contract taxonomy**

In `docs/event-contracts.md`, add six new `asset.review.*` event types and required data fields (common + event-specific).

**Step 2: Add payload examples**

Include one canonical example for:

- `asset.review.annotation_created`
- `asset.review.decision_recorded`

**Step 3: Add traceability note in API contracts**

In `docs/api-contracts.md`, add additive note describing review-to-task correlation fields:

- `reviewId`, `submissionId`, `versionId`, `annotationId`, `taskId`, `taskSystem`

**Step 4: Validate docs test**

Run: `npm run test:docs`
Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add docs/event-contracts.md docs/api-contracts.md
git commit -m "docs: publish review annotation and approval event contracts"
```

### Task 6: Full verification and PR-ready evidence

**Files:**
- Verify only (no code changes expected)

**Step 1: Run contracts and service suite**

Run: `npm run test:contracts && npm run test:control-plane`
Expected: PASS.

**Step 2: Run full regression**

Run: `npm run test:all`
Expected: PASS.

**Step 3: Record evidence for issue/PR**

Capture passed command outputs for Linear/PR comment, including added event taxonomy and compatibility note.

**Step 4: Final commit hygiene check**

Run: `git status --short`
Expected: clean working tree.

## Notes for Executor

- Use @superpowers/test-driven-development discipline in each task (RED -> GREEN).
- Keep changes additive only; do not alter existing endpoint paths or error envelope shape.
- Prefer minimal schema branching over heavy model refactor (YAGNI).
- If schema expressiveness in route-level JSON schema is limiting, keep runtime guard deterministic and document exact accepted fields.
