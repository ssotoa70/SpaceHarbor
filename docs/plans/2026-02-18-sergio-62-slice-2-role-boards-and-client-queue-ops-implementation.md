# SERGIO-62 Slice 2 Role Boards and Client Queue Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add read-only Operator/Coordinator/Supervisor boards with client-side queue search/filter/aging while preserving current backend contracts.

**Architecture:** Keep `App.tsx` as a shell for data refresh and role selection, then delegate role-specific rendering to dedicated board components. Centralize queue search/filter/aging derivation in pure utilities so behavior is deterministic and testable. Keep implementation UI-only with no API contract changes.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Add Shared Queue Derivation Utilities

**Files:**
- Create: `services/web-ui/src/queue/view-model.ts`
- Create: `services/web-ui/src/queue/view-model.test.ts`
- Modify: `services/web-ui/src/api.ts`

**Step 1: Write the failing tests**

In `services/web-ui/src/queue/view-model.test.ts`, add tests for:

- aging bucket derivation (`fresh`, `warning`, `critical`)
- free-text matching against `title`, `sourceUri`, and metadata fields
- combined filters (status + priority + owner/vendor)

Example:

```ts
expect(deriveAgingBucket(10)).toBe("fresh");
expect(deriveAgingBucket(95)).toBe("warning");
expect(deriveAgingBucket(180)).toBe("critical");
expect(matchesSearch(row, "show-a sh010")).toBe(true);
```

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/queue/view-model.test.ts`
Expected: FAIL because utilities do not exist yet.

**Step 3: Write minimal implementation**

In `services/web-ui/src/api.ts`, extend `AssetRow` type to include:

```ts
productionMetadata: {
  show: string | null;
  episode: string | null;
  sequence: string | null;
  shot: string | null;
  version: number | null;
  vendor: string | null;
  priority: "low" | "normal" | "high" | "urgent" | null;
  dueDate: string | null;
  owner: string | null;
};
```

In `services/web-ui/src/queue/view-model.ts`, add pure helpers:

- `deriveAgingBucket(ageMinutes: number): "fresh" | "warning" | "critical"`
- `toQueueViewRow(asset: AssetRow, nowMs: number)`
- `matchesSearch(row, query)`
- `applyQueueFilters(rows, filters)`
- `buildSupervisorSummary(rows)`

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/queue/view-model.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/queue/view-model.ts services/web-ui/src/queue/view-model.test.ts
git commit -m "feat: add shared queue derivation utilities for role boards"
```

### Task 2: Extract Operator Board From App Shell

**Files:**
- Create: `services/web-ui/src/boards/OperatorBoard.tsx`
- Create: `services/web-ui/src/boards/OperatorBoard.test.tsx`
- Modify: `services/web-ui/src/App.tsx`

**Step 1: Write failing test**

In `services/web-ui/src/boards/OperatorBoard.test.tsx`, assert operator board renders:

- queue table
- replay action for failed rows
- ingest panel presence/labels

**Step 2: Run test to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/OperatorBoard.test.tsx`
Expected: FAIL because component does not exist.

**Step 3: Write minimal implementation**

- Move existing ingest + queue rendering block from `App.tsx` to `OperatorBoard.tsx`.
- Pass only required props (`assets`, `title`, `sourceUri`, handlers).
- Keep behavior unchanged.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/OperatorBoard.test.tsx src/App.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/OperatorBoard.tsx services/web-ui/src/boards/OperatorBoard.test.tsx services/web-ui/src/App.tsx
git commit -m "refactor: extract operator board from app shell"
```

### Task 3: Add Coordinator Board With Client Search and Filters

**Files:**
- Create: `services/web-ui/src/boards/CoordinatorBoard.tsx`
- Create: `services/web-ui/src/boards/CoordinatorBoard.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/CoordinatorBoard.test.tsx`, add tests for:

- free-text search filtering queue rows
- status/priority/owner/vendor filters
- reset filters behavior
- empty-state message when no matches

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: FAIL because board and controls do not exist.

**Step 3: Write minimal implementation**

- Build `CoordinatorBoard.tsx` with local filter state.
- Use helpers from `queue/view-model.ts` for search/filter/sort.
- Add accessible labels for all controls.
- Add minimal styles in `styles.css` for filter bar and badges.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/CoordinatorBoard.tsx services/web-ui/src/boards/CoordinatorBoard.test.tsx services/web-ui/src/styles.css
git commit -m "feat: add coordinator board with client-side queue filters"
```

### Task 4: Add Supervisor Board With Aging and Summary

**Files:**
- Create: `services/web-ui/src/boards/SupervisorBoard.tsx`
- Create: `services/web-ui/src/boards/SupervisorBoard.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/SupervisorBoard.test.tsx`, assert:

- summary cards show status/aging/priority counts
- critical aging rows are visible and labeled
- condensed table renders expected subset fields

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: FAIL because board does not exist.

**Step 3: Write minimal implementation**

- Build `SupervisorBoard.tsx` using `buildSupervisorSummary` and aging helpers.
- Render summary cards and compact queue table.
- Add non-color-only labels for bucket/state chips.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/SupervisorBoard.tsx services/web-ui/src/boards/SupervisorBoard.test.tsx services/web-ui/src/styles.css
git commit -m "feat: add supervisor board with aging and queue summary"
```

### Task 5: Integrate Role Selector in App Shell

**Files:**
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/App.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing test**

In `services/web-ui/src/App.test.tsx`, add tests for:

- role selector switches between Operator/Coordinator/Supervisor boards
- selected role persists via query string
- operator baseline functionality still works after switching back

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`
Expected: FAIL due missing role selector and board integration.

**Step 3: Write minimal implementation**

- Add role selector control in app shell.
- Route role-specific rendering to board components.
- Keep fetch logic centralized in shell.
- Persist selected role in query string.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx services/web-ui/src/styles.css
git commit -m "feat: add role selector and mount role-specific queue boards"
```

### Task 6: Update Docs for Slice 2 UI Scope

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/plans/2026-02-18-sergio-62-slice-2-role-boards-and-client-queue-ops-design.md` (if scope notes need final alignment)

**Step 1: Write docs update**

Add brief note under queue/operations docs that Slice 2 role boards use client-side filters/search over existing assets read model and introduce no API contract changes.

**Step 2: Run docs tests**

Run: `npm run test:docs`
Expected: PASS.

**Step 3: Commit**

```bash
git add docs/api-contracts.md docs/plans/2026-02-18-sergio-62-slice-2-role-boards-and-client-queue-ops-design.md
git commit -m "docs: describe Slice 2 role-board read-only scope"
```

### Task 7: Final Verification Gate

**Files:**
- Modify: none

**Step 1: Run focused web UI tests**

Run: `npm --prefix services/web-ui test`
Expected: PASS.

**Step 2: Run root web-ui shortcut**

Run: `npm run test:web-ui`
Expected: PASS.

**Step 3: Run full repository validation**

Run: `npm run test:all`
Expected: PASS.

**Step 4: Verify workspace preflight**

Run: `npm run check:workspace`
Expected: PASS.

**Step 5: Confirm clean state**

Run: `git status --short --branch`
Expected: clean branch or only intended changes for PR.
