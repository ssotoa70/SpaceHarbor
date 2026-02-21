# SERGIO-63 Slice 2 Proxy/Thumbnail Annotation Hooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add additive proxy/thumbnail metadata and annotation-ready hook fields to existing API/UI surfaces with no breaking contract changes.

**Architecture:** Extend existing read-model schemas and response payloads with nullable preview metadata and annotation hook fields, then render these states in the web UI. Keep generation/integration logic out of scope and use default-safe null/disabled values.

**Tech Stack:** TypeScript, Fastify, React, Node test runner, Vitest

---

### Task 1: Extend domain/read models with preview and annotation hook metadata

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/persistence/types.ts`
- Test: `services/control-plane/test/persistence-contract.test.ts`

**Step 1: Write the failing test**

Add assertions in `services/control-plane/test/persistence-contract.test.ts` that an asset row/job includes:

```ts
expect(row.thumbnail).toEqual(null);
expect(row.proxy).toEqual(null);
expect(row.annotationHook).toEqual({ enabled: false, provider: null, contextId: null });
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- persistence-contract.test.ts`
Expected: FAIL because fields do not exist yet.

**Step 3: Write minimal implementation**

Add optional/null-safe metadata types and fields to model + persistence interfaces.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- persistence-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/domain/models.ts services/control-plane/src/persistence/types.ts services/control-plane/test/persistence-contract.test.ts
git commit -m "feat: add preview and annotation hook metadata types"
```

### Task 2: Project new metadata fields through API responses

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/routes/assets.ts`
- Modify: `services/control-plane/src/routes/jobs.ts`
- Test: `services/control-plane/test/assets-audit.test.ts`
- Test: `services/control-plane/test/api-v1-contracts.test.ts`

**Step 1: Write the failing test**

Add API tests asserting `GET /api/v1/assets` and `GET /api/v1/jobs/:id` include `thumbnail`, `proxy`, `annotationHook` with default values.

**Step 2: Run test to verify it fails**

Run:
- `npm --prefix services/control-plane test -- assets-audit.test.ts`
- `npm --prefix services/control-plane run test:contracts -- api-v1-contracts.test.ts`

Expected: FAIL until projection includes new fields.

**Step 3: Write minimal implementation**

Update local adapter and route response mapping to include new metadata fields with null/disabled defaults.

**Step 4: Run test to verify it passes**

Run same commands as Step 2.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/routes/assets.ts services/control-plane/src/routes/jobs.ts services/control-plane/test/assets-audit.test.ts services/control-plane/test/api-v1-contracts.test.ts
git commit -m "feat: expose preview and annotation metadata in v1 responses"
```

### Task 3: Update OpenAPI schemas and event-safe contract docs

**Files:**
- Modify: `services/control-plane/src/http/schemas.ts`
- Test: `services/control-plane/test/openapi-contract.test.ts`
- Modify: `docs/api-contracts.md`

**Step 1: Write the failing test**

Add OpenAPI assertions for new optional fields in assets/jobs response schemas:

```ts
expect(assetSchema.properties.thumbnail).toBeDefined();
expect(assetSchema.properties.proxy).toBeDefined();
expect(assetSchema.properties.annotationHook).toBeDefined();
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane run test:contracts -- openapi-contract.test.ts`
Expected: FAIL until schema fields exist.

**Step 3: Write minimal implementation**

Add optional schema objects for `thumbnail`, `proxy`, `annotationHook` and update docs with additive compatibility note.

**Step 4: Run test to verify it passes**

Run same contract command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/http/schemas.ts services/control-plane/test/openapi-contract.test.ts docs/api-contracts.md
git commit -m "docs: publish additive preview and annotation hook contracts"
```

### Task 4: Render preview/hook states in web UI

**Files:**
- Modify: `services/web-ui/src/api.ts`
- Modify: `services/web-ui/src/App.tsx`
- Modify: `services/web-ui/src/App.test.tsx`

**Step 1: Write the failing test**

Add UI tests for:
- row with null metadata shows `Preview not available`
- row with proxy/thumbnail shows `Preview metadata available`
- annotation action visible only when `annotationHook.enabled` is true

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/web-ui test -- App.test.tsx`
Expected: FAIL with missing render behavior.

**Step 3: Write minimal implementation**

Extend `AssetRow` type in API client and render preview/hook status in queue row details/actions.

**Step 4: Run test to verify it passes**

Run same UI test command.
Expected: PASS.

**Step 5: Commit**

```bash
git add services/web-ui/src/api.ts services/web-ui/src/App.tsx services/web-ui/src/App.test.tsx
git commit -m "feat: surface preview and annotation hook readiness in web ui"
```

### Task 5: Full regression verification and cleanup

**Files:**
- Verify all modified files

**Step 1: Write the failing test**

Run targeted checks first; record any regressions.

**Step 2: Run test to verify it fails (if any regression exists)**

Run:
- `npm --prefix services/control-plane run test:contracts`
- `npm --prefix services/control-plane test`
- `npm --prefix services/web-ui test`

Expected: identify remaining issues.

**Step 3: Write minimal implementation**

Fix only failing assertions/contract mismatches.

**Step 4: Run test to verify it passes**

Run:
- `npm run test:all`

Expected: PASS with 0 failures.

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify slice 2 proxy thumbnail annotation hooks regression gate"
```

### Task 6: PR + Linear updates with evidence

**Files:**
- Modify: PR description/comments
- Modify: Linear SERGIO-63 comments/status

**Step 1: Write the failing test**

Draft update lacking verification evidence and identify missing data.

**Step 2: Run test to verify it fails**

Check that draft includes: scope, additive contract note, and full test evidence.

**Step 3: Write minimal implementation**

Post updates with exact verification commands and pass counts.

**Step 4: Run test to verify it passes**

Confirm comments are posted and links valid.

**Step 5: Commit**

No code commit needed unless local docs were modified.
