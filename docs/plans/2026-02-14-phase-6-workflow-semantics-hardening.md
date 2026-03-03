# Phase 6 Workflow Semantics Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce deterministic workflow state and replay semantics so retries, replays, and event processing remain safe under production failure conditions.

**Architecture:** Keep the existing route contracts stable while introducing explicit workflow transition policy in persistence and replay guardrails in the control-plane routes. Apply behavior through the adapter boundary so both local and VAST-backed operation paths use the same semantics. Add focused tests first for invalid transitions, replay abuse controls, and ordering/idempotency edge cases.

**Tech Stack:** TypeScript, Fastify, Node test runner (`node --test` with `tsx`), existing control-plane contract tests.

---

### Task 1: Enforce canonical workflow state transitions

**Files:**
- Create: `services/control-plane/src/workflow/transitions.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Test: `services/control-plane/test/workflow-semantics.test.ts`

**Step 1: Write the failing test**

Add tests that prove:
- transition from `completed` to any non-`completed` state is rejected
- transition from `failed` to `processing` is rejected
- same-state transition remains idempotent

```ts
test("completed jobs reject non-terminal transitions", async () => {
  // ingest -> processing -> completed, then try forcing processing again
  // expect deterministic rejection
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/workflow-semantics.test.ts`

Expected: FAIL because transitions are currently permissive.

**Step 3: Write minimal implementation**

Implement transition policy helper:

```ts
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean { ... }
```

Use it in `setJobStatus` to reject invalid transitions.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/workflow-semantics.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/workflow/transitions.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/test/workflow-semantics.test.ts
git commit -m "feat: enforce workflow transition guards"
```

### Task 2: Add replay safety guardrails (enable switch, rate, and scope)

**Files:**
- Modify: `services/control-plane/src/routes/jobs.ts`
- Modify: `services/control-plane/src/persistence/types.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Test: `services/control-plane/test/workflow-semantics.test.ts`

**Step 1: Write the failing test**

Add tests that prove:
- replay is blocked when disabled via env (`ASSETHARBOR_REPLAY_ENABLED=false`)
- replay is rejected for non-failed/non-needs_replay jobs
- replay rate limit rejects excessive replay requests in a fixed window

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/workflow-semantics.test.ts`

Expected: FAIL because replay controls do not exist yet.

**Step 3: Write minimal implementation**

Implement route-level and persistence-level replay checks with deterministic errors (e.g., `REPLAY_DISABLED`, `REPLAY_NOT_ALLOWED`, `RATE_LIMITED`).

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/workflow-semantics.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/routes/jobs.ts services/control-plane/src/persistence/types.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/test/workflow-semantics.test.ts
git commit -m "feat: add replay safety controls"
```

### Task 3: Lock ordering/idempotency expectations and docs

**Files:**
- Modify: `services/control-plane/test/events-v1-contract.test.ts`
- Modify: `services/control-plane/test/workflow-semantics.test.ts`
- Modify: `docs/event-contracts.md`
- Modify: `docs/runbook.md`
- Modify: `tests/docs/docs-presence.test.js`

**Step 1: Write the failing test**

Add tests for duplicate and out-of-order event handling expectations (deterministic acceptance/rejection behavior).

**Step 2: Run test to verify it fails**

Run:
- `node --import tsx --test test/events-v1-contract.test.ts test/workflow-semantics.test.ts`
- `npm run test:docs`

Expected: FAIL until behavior/docs are explicit.

**Step 3: Write minimal implementation**

Keep runtime behavior stable and codify ordering/idempotency policy in tests/docs; add only minimal logic required for determinism.

**Step 4: Run test to verify it passes**

Run:
- `npm run test:contracts`
- `npm run test:docs`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/test/events-v1-contract.test.ts services/control-plane/test/workflow-semantics.test.ts docs/event-contracts.md docs/runbook.md tests/docs/docs-presence.test.js
git commit -m "test: codify workflow ordering and idempotency policy"
```

### Task 4: Final verification and PR prep

**Files:**
- Verify all touched files from Tasks 1-3

**Step 1: Run full verification**

Run: `npm run test:all`

Expected: PASS.

**Step 2: Validate branch scope**

Run:
- `git status --short`
- `git diff --stat origin/main...HEAD`

Expected: only SERGIO-61 relevant files changed.

**Step 3: Push branch**

Run: `git push -u origin sergio-61-workflow-semantics-hardening`

**Step 4: Open PR**

Run:

```bash
gh pr create --base main --head sergio-61-workflow-semantics-hardening --title "feat: harden workflow state and replay semantics" --body "$(cat <<'EOF'
## Summary
- enforce deterministic workflow transition guards
- add replay safety controls and deterministic rejection paths
- codify ordering/idempotency behavior with tests and docs

## Test Plan
- [x] npm run test:contracts
- [x] npm run test:control-plane
- [x] npm run test:docs
- [x] npm run test:all
EOF
)"
```
