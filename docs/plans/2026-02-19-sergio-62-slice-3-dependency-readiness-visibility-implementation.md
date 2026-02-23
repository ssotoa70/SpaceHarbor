# SERGIO-62 Slice 3 Dependency Readiness Visibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add read-only dependency readiness visibility in coordinator and supervisor boards with deterministic blocker reasons and no backend/API changes.

**Architecture:** Implement readiness as pure client-side derivation utilities in `services/web-ui/src/queue`, then consume the derived fields in `CoordinatorBoard` and `SupervisorBoard`. Keep all fetch logic and API usage unchanged in `App.tsx`, and keep this slice UI-only. Use strict TDD for each behavior change.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Add Dependency Readiness Utility Module (TDD First)

**Files:**
- Create: `services/web-ui/src/queue/dependency-readiness.ts`
- Create: `services/web-ui/src/queue/dependency-readiness.test.ts`
- Modify: `services/web-ui/src/queue/view-model.ts`

**Step 1: Write the failing tests**

In `services/web-ui/src/queue/dependency-readiness.test.ts`, add tests for:
- ready row with no blockers
- each blocker reason (`missing_owner`, `missing_priority`, `missing_due_date`, `aged_critical`, `status_not_actionable`)
- multi-reason aggregation order stability
- severity derivation (`info`, `warning`, `critical`)

Example:

```ts
expect(deriveDependencyReadiness(rowReady)).toEqual({
  isReady: true,
  reasons: [],
  severity: "info"
});
expect(deriveDependencyReadiness(rowBlocked).reasons).toContain("missing_owner");
```

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/queue/dependency-readiness.test.ts`
Expected: FAIL because module is not implemented.

**Step 3: Write minimal implementation**

In `services/web-ui/src/queue/dependency-readiness.ts`, add types and pure functions:

```ts
export type DependencyReason =
  | "missing_owner"
  | "missing_priority"
  | "missing_due_date"
  | "aged_critical"
  | "status_not_actionable";

export interface DependencyReadiness {
  isReady: boolean;
  reasons: DependencyReason[];
  severity: "info" | "warning" | "critical";
}
```

Implement `deriveDependencyReadiness(row)` using actionable statuses:
- `pending`, `failed`, `needs_replay`

In `services/web-ui/src/queue/view-model.ts`, extend `QueueViewRow` with:
- `dependencyReadiness: DependencyReadiness`

and assign it in `toQueueViewRow()`.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/queue/dependency-readiness.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/queue/dependency-readiness.ts services/web-ui/src/queue/dependency-readiness.test.ts services/web-ui/src/queue/view-model.ts
git commit -m "feat: add deterministic dependency readiness derivation"
```

### Task 2: Add Readiness Column and Filters to Coordinator Board

**Files:**
- Modify: `services/web-ui/src/boards/CoordinatorBoard.tsx`
- Modify: `services/web-ui/src/boards/CoordinatorBoard.test.tsx`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/CoordinatorBoard.test.tsx`, add tests for:
- readiness column renders `Ready`/`Blocked`
- reason chips render for blocked rows
- new filters for `Readiness filter` (`all|ready|blocked`) and `Blocker reason filter`
- reset button clears readiness/reason filters too

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: FAIL due missing readiness UI and filters.

**Step 3: Write minimal implementation**

In `CoordinatorBoard.tsx`:
- add local state: `readinessFilter`, `reasonFilter`
- include readiness and reason checks in filtered rows
- add table columns:
  - `Dependency readiness`
  - `Blocker reasons`

Example display logic:

```tsx
const readiness = row.dependencyReadiness;
const readinessLabel = readiness.isReady ? "Ready" : "Blocked";
```

Render reason chips from `readiness.reasons`.

In `styles.css`, add minimal classes for readiness badges and reason chips.

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/CoordinatorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/CoordinatorBoard.tsx services/web-ui/src/boards/CoordinatorBoard.test.tsx services/web-ui/src/styles.css
git commit -m "feat: show dependency readiness and blocker filters in coordinator board"
```

