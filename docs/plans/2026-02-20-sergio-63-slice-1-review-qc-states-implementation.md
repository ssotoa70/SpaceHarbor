# SERGIO-63 Slice 1 Review/QC States Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add review/QC workflow states and approval gates end-to-end with additive API contracts and role-safe UI actions.

**Architecture:** Extend the existing workflow status model and transition guard with additive QC states, then wire the event processor/routes/schemas so state changes remain strict and auditable. Update the web UI to render new statuses and gate actions while preserving existing ingest/replay behavior.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Node test runner

---

### Task 1: Extend workflow status model and transition guard

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/workflow/transitions.ts`
- Test: `services/control-plane/test/workflow-semantics.test.ts`

**Step 1: Write the failing test**

Add transition tests for new paths and forbidden paths in `services/control-plane/test/workflow-semantics.test.ts`:

```ts
it("allows review/QC progression", () => {
  expect(canTransitionWorkflowStatus("completed", "qc_pending")).toBe(true);
  expect(canTransitionWorkflowStatus("qc_pending", "qc_in_review")).toBe(true);
  expect(canTransitionWorkflowStatus("qc_in_review", "qc_approved")).toBe(true);
  expect(canTransitionWorkflowStatus("qc_in_review", "qc_rejected")).toBe(true);
  expect(canTransitionWorkflowStatus("qc_rejected", "needs_replay")).toBe(true);
});

it("blocks invalid review/QC jumps", () => {
  expect(canTransitionWorkflowStatus("pending", "qc_in_review")).toBe(false);
  expect(canTransitionWorkflowStatus("processing", "qc_approved")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- workflow-semantics.test.ts`
Expected: FAIL due to missing QC status literals in type/transition table.

**Step 3: Write minimal implementation**

Update `WorkflowStatus` in `services/control-plane/src/domain/models.ts`:

```ts
export type WorkflowStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "needs_replay"
  | "qc_pending"
  | "qc_in_review"
  | "qc_approved"
  | "qc_rejected";
```

Update `ALLOWED_TRANSITIONS` in `services/control-plane/src/workflow/transitions.ts` with explicit QC rules.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- workflow-semantics.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/domain/models.ts services/control-plane/src/workflow/transitions.ts services/control-plane/test/workflow-semantics.test.ts
git commit -m "feat: add review and qc workflow transition states"
```

### Task 2: Extend event contract and processor mapping

**Files:**
- Modify: `services/control-plane/src/events/types.ts`
- Modify: `services/control-plane/src/events/processor.ts`
- Test: `services/control-plane/test/events-v1-contract.test.ts`
- Test: `services/control-plane/test/events.test.ts`

**Step 1: Write the failing test**

Add contract/processor tests for new event types:

```ts
const qcPendingEvent = "asset.review.qc_pending";
const qcInReviewEvent = "asset.review.in_review";
const qcApprovedEvent = "asset.review.approved";
const qcRejectedEvent = "asset.review.rejected";
```

Assert canonical event payloads with these `eventType` values are accepted and update job status correctly.

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane run test:contracts -- events-v1-contract.test.ts`
Expected: FAIL with contract validation rejection for unknown event type.

**Step 3: Write minimal implementation**

- Extend `AssetEventType` union and `EVENT_TYPES` list in `services/control-plane/src/events/types.ts`.
- Extend `mapEventToStatus` in `services/control-plane/src/events/processor.ts`:

```ts
case "asset.review.qc_pending":
  return "qc_pending";
case "asset.review.in_review":
  return "qc_in_review";
case "asset.review.approved":
  return "qc_approved";
case "asset.review.rejected":
  return "qc_rejected";
```

**Step 4: Run test to verify it passes**

Run:
- `npm --prefix services/control-plane run test:contracts -- events-v1-contract.test.ts`
- `npm --prefix services/control-plane test -- events.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/events/types.ts services/control-plane/src/events/processor.ts services/control-plane/test/events-v1-contract.test.ts services/control-plane/test/events.test.ts
git commit -m "feat: support qc lifecycle events in workflow processor"
```

### Task 3: Update HTTP schemas and OpenAPI contract

**Files:**
- Modify: `services/control-plane/src/http/schemas.ts`
- Modify: `services/control-plane/src/routes/events.ts`
- Modify: `docs/api-contracts.md`
- Test: `services/control-plane/test/openapi-contract.test.ts`
- Test: `services/control-plane/test/api-v1-contracts.test.ts`

**Step 1: Write the failing test**

Add assertions that OpenAPI exposes new workflow status values and review event acceptance in event schemas.

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`
Expected: FAIL because enum/schema still lacks new values.

**Step 3: Write minimal implementation**

- Expand status enum values in `services/control-plane/src/http/schemas.ts`.
- Ensure route schemas in `services/control-plane/src/routes/events.ts` reference expanded event type list.
- Add additive contract note in `docs/api-contracts.md` describing review/QC statuses and events.

**Step 4: Run test to verify it passes**

Run:
- `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`
- `npm --prefix services/control-plane run test:contracts -- api-v1-contracts.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/http/schemas.ts services/control-plane/src/routes/events.ts services/control-plane/test/openapi-contract.test.ts services/control-plane/test/api-v1-contracts.test.ts docs/api-contracts.md
git commit -m "docs: expose additive review qc contract in api schemas"
```

### Task 4: Add UI support for QC statuses and gate actions

**Files:**
- Modify: `services/web-ui/src/api.ts`
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

In `services/web-ui/src/App.test.tsx`, add tests that:
- render QC badges (`qc_pending`, `qc_in_review`, `qc_approved`, `qc_rejected`)
- show gate actions for applicable states
- hide actions for non-applicable states

Example assertion pattern:

```ts
expect(screen.getByText("qc_pending")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /start review/i })).toBeInTheDocument();
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: FAIL due to missing UI rendering/actions.

**Step 3: Write minimal implementation**

- Expand `AssetRow.status` type in `services/web-ui/src/api.ts`.
- In `services/web-ui/src/App.tsx`, add gate action buttons that POST the corresponding event via existing event endpoint helper (or add a minimal helper) and refresh.
- Keep replay button behavior unchanged for failure/replay states.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx
git commit -m "feat: render qc states and gate actions in web ui"
```

### Task 5: Full verification and regression gate

**Files:**
- Verify all modified files above

**Step 1: Write the failing test**

Run targeted suites before full run and note any failure.

**Step 2: Run test to verify it fails (if regression exists)**

Run:
- `npm --prefix services/control-plane test -- workflow-semantics.test.ts events.test.ts`
- `npm --prefix services/control-plane run test:contracts`
- `npm --prefix services/web-ui test`

Expected: identify and fix any remaining failures.

**Step 3: Write minimal implementation**

Address only failing assertions/regressions with smallest code changes.

**Step 4: Run test to verify it passes**

Run:
- `npm run check:workspace`
- `npm run test:all`

Expected: PASS with 0 failures.

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify review qc workflow slice with full regression pass"
```

### Task 6: PR and tracking updates

**Files:**
- Modify: PR description/comments
- Modify: Linear SERGIO-63 comments/status

**Step 1: Write the failing test**

Draft summary before posting and ensure it includes scope, risk profile, and verification evidence.

**Step 2: Run test to verify it fails**

Review draft for missing evidence links/command outputs.

**Step 3: Write minimal implementation**

Post updates with:
- implemented statuses and transitions
- additive contract statement
- test evidence (`npm run test:all`, `npm run check:workspace`)

**Step 4: Run test to verify it passes**

Confirm posted comments/description links are visible and accurate.

**Step 5: Commit**

No code commit required for remote comments unless local docs changed.
