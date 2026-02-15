# SERGIO-60 Reliability Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add practical reliability validation tooling and automation for fault scenarios, load-smoke checks, and DR readiness without changing API contracts.

**Architecture:** Build a small reliability smoke harness that exercises critical workflow paths against a running control-plane and emits JSON artifacts. Add deterministic reliability invariants in control-plane tests to keep regressions visible in PR checks. Add a nightly GitHub workflow to run compose + smoke harness and publish artifacts for trend tracking.

**Tech Stack:** Node.js test runner, TypeScript control-plane tests, GitHub Actions, Docker Compose, existing AssetHarbor APIs.

---

### Task 1: Add reliability smoke harness with artifact output

**Files:**
- Create: `tests/reliability/harness.js`
- Create: `tests/reliability/run-smoke.mjs`
- Create: `tests/reliability/harness.test.js`

**Step 1: Write the failing test**

In `tests/reliability/harness.test.js`, add test coverage for harness behavior:
- runs scenarios and returns structured result object
- marks scenario failures with details

**Step 2: Run test to verify it fails**

Run: `node --test tests/reliability/harness.test.js`

Expected: FAIL because harness module does not exist yet.

**Step 3: Write minimal implementation**

Implement `runReliabilitySmoke()` in `tests/reliability/harness.js` with scenarios:
- health check (`GET /health`)
- ingest + claim check
- duplicate event idempotency check

Add `tests/reliability/run-smoke.mjs` CLI that:
- calls `runReliabilitySmoke()`
- writes JSON artifact to `artifacts/reliability/*.json`
- exits non-zero on failure.

**Step 4: Run test to verify it passes**

Run:
- `node --test tests/reliability/harness.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/reliability/harness.js tests/reliability/run-smoke.mjs tests/reliability/harness.test.js
git commit -m "feat: add reliability smoke harness"
```

### Task 2: Add deterministic reliability invariant tests

**Files:**
- Create: `services/control-plane/test/reliability-invariants.test.ts`

**Step 1: Write the failing test**

Add failing-first tests for invariants:
- duplicate canonical event does not cause extra state mutation
- unknown job event is rejected without changing counters
- wrong-worker heartbeat is rejected and lease ownership is preserved

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test services/control-plane/test/reliability-invariants.test.ts`

Expected: FAIL until assertions + setup are correct.

**Step 3: Write minimal implementation**

Use existing endpoints only; avoid production code changes unless an invariant truly fails.

**Step 4: Run test to verify it passes**

Run:
- `node --import tsx --test services/control-plane/test/reliability-invariants.test.ts`
- `npm run test:control-plane`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/test/reliability-invariants.test.ts
git commit -m "test: add deterministic reliability invariants"
```

### Task 3: Add nightly reliability smoke workflow

**Files:**
- Create: `.github/workflows/nightly-reliability-smoke.yml`
- Create: `tests/compose/nightly-reliability-workflow.test.js`
- Modify: `package.json`

**Step 1: Write the failing test**

Add workflow structure test in `tests/compose/nightly-reliability-workflow.test.js` asserting:
- cron schedule exists
- compose startup step exists
- smoke harness execution step exists
- artifact upload step exists

**Step 2: Run test to verify it fails**

Run:
- `node --test tests/compose/nightly-reliability-workflow.test.js`

Expected: FAIL because workflow file does not exist.

**Step 3: Write minimal implementation**

Create `.github/workflows/nightly-reliability-smoke.yml`:
- schedule: nightly cron
- `docker compose up -d --build`
- run smoke harness (`node tests/reliability/run-smoke.mjs`)
- upload reliability artifact

Update `package.json` `test:compose` to run all compose tests:

```json
"test:compose": "node --test tests/compose/*.test.js"
```

**Step 4: Run test to verify it passes**

Run:
- `npm run test:compose`

Expected: PASS.

**Step 5: Commit**

```bash
git add .github/workflows/nightly-reliability-smoke.yml tests/compose/nightly-reliability-workflow.test.js package.json
git commit -m "ci: add nightly reliability smoke workflow"
```

### Task 4: Final verification and PR prep

**Files:**
- Verify all files changed in Tasks 1-3

**Step 1: Run full verification**

Run:
- `npm run test:compose`
- `npm run test:control-plane`
- `npm run test:all`

Expected: PASS.

**Step 2: Verify branch scope**

Run:
- `git status --short`
- `git diff --stat origin/main...HEAD`

Expected: only SERGIO-60 reliability harness/tests/workflow files changed.

**Step 3: Push branch**

Run: `git push -u origin sergio-60-reliability-validation`

**Step 4: Open PR**

Run:

```bash
gh pr create --base main --head sergio-60-reliability-validation --title "feat: add reliability validation harness and nightly smoke" --body "$(cat <<'EOF'
## Summary
- add reliability smoke harness with JSON artifact output
- add deterministic reliability invariant tests for critical workflow guarantees
- add nightly CI workflow to run compose + reliability smoke and publish artifacts

## Test Plan
- [x] node --test tests/reliability/harness.test.js
- [x] npm run test:compose
- [x] npm run test:control-plane
- [x] npm run test:all
EOF
)"
```
