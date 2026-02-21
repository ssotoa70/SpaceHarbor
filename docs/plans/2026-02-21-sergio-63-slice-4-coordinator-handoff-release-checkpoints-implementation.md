# SERGIO-63 Slice 4 Coordinator Handoff and Release Checkpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add coordinator handoff readiness gates, release communication templates, and post-release verification checkpoints without breaking existing workflow contracts.

**Architecture:** Extend existing read models and API schemas additively with handoff metadata, then render coordinator-focused handoff controls in the queue UI for `qc_approved` rows only. Keep all release communication and verification artifacts as docs/templates with linkable UI references.

**Tech Stack:** TypeScript, Fastify, React, Node test runner, Vitest

---

### Task 1: Add handoff metadata types and default model values

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/persistence/types.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Test: `services/control-plane/test/persistence-contract.test.ts`

**Step 1: Write the failing test**

Add persistence assertions for default handoff fields:

```ts
assert.deepEqual(job.handoffChecklist, {
  releaseNotesReady: false,
  verificationComplete: false,
  commsDraftReady: false,
  ownerAssigned: false
});
assert.deepEqual(job.handoff, {
  status: "not_ready",
  owner: null,
  lastUpdatedAt: null
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- persistence-contract.test.ts`
Expected: FAIL due to missing fields.

**Step 3: Write minimal implementation**

Add additive handoff metadata types and defaults in local persistence object creation/projection.

**Step 4: Run test to verify it passes**

Run same test command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/domain/models.ts services/control-plane/src/persistence/types.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/test/persistence-contract.test.ts
git commit -m "feat: add coordinator handoff metadata defaults"
```

### Task 2: Expose handoff metadata through API and OpenAPI schemas

**Files:**
- Modify: `services/control-plane/src/http/schemas.ts`
- Modify: `services/control-plane/src/routes/assets.ts`
- Modify: `services/control-plane/src/routes/jobs.ts`
- Test: `services/control-plane/test/api-v1-contracts.test.ts`
- Test: `services/control-plane/test/openapi-contract.test.ts`

**Step 1: Write the failing test**

Add contract assertions for `handoffChecklist` and `handoff` in assets/jobs responses and OpenAPI schema.

**Step 2: Run test to verify it fails**

Run:
- `npm --prefix services/control-plane run test:contracts -- api-v1-contracts.test.ts`
- `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`

Expected: FAIL until schemas/route outputs include fields.

**Step 3: Write minimal implementation**

Add optional/additive schema blocks and ensure route response models include handoff metadata.

**Step 4: Run test to verify it passes**

Run same commands.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/http/schemas.ts services/control-plane/src/routes/assets.ts services/control-plane/src/routes/jobs.ts services/control-plane/test/api-v1-contracts.test.ts services/control-plane/test/openapi-contract.test.ts
git commit -m "feat: expose handoff metadata in v1 api contracts"
```

### Task 3: Add coordinator handoff UX and readiness gating in web UI

**Files:**
- Modify: `services/web-ui/src/api.ts`
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add tests for `qc_approved` rows:
- handoff panel visible
- release-ready action disabled with reason until checklist+owner complete
- release-ready action enabled when all conditions satisfied

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: FAIL for missing UI controls/gating.

**Step 3: Write minimal implementation**

Implement compact handoff panel and deterministic readiness helper in `App.tsx` with strict coordinator-only visibility.

**Step 4: Run test to verify it passes**

Run same test command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx
git commit -m "feat: add coordinator handoff readiness controls"
```

### Task 4: Add release communication templates and post-release checkpoints docs

**Files:**
- Modify: `docs/runbooks/release-day-checklist.md`
- Modify: `docs/wiki-2.0/Release-Process.md`
- Modify: `docs/runbook.md`
- Modify: `docs/api-contracts.md`
- Test: `tests/docs/docs-presence.test.js`

**Step 1: Write the failing test**

Add docs-presence assertions for:
- promotion/rollback/post-release templates
- T+15m and T+60m verification checkpoints

**Step 2: Run test to verify it fails**

Run: `npm run test:docs`
Expected: FAIL until docs are updated.

**Step 3: Write minimal implementation**

Add concise template sections and checkpoint bullets to runbook/release docs.

**Step 4: Run test to verify it passes**

Run: `npm run test:docs`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/runbooks/release-day-checklist.md docs/wiki-2.0/Release-Process.md docs/runbook.md docs/api-contracts.md tests/docs/docs-presence.test.js
git commit -m "docs: add release communication templates and verification checkpoints"
```

### Task 5: Full regression verification and closeout

**Files:**
- Verify all modified files above

**Step 1: Write the failing test**

Run targeted suites first and list failures.

**Step 2: Run test to verify it fails (if regressions exist)**

Run:
- `npm --prefix services/control-plane test`
- `npm --prefix services/control-plane run test:contracts`
- `npm --prefix services/web-ui test`

**Step 3: Write minimal implementation**

Fix only failing assertions/contract mismatches.

**Step 4: Run test to verify it passes**

Run:
- `npm run test:all`

Expected: PASS with 0 failures.

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify slice 4 coordinator handoff and release checkpoints"
```

### Task 6: PR + Linear updates with evidence

**Files:**
- Modify: PR #12 comments/body
- Modify: Linear SERGIO-63 comments/status

**Step 1: Write the failing test**

Draft update and check for missing scope/evidence details.

**Step 2: Run test to verify it fails**

Ensure draft includes command evidence and pass counts.

**Step 3: Write minimal implementation**

Post updates with scope summary + `npm run test:all` evidence.

**Step 4: Run test to verify it passes**

Verify links/comments are posted and accurate.

**Step 5: Commit**

No code commit needed unless docs changed during final polish.
