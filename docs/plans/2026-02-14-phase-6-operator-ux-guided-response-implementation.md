# Phase 6 Operator UX Guided Response Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver operator-focused degraded-mode UX in the existing web UI using current APIs only, with clear health detection, impact correlation, and local guided actions.

**Architecture:** Keep a single page but split operational concerns into focused modules/components. Derive health and trend state from metrics + audit snapshots on a polling loop with stale-data awareness and anti-flap behavior. Persist guided actions in local storage as browser-local advisory state, not shared system truth.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, existing `services/web-ui` API client.

---

### Task 1: Add operator data model and metrics client support

**Files:**
- Create: `services/web-ui/src/operator/types.ts`
- Modify: `services/web-ui/src/api.ts`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

In `services/web-ui/src/App.test.tsx`, add a test that expects a health section heading to render when metrics are available.

```tsx
it("renders operational health section", async () => {
  render(<App />)
  expect(await screen.findByRole("heading", { name: /operational health/i })).toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL because health section and metrics model are not implemented.

**Step 3: Write minimal implementation**

- Add typed metrics interfaces in `src/operator/types.ts`.
- Add `fetchMetrics()` in `src/api.ts`:

```ts
export interface MetricsSnapshot { ... }
export async function fetchMetrics(): Promise<MetricsSnapshot | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/metrics`)
  if (!response.ok) return null
  return (await response.json()) as MetricsSnapshot
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS for the new health heading test.

**Step 5: Commit**

```bash
git add services/web-ui/src/operator/types.ts services/web-ui/src/api.ts services/web-ui/src/App.test.tsx
git commit -m "feat: add operator metrics data model in web UI"
```

### Task 2: Implement health strip with stale-data behavior

**Files:**
- Create: `services/web-ui/src/operator/health.ts`
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/styles.css`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add tests for state labels and stale indicator.

```tsx
it("shows degraded health state when fallback events increase", async () => {
  render(<App />)
  expect(await screen.findByText(/degraded/i)).toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL because health derivation and stale indicators are missing.

**Step 3: Write minimal implementation**

- Add `deriveHealthState()` helper in `src/operator/health.ts` with anti-flap cooldown logic.
- In `App.tsx`, track snapshot history and `lastSuccessfulRefreshAt`.
- Render health strip with state label + last updated + stale marker.

```ts
const state = deriveHealthState({ current, previous, recentFallbackAudit, now })
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS for health state + stale rendering cases.

**Step 5: Commit**

```bash
git add services/web-ui/src/operator/health.ts services/web-ui/src/App.tsx services/web-ui/src/styles.css services/web-ui/src/App.test.tsx
git commit -m "feat: add degraded health strip with stale-state awareness"
```

### Task 3: Add fallback impact panel and trend

**Files:**
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/styles.css`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add test expecting fallback count and trend text (`rising` / `stable` / `falling`).

```tsx
it("shows fallback impact count and trend", async () => {
  render(<App />)
  expect(await screen.findByText(/fallback events/i)).toBeInTheDocument()
  expect(screen.getByText(/rising|stable|falling/i)).toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL because impact panel does not exist.

**Step 3: Write minimal implementation**

- Add impact panel rendering using current metrics + previous snapshot delta.
- Include queue/job counters relevant to triage (`pending`, `processing`, `failed`, `dlq`).

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS for impact panel/trend assertions.

**Step 5: Commit**

```bash
git add services/web-ui/src/App.tsx services/web-ui/src/styles.css services/web-ui/src/App.test.tsx
git commit -m "feat: add fallback impact and trend panel"
```

### Task 4: Upgrade audit list into correlated fallback timeline

**Files:**
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/styles.css`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add test asserting fallback-related audit rows are visually/semantically highlighted.

```tsx
it("highlights fallback-correlated audit events", async () => {
  render(<App />)
  expect(await screen.findByText(/vast fallback/i)).toBeInTheDocument()
  expect(screen.getByText(/vast fallback/i).closest("li")).toHaveClass("timeline-fallback")
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL because highlight classes/labels are not present.

**Step 3: Write minimal implementation**

- Detect fallback rows with case-insensitive `vast fallback` matching.
- Add timeline styles and labels that do not rely on color alone.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS for timeline correlation tests.

**Step 5: Commit**

```bash
git add services/web-ui/src/App.tsx services/web-ui/src/styles.css services/web-ui/src/App.test.tsx
git commit -m "feat: add correlated fallback timeline highlighting"
```

### Task 5: Add UI-only guided actions with local persistence

**Files:**
- Create: `services/web-ui/src/operator/actions.ts`
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/styles.css`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add tests for local-only action state persistence across re-render/reload.

```tsx
it("persists guided actions in local storage", async () => {
  render(<App />)
  // interact with acknowledge and owner
  // remount
  // expect state restored
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL because no local action persistence exists.

**Step 3: Write minimal implementation**

- Add storage helper in `src/operator/actions.ts`.
- Add guided action controls in `App.tsx`:
  - acknowledge toggle
  - owner input/select
  - escalate toggle
  - local-only disclaimer
  - clear/reset action

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS including persistence behavior.

**Step 5: Commit**

```bash
git add services/web-ui/src/operator/actions.ts services/web-ui/src/App.tsx services/web-ui/src/styles.css services/web-ui/src/App.test.tsx
git commit -m "feat: add local guided operator actions"
```

### Task 6: Accessibility and regression verification

**Files:**
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/styles.css`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add assertions for accessible labels, keyboard-focusable controls, and text labels on state badges.

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: FAIL where missing semantics exist.

**Step 3: Write minimal implementation**

- Ensure ARIA labels/live region for health state updates.
- Ensure all actionable controls are keyboard reachable and visibly focusable.
- Ensure state has text labels independent of color.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/web-ui test -- src/App.test.tsx`

Expected: PASS with accessibility checks.

**Step 5: Commit**

```bash
git add services/web-ui/src/App.tsx services/web-ui/src/styles.css services/web-ui/src/App.test.tsx
git commit -m "fix: improve operator UX accessibility and clarity"
```

### Task 7: Final verification and PR preparation

**Files:**
- Verify all files touched in Tasks 1-6

**Step 1: Run full verification**

Run: `npm run test:web-ui && npm run test:all`

Expected: PASS.

**Step 2: Validate diff scope**

Run:
- `git status --short`
- `git diff --stat origin/main...HEAD`

Expected: only SERGIO-58 web-ui and related test files changed.

**Step 3: Push branch**

Run: `git push -u origin sergio-58-operator-ux-guided-response`

**Step 4: Open PR**

Run:

```bash
gh pr create --base main --head sergio-58-operator-ux-guided-response --title "feat: add operator degraded-mode UX and guided response" --body "$(cat <<'EOF'
## Summary
- add operator health strip with degraded/recovering state and stale-data signaling
- add fallback impact and correlated timeline views using existing metrics/audit endpoints
- add UI-only guided actions with local persistence and accessibility guardrails

## Test Plan
- [x] npm --prefix services/web-ui test
- [x] npm run test:web-ui
- [x] npm run test:all
EOF
)"
```