### Task 3: Add Readiness Summary and Distribution to Supervisor Board

**Files:**
- Modify: `services/web-ui/src/boards/SupervisorBoard.tsx`
- Modify: `services/web-ui/src/boards/SupervisorBoard.test.tsx`
- Modify: `services/web-ui/src/queue/view-model.ts`
- Modify: `services/web-ui/src/styles.css`

**Step 1: Write failing tests**

In `services/web-ui/src/boards/SupervisorBoard.test.tsx`, add tests for:
- summary counts for `ready` and `blocked`
- blocker reason distribution list
- explicit text labels (no color-only reliance)

**Step 2: Run tests to verify RED**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: FAIL due missing readiness summary/distribution.

**Step 3: Write minimal implementation**

Add helper(s) in `view-model.ts` for readiness summary aggregation, e.g.:

```ts
export interface DependencySummary {
  ready: number;
  blocked: number;
  byReason: Record<DependencyReason, number>;
}
```

In `SupervisorBoard.tsx`:
- render readiness summary card
- render reason distribution card/list
- keep existing queue table unchanged except optional readiness column/tag if needed

**Step 4: Run tests to verify GREEN**

Run: `npm --prefix services/web-ui test -- src/boards/SupervisorBoard.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/boards/SupervisorBoard.tsx services/web-ui/src/boards/SupervisorBoard.test.tsx services/web-ui/src/queue/view-model.ts services/web-ui/src/styles.css
git commit -m "feat: add supervisor dependency readiness summaries"
```

### Task 4: Update Shared Queue Utility Tests for Readiness Integration

**Files:**
- Modify: `services/web-ui/src/queue/view-model.test.ts`

**Step 1: Write failing test cases first**

Add tests verifying `toQueueViewRow()` now includes `dependencyReadiness` and that integration-level filtering behavior remains deterministic with readiness data present.

**Step 2: Run target tests (RED then GREEN)**

Run: `npm --prefix services/web-ui test -- src/queue/view-model.test.ts`
Expected: initial RED if assertions added before integration; then PASS after minimal fixes.

**Step 3: Commit**

```bash
git add services/web-ui/src/queue/view-model.test.ts
git commit -m "test: cover queue view-model dependency readiness integration"
```

### Task 5: Docs Update for Slice 3 Read-Only Dependency Visibility

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/plans/2026-02-19-sergio-62-slice-3-dependency-readiness-visibility-design.md` (if wording drift appears)

**Step 1: Update docs**

Add concise note:
- dependency visibility is UI-derived and read-only in Slice 3
- no API contract changes introduced
- bulk actions deferred to Slice 4

**Step 2: Run docs tests**

Run: `npm run test:docs`
Expected: PASS.

**Step 3: Commit**

```bash
git add docs/api-contracts.md docs/plans/2026-02-19-sergio-62-slice-3-dependency-readiness-visibility-design.md
git commit -m "docs: describe slice 3 dependency-readiness visibility scope"
```

### Task 6: Final Verification Gate

**Files:**
- Modify: none

**Step 1: Run focused readiness/board tests**

Run:

```bash
npm --prefix services/web-ui test -- src/queue/dependency-readiness.test.ts src/queue/view-model.test.ts src/boards/CoordinatorBoard.test.tsx src/boards/SupervisorBoard.test.tsx
```

Expected: PASS.

**Step 2: Run full web-ui tests**

Run: `npm --prefix services/web-ui test`
Expected: PASS.

**Step 3: Run root checks**

Run:

```bash
npm run test:web-ui
npm run test:all
npm run check:workspace
```

Expected: all PASS.

**Step 4: Confirm clean branch state**

Run: `git status --short --branch`
Expected: clean (or only intended staged/unpushed commits).
