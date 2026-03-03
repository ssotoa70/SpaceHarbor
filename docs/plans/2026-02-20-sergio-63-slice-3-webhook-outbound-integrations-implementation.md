# SERGIO-63 Slice 3 Webhook Outbound Integrations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add webhook-only outbound integration delivery for Slack/Teams/production targets using existing outbox semantics, with signed payloads and retry-safe behavior.

**Architecture:** Reuse current outbox queue as the dispatch source and add a notifier layer that maps internal events to normalized outbound payloads, signs requests, and posts to configured target webhooks. Preserve idempotent publish behavior by only marking outbox entries published on successful delivery.

**Tech Stack:** TypeScript, Node fetch, Fastify control-plane, Vitest/node test runner

---

### Task 1: Add outbound notifier abstraction and target config model

**Files:**
- Create: `services/control-plane/src/integrations/outbound/types.ts`
- Create: `services/control-plane/src/integrations/outbound/config.ts`
- Create: `services/control-plane/src/integrations/outbound/notifier.ts`
- Test: `services/control-plane/test/outbound-config.test.ts`

**Step 1: Write the failing test**

Add tests for config resolution and strict mode behavior in `services/control-plane/test/outbound-config.test.ts`.

```ts
test("resolve outbound config includes enabled webhook targets", () => {
  // env setup then assert slack/teams/production target urls resolved
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- outbound-config.test.ts`
Expected: FAIL because files/functions do not exist.

**Step 3: Write minimal implementation**

Define target types, config parsing, strict/non-strict behavior, and notifier interface.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- outbound-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/integrations/outbound/types.ts services/control-plane/src/integrations/outbound/config.ts services/control-plane/src/integrations/outbound/notifier.ts services/control-plane/test/outbound-config.test.ts
git commit -m "feat: add outbound webhook configuration and notifier contracts"
```

### Task 2: Implement payload mapping and signature generation

**Files:**
- Create: `services/control-plane/src/integrations/outbound/payload-mapper.ts`
- Create: `services/control-plane/src/integrations/outbound/signing.ts`
- Test: `services/control-plane/test/outbound-payload-mapper.test.ts`
- Test: `services/control-plane/test/outbound-signing.test.ts`

**Step 1: Write the failing test**

Add mapper tests by target and signature determinism tests.

```ts
test("maps outbox item to slack payload envelope", () => {
  expect(payload.target).toBe("slack");
});

test("buildSignature creates deterministic hmac header", () => {
  expect(signature).toMatch(/^sha256=/);
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- outbound-payload-mapper.test.ts outbound-signing.test.ts`
Expected: FAIL due to missing modules.

**Step 3: Write minimal implementation**

Implement normalized outbound body and HMAC SHA-256 signature helper with timestamp header support.

**Step 4: Run test to verify it passes**

Run same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/integrations/outbound/payload-mapper.ts services/control-plane/src/integrations/outbound/signing.ts services/control-plane/test/outbound-payload-mapper.test.ts services/control-plane/test/outbound-signing.test.ts
git commit -m "feat: map outbound webhook payloads and add request signing"
```

### Task 3: Integrate webhook dispatch into outbox publish flow

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Modify: `services/control-plane/src/persistence/factory.ts`
- Test: `services/control-plane/test/persistence-vast-outbox.test.ts`
- Test: `services/control-plane/test/persistence-contract.test.ts`

**Step 1: Write the failing test**

Add tests asserting publish behavior:
- marks outbox item published on outbound success
- retains pending on outbound failure

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- persistence-vast-outbox.test.ts persistence-contract.test.ts`
Expected: FAIL because outbox publish does not invoke webhook notifier.

**Step 3: Write minimal implementation**

Inject notifier/config into persistence adapters and dispatch during publish pass while preserving current semantics.

**Step 4: Run test to verify it passes**

Run same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/src/persistence/factory.ts services/control-plane/test/persistence-vast-outbox.test.ts services/control-plane/test/persistence-contract.test.ts
git commit -m "feat: publish outbox events to configured webhook targets"
```

### Task 4: Add outbound delivery metrics and audit visibility

**Files:**
- Modify: `services/control-plane/src/persistence/types.ts`
- Modify: `services/control-plane/src/routes/metrics.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Test: `services/control-plane/test/metrics.test.ts`

**Step 1: Write the failing test**

Add metrics assertions for outbound counters by target (attempt/success/failure).

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- metrics.test.ts`
Expected: FAIL due to missing fields.

**Step 3: Write minimal implementation**

Add additive metrics fields and increment counters in publish path.

**Step 4: Run test to verify it passes**

Run same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/persistence/types.ts services/control-plane/src/routes/metrics.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/test/metrics.test.ts
git commit -m "feat: expose outbound integration delivery metrics"
```

### Task 5: Document additive contract and integration behavior

**Files:**
- Modify: `docs/api-contracts.md`
- Modify: `docs/architecture.md`
- Test: `tests/docs/docs-presence.test.js`

**Step 1: Write the failing test**

Add docs presence/assertions for Slice 3 outbound integration notes.

**Step 2: Run test to verify it fails**

Run: `npm run test:docs`
Expected: FAIL until docs updated.

**Step 3: Write minimal implementation**

Document webhook target model, signature headers, retry semantics, and additive metrics behavior.

**Step 4: Run test to verify it passes**

Run: `npm run test:docs`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/api-contracts.md docs/architecture.md tests/docs/docs-presence.test.js
git commit -m "docs: describe webhook outbound integration contracts and behavior"
```

### Task 6: Full verification and delivery updates

**Files:**
- Verify all modified files above

**Step 1: Write the failing test**

Run targeted suites and capture failures.

**Step 2: Run test to verify it fails (if regressions exist)**

Run:
- `npm --prefix services/control-plane test`
- `npm --prefix services/control-plane run test:contracts`
- `npm run test:web-ui`

**Step 3: Write minimal implementation**

Fix only regressions with smallest additive changes.

**Step 4: Run test to verify it passes**

Run:
- `npm run test:all`

Expected: PASS with zero failures.

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify slice 3 outbound webhook integrations end-to-end"
```

### Task 7: PR + Linear evidence updates

**Files:**
- Modify: PR #12 comments/description
- Modify: Linear SERGIO-63 comments/status

**Step 1: Write the failing test**

Draft status update and check for missing proof (scope + verification evidence).

**Step 2: Run test to verify it fails**

Confirm draft is missing links or test counts.

**Step 3: Write minimal implementation**

Post PR and Linear updates with:
- scope delivered
- risk/additivity statement
- `npm run test:all` evidence

**Step 4: Run test to verify it passes**

Confirm comment links resolve and content is accurate.

**Step 5: Commit**

No code commit required unless local docs changed after verification.
