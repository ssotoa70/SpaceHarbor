# SERGIO-64 Audit/Fallback Contract Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fragile fallback text matching with structured audit signals and keep operator health state logic contract-driven and recency-bounded.

**Architecture:** Add an explicit structured signal object to audit events, emit that signal from fallback paths, and expose `/api/v1/audit` through an explicit schema contract. Update web UI health derivation to use structured signal metadata instead of message parsing while preserving existing API/OpenAPI stability for non-fallback fields.

**Tech Stack:** TypeScript, Fastify, Node test runner, Vitest, React.

---

### Task 1: Add Structured Audit Signal Model and Emission

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Test: `services/control-plane/test/vast-adapter.test.ts`
- Test: `services/control-plane/test/vast-mode-contract.test.ts`

**Step 1: Write the failing tests**

```ts
assert.equal(event.signal?.type, "fallback");
assert.equal(event.signal?.code, "VAST_FALLBACK");
assert.equal(event.signal?.severity, "warning");
```

Add failing assertions in fallback-related tests that audit events include `signal` fields for VAST fallback events.

**Step 2: Run tests to verify failure**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts test/vast-mode-contract.test.ts`
Expected: FAIL where `event.signal` is `undefined`.

**Step 3: Write minimal implementation**

```ts
interface AuditSignal {
  type: "fallback";
  code: "VAST_FALLBACK";
  severity: "warning" | "critical";
}

interface AuditEvent {
  id: string;
  message: string;
  at: string;
  signal?: AuditSignal;
}
```

Set `signal` in `VastPersistenceAdapter.recordFallbackAudit(...)` and keep existing `message` unchanged for backward readability.

**Step 4: Run tests to verify pass**

Run: `npm --prefix services/control-plane test -- test/vast-adapter.test.ts test/vast-mode-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/domain/models.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/test/vast-adapter.test.ts services/control-plane/test/vast-mode-contract.test.ts
git commit -m "feat: emit structured fallback signals in audit events"
```

### Task 2: Freeze `/api/v1/audit` Response Contract with OpenAPI/Test Coverage

**Files:**
- Modify: `services/control-plane/src/http/schemas.ts`
- Modify: `services/control-plane/src/routes/audit.ts`
- Modify: `services/control-plane/test/assets-audit.test.ts`
- Modify: `services/control-plane/test/openapi-contract.test.ts`
- Modify: `services/control-plane/test/api-v1-contracts.test.ts`

**Step 1: Write the failing tests**

```ts
assert.deepEqual(Object.keys(auditEvent).sort(), ["at", "id", "message", "signal"]);
assert.equal(auditEvent.signal?.code, "VAST_FALLBACK");
```

Add contract tests for `/api/v1/audit` event shape and OpenAPI metadata for the audit route.

**Step 2: Run tests to verify failure**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts test/openapi-contract.test.ts test/api-v1-contracts.test.ts`
Expected: FAIL due to missing explicit audit schema/contract assertions.

**Step 3: Write minimal implementation**

```ts
export const auditSignalSchema = {
  type: "object",
  required: ["type", "code", "severity"],
  properties: {
    type: { type: "string", enum: ["fallback"] },
    code: { type: "string", enum: ["VAST_FALLBACK"] },
    severity: { type: "string", enum: ["warning", "critical"] }
  }
} as const;
```

Register GET `/api/v1/audit` with response schema `{ events: AuditEvent[] }` and explicit operation metadata.

**Step 4: Run tests to verify pass**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts test/openapi-contract.test.ts test/api-v1-contracts.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/http/schemas.ts services/control-plane/src/routes/audit.ts services/control-plane/test/assets-audit.test.ts services/control-plane/test/openapi-contract.test.ts services/control-plane/test/api-v1-contracts.test.ts
git commit -m "test: lock /api/v1/audit schema and OpenAPI contract"
```

### Task 3: Switch UI Health Logic to Structured, Recency-Bounded Signals

**Files:**
- Modify: `services/web-ui/src/api.ts`
- Modify: `services/web-ui/src/operator/health.ts`
- Modify: `services/web-ui/src/App.tsx`
- Test: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing tests**

```ts
expect(screen.getByText(/degraded/i)).toBeInTheDocument();
expect(screen.queryByText(/degraded/i)).not.toBeInTheDocument();
```

Add tests that:
- degrade only when recent fallback signal exists,
- do not degrade on old/non-fallback audit messages,
- keep timeline highlight based on `event.signal.code` instead of message text.

**Step 2: Run tests to verify failure**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: FAIL because current logic relies on `message.includes("vast fallback")`.

**Step 3: Write minimal implementation**

```ts
const recentFallbackSignal = auditRows.some((row) => {
  if (row.signal?.code !== "VAST_FALLBACK") return false;
  return Date.now() - new Date(row.at).getTime() < 5 * 60_000;
});
```

Pass this boolean to `deriveHealthState(...)`, and keep existing metrics-based fallback trend intact.

**Step 4: Run tests to verify pass**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/operator/health.ts services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx
git commit -m "feat: drive operator degraded state from structured fallback signals"
```

### Task 4: Document Durability Semantics for Fallback Signals/Counters

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/runbook.md`

**Step 1: Write the failing docs test/update expectation**

```js
assert.match(apiContracts, /Audit fallback signal semantics/i);
assert.match(runbook, /fallback counter durability semantics/i);
```

Extend docs presence expectations if headings are enforced.

**Step 2: Run docs test to verify failure (if heading-gated)**

Run: `npm run test:docs`
Expected: FAIL if required heading checks are added before content.

**Step 3: Write minimal documentation updates**

Document:
- `signal` object contract in audit events,
- how UI interprets recency-bounded fallback signals,
- durability behavior for fallback counters on restart (current behavior and limitations).

**Step 4: Run docs and contract verification**

Run: `npm run test:docs && npm --prefix services/control-plane run test:contracts`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/api-contracts.md docs/runbook.md
git commit -m "docs: define structured fallback signal and durability semantics"
```

### Task 5: Final Verification Gate

**Files:**
- Modify: none
- Test: full repo verification commands

**Step 1: Run focused suites**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts test/vast-adapter.test.ts test/vast-mode-contract.test.ts test/openapi-contract.test.ts test/api-v1-contracts.test.ts`
Expected: PASS.

**Step 2: Run web UI suite**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: PASS.

**Step 3: Run full validation**

Run: `npm run test:all`
Expected: PASS.

**Step 4: Commit verification note**

```bash
git status
```

Expected: clean working tree.
