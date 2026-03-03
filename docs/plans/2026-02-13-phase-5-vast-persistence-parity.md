# Phase 5 VAST Persistence Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `vast` mode production-credible for core workflow persistence paths by introducing an explicit VAST client boundary, predictable fallback behavior, and contract tests that lock behavior.

**Architecture:** Keep `VastPersistenceAdapter` as the public adapter, but move network/data-store interactions behind a dedicated VAST workflow client interface. Route-level behavior remains unchanged (`/api/v1/*` contracts and error envelope stay stable). Add explicit strict/fallback semantics so failure behavior is deterministic and testable.

**Tech Stack:** TypeScript, Fastify, Node test runner (`node --test` + `tsx`), existing persistence adapters, fetch-based VAST integration.

---

### Task 1: Add explicit VAST workflow client boundary

**Files:**
- Create: `services/control-plane/src/persistence/vast/workflow-client.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Test: `services/control-plane/test/vast-adapter.test.ts`

**Step 1: Write the failing test**

Add a test proving `VastPersistenceAdapter.createIngestAsset()` delegates through a VAST workflow client method (not directly to local fallback internals).

```ts
test("VAST adapter delegates ingest writes to workflow client", () => {
  const calls: string[] = [];
  const client = {
    createIngestAsset: () => {
      calls.push("createIngestAsset");
      return null;
    }
  };
  const adapter = new VastPersistenceAdapter(config, fetchFn, client as any);
  adapter.createIngestAsset({ title: "x", sourceUri: "s3://b/x.mov" }, { correlationId: "corr-1" });
  assert.equal(calls.includes("createIngestAsset"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts`

Expected: FAIL because `VastPersistenceAdapter` does not yet accept/invoke workflow client.

**Step 3: Write minimal implementation**

Create a typed client contract in `workflow-client.ts`:

```ts
export interface VastWorkflowClient {
  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult | null;
  getJobById(jobId: string): WorkflowJob | null;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  replayJob(jobId: string, context: WriteContext): WorkflowJob | null;
}
```

Inject this client into `VastPersistenceAdapter` and call it first for the operations above, retaining local fallback behavior when client returns `null`.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts`

Expected: PASS with new delegation assertion plus existing VAST tests.

**Step 5: Commit**

```bash
git add services/control-plane/src/persistence/vast/workflow-client.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/test/vast-adapter.test.ts
git commit -m "refactor: add explicit VAST workflow client boundary"
```

### Task 2: Add strict vs fallback failure policy for VAST persistence operations

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Modify: `services/control-plane/src/persistence/factory.ts`
- Test: `services/control-plane/test/persistence-contract.test.ts`
- Test: `services/control-plane/test/vast-adapter.test.ts`

**Step 1: Write the failing test**

Add tests for policy behavior:
- strict mode + client failure -> throws
- fallback mode + client failure -> uses local fallback

```ts
test("strict VAST mode throws on workflow client write failure", () => {
  const adapter = new VastPersistenceAdapter(strictConfig, fetchFn, failingClient);
  assert.throws(() => adapter.createIngestAsset(input, ctx), /vast workflow client failure/i);
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts test/persistence-contract.test.ts`

Expected: FAIL because this policy does not exist yet.

**Step 3: Write minimal implementation**

In `factory.ts`, add config signal for fallback policy:

```ts
const fallbackToLocal = process.env.ASSETHARBOR_VAST_FALLBACK_TO_LOCAL?.toLowerCase() !== "false";
```

In `vast-persistence.ts`, centralize policy checks:

```ts
private shouldFallback(error: unknown): boolean {
  if (this.config.strict) return false;
  return this.config.fallbackToLocal;
}
```

Use this in each client-backed operation.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts test/persistence-contract.test.ts`

Expected: PASS with strict/fallback semantics locked.

**Step 5: Commit**

```bash
git add services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/src/persistence/factory.ts services/control-plane/test/persistence-contract.test.ts services/control-plane/test/vast-adapter.test.ts
git commit -m "feat: add explicit strict and fallback policy for vast mode"
```

### Task 3: Cover VAST mode behavior with endpoint-level contract tests

**Files:**
- Create: `services/control-plane/test/vast-mode-contract.test.ts`
- Modify: `services/control-plane/test/api-v1-contracts.test.ts` (only if shared helpers needed)
- Modify: `services/control-plane/test/events-v1-contract.test.ts` (only if shared helpers needed)

**Step 1: Write the failing test**

Add endpoint-level tests under VAST mode env:
- `POST /api/v1/assets/ingest` still returns v1 shape
- `POST /api/v1/queue/claim` handles empty/available job semantics
- failure path returns unified envelope when strict mode + VAST failure is triggered

```ts
test("VAST mode ingest preserves v1 response contract", async () => {
  process.env.ASSETHARBOR_PERSISTENCE_BACKEND = "vast";
  // build app + inject ingest
  assert.equal(response.statusCode, 201);
  assert.ok(response.json().asset.id);
  assert.ok(response.json().job.id);
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/vast-mode-contract.test.ts`

Expected: FAIL until VAST mode behavior and error mapping are wired for these scenarios.

**Step 3: Write minimal implementation**

Wire behavior needed by tests via adapter/factory adjustments only; do not change route contracts.

If strict VAST failures bubble, ensure route-level error response remains unified envelope (`code`, `message`, `requestId`, `details`) by using existing error handling path in routes (no new response format).

**Step 4: Run test to verify it passes**

Run:
- `npm --prefix services/control-plane test -- test/vast-mode-contract.test.ts`
- `npm --prefix services/control-plane run test:contracts`

Expected: PASS; no contract regression.

**Step 5: Commit**

```bash
git add services/control-plane/test/vast-mode-contract.test.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/src/persistence/factory.ts
git commit -m "test: add vast mode API contract coverage"
```

### Task 4: Keep OpenAPI/Phase 4 behavior locked during Phase 5 changes

**Files:**
- Modify: `services/control-plane/test/openapi-contract.test.ts` (if new VAST-specific assertions are needed)
- Test: `services/control-plane/test/openapi-contract.test.ts`

**Step 1: Write the failing test**

Only if needed, add one assertion verifying OpenAPI docs are unaffected by VAST mode toggles (same critical paths/operation metadata).

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/openapi-contract.test.ts`

Expected: FAIL only if you added a new assertion.

**Step 3: Write minimal implementation**

Apply only the smallest fix needed to keep docs stable (do not widen scope).

**Step 4: Run test to verify it passes**

Run:
- `npm --prefix services/control-plane test -- test/openapi-contract.test.ts`
- `npm --prefix services/control-plane run test:contracts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/test/openapi-contract.test.ts services/control-plane/src/**
git commit -m "test: lock openapi behavior during vast parity updates"
```

### Task 5: Update operator docs for VAST mode failure handling

**Files:**
- Modify: `docs/runbook.md`
- Modify: `docs/api-contracts.md`
- Modify: `README.md`
- Modify: `docs/wiki-2.0/Operations-Runbook.md`

**Step 1: Write the failing test**

Extend docs presence tests to assert VAST fallback/strict guidance exists.

File: `tests/docs/docs-presence.test.js`

```js
assert.match(read("docs/runbook.md"), /VAST strict/i);
assert.match(read("docs/runbook.md"), /fallback/i);
```

**Step 2: Run test to verify it fails**

Run: `npm run test:docs`

Expected: FAIL until docs include the new guidance.

**Step 3: Write minimal implementation**

Document:
- env vars controlling VAST strict/fallback policy
- what operators should expect in strict mode failures
- how to validate behavior with existing endpoints/tests

**Step 4: Run test to verify it passes**

Run:
- `npm run test:docs`
- `npm run test:all`

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/runbook.md docs/api-contracts.md README.md docs/wiki-2.0/Operations-Runbook.md tests/docs/docs-presence.test.js
git commit -m "docs: add vast mode strict and fallback runbook guidance"
```

### Task 6: Final verification and PR preparation

**Files:**
- Verify changed files from all prior tasks

**Step 1: Run full verification**

Run: `npm run test:all`

Expected: PASS (all suites green).

**Step 2: Inspect git diff for scope control**

Run:
- `git status --short`
- `git diff --stat main...HEAD`

Expected: only Phase 5 relevant files changed.

**Step 3: Prepare PR summary**

Include:
- VAST client boundary introduction
- strict/fallback semantics
- new VAST mode contract coverage
- docs/runbook updates

**Step 4: Push branch**

Run: `git push -u origin sergio-57-phase-5-vast-adapter-persistence-parity`

**Step 5: Open PR**

Run:

```bash
gh pr create --base main --head sergio-57-phase-5-vast-adapter-persistence-parity --title "feat: implement phase 5 vast persistence parity" --body "$(cat <<'EOF'
## Summary
- add explicit VAST workflow client boundary and policy controls
- preserve API/OpenAPI contracts while improving vast-mode reliability semantics
- add vast-mode contract tests and operator runbook guidance

## Test Plan
- [x] npm run test:contracts
- [x] npm run test:control-plane
- [x] npm run test:docs
- [x] npm run test:all
EOF
)"
```
