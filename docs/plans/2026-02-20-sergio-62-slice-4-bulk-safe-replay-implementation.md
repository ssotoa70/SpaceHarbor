# SERGIO-62 Slice 4 Bulk-Safe Replay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add replay-only bulk-safe actions for coordinator and supervisor views with deterministic preflight/results behavior and no backend/API contract changes.

**Architecture:** Implement batch orchestration as pure web-ui utilities (`queue/bulk-replay.ts`) and keep backend integration through the existing per-job replay endpoint. Wire coordinator and supervisor boards to use shared eligibility and execution rules, and keep app-shell refresh control centralized in `App.tsx`.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Add Bulk Replay Utility Module (TDD First)

**Files:**
- Create: `services/web-ui/src/queue/bulk-replay.ts`
- Create: `services/web-ui/src/queue/bulk-replay.test.ts`

**Step 1: Write the failing tests**

In `services/web-ui/src/queue/bulk-replay.test.ts`, add tests for:

- eligibility classification (`failed`/`needs_replay`, `jobId` present, dependency-ready)
- max batch cap (25)
- sequential execution order
- stop-on-`429` behavior
- mixed outcomes (`replayed`, `failed`, `skipped`) with deterministic summary

Example:

```ts
expect(preflight.eligible).toHaveLength(2);
expect(preflight.blocked[0]?.reason).toBe("status_not_replayable");
expect(result.haltedReason).toBe("rate_limited");
```

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/queue/bulk-replay.test.ts`
Expected: FAIL because module does not exist.

**Step 3: Write minimal implementation**

In `services/web-ui/src/queue/bulk-replay.ts`, add:

- constants: `MAX_BULK_REPLAY_BATCH = 25`
- types:
  - `BulkReplayEligibilityReason`
  - `BulkReplayRowOutcome`
  - `BulkReplayRunResult`
- functions:
  - `preflightBulkReplay(rows)`
  - `runBulkReplay(rows, replayOne)`

`runBulkReplay` must:

- process eligible rows sequentially
- stop immediately on `429`
- continue on non-`429` row-level failures
- return deterministic per-row outcomes and aggregate counts

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/queue/bulk-replay.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/queue/bulk-replay.ts services/web-ui/src/queue/bulk-replay.test.ts
git commit -m "feat: add bulk replay safety orchestration utilities"
```

### Task 2: Add Replay API Error Type for Safer `429` Handling

**Files:**
- Modify: `services/web-ui/src/api.ts`
- Create: `services/web-ui/src/api.test.ts`

**Step 1: Write failing tests**

In `services/web-ui/src/api.test.ts`, add tests that `replayJob`:

- succeeds on `2xx`
- throws typed error containing `status` on non-`2xx`

Example:

```ts
await expect(replayJob("job-1")).rejects.toMatchObject({
  name: "ApiRequestError",
  status: 429
});
```

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/api.test.ts`
Expected: FAIL due missing typed error behavior.

**Step 3: Write minimal implementation**

In `services/web-ui/src/api.ts`, add `ApiRequestError` class and update `replayJob` to throw it with status.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/api.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/api.test.ts
git commit -m "feat: expose typed replay API errors for bulk safety"
```

### Task 3: Add Bulk Replay Panel to Coordinator Board

**Files:**
- Modify: `services/web-ui/src/boards/CoordinatorBoard.tsx`
- Modify: `services/web-ui/src/boards/CoordinatorBoard.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/CoordinatorBoard.test.tsx`, add tests for:

- multi-select controls per row
- bulk panel visibility when selection exists
- preflight eligible/blocked counts
- execute action only runs eligible rows
- result list includes per-row outcomes
- selection reset and retry-failed-only control behavior

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: FAIL due missing bulk panel/selection behavior.

**Step 3: Write minimal implementation**

In `CoordinatorBoard.tsx`:

- add selected row state
- call `preflightBulkReplay` before execution
- execute via callback prop `onReplayJob(jobId)` using `runBulkReplay`
- enforce confirmation step and max-cap messaging
- render results table with explicit outcome text

Keep existing filter/readiness behavior intact.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/CoordinatorBoard.tsx services/web-ui/src/boards/CoordinatorBoard.test.tsx services/web-ui/src/styles.css
git commit -m "feat: add coordinator bulk-safe replay workflow"
```

### Task 4: Add Bulk Replay Panel to Supervisor Board

**Files:**
- Modify: `services/web-ui/src/boards/SupervisorBoard.tsx`
- Modify: `services/web-ui/src/boards/SupervisorBoard.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/SupervisorBoard.test.tsx`, add tests for:

- selection and bulk panel behavior
- readiness-gated preflight counts
- execute + per-row outcomes
- stop-on-`429` safety signal rendering

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: FAIL due missing supervisor bulk action UI.

**Step 3: Write minimal implementation**

In `SupervisorBoard.tsx`:

- mirror coordinator bulk replay safety pattern
- keep summary cards and compact table behavior intact
- add bulk action controls and results with explicit labels

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/SupervisorBoard.tsx services/web-ui/src/boards/SupervisorBoard.test.tsx services/web-ui/src/styles.css
git commit -m "feat: add supervisor bulk-safe replay workflow"
```

### Task 5: Wire Replay Callback Through App Shell

**Files:**
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/App.test.tsx`

**Step 1: Write failing tests**

In `services/web-ui/src/App.test.tsx`, add tests that:

- coordinator/supervisor bulk replay callback triggers replay API calls
- refresh runs after bulk completion
- role switching and URL role persistence remain stable

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`
Expected: FAIL due missing board callback wiring.

**Step 3: Write minimal implementation**

- Add shared `onReplayJob(jobId)` callback in `App.tsx` and pass to both boards.
- Preserve existing `OperatorBoard` replay flow.
- Keep fetch/refresh orchestration centralized in app shell.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx
git commit -m "refactor: share replay callbacks across role boards"
```

### Task 6: Docs Update for Slice 4 Replay-Only Scope

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/plans/2026-02-20-sergio-62-slice-4-bulk-safe-replay-design.md` (if wording drift)

**Step 1: Update docs**

Add notes that Slice 4 bulk actions are:

- replay-only
- UI orchestrated via existing single-item API
- no backend contract changes
- status mutation bulk operations deferred

**Step 2: Run docs tests**

Run: `npm run test:docs`
Expected: PASS.

**Step 3: Commit**

```bash
git add docs/api-contracts.md docs/plans/2026-02-20-sergio-62-slice-4-bulk-safe-replay-design.md
git commit -m "docs: define slice 4 replay-only bulk action scope"
```

### Task 7: Final Verification Gate

**Files:**
- Modify: none

**Step 1: Run focused bulk-replay suites**

Run:

```bash
npm --prefix services/web-ui test -- src/queue/bulk-replay.test.ts src/boards/CoordinatorBoard.test.tsx src/boards/SupervisorBoard.test.tsx src/App.test.tsx
```

Expected: PASS.

**Step 2: Run full web-ui suite**

Run: `npm --prefix services/web-ui test`
Expected: PASS.

**Step 3: Run root verification commands**

Run:

```bash
npm run test:web-ui
npm run test:all
npm run check:workspace
```

Expected: all PASS.

**Step 4: Confirm branch state**

Run: `git status --short --branch`
Expected: clean or only intentional unpushed commits.
