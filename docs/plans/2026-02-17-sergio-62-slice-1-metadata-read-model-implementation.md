# SERGIO-62 Slice 1 Metadata Read Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add additive `productionMetadata` to assets queue read models while keeping ingest, worker, and event contracts unchanged.

**Architecture:** Extend queue row domain types with a nested `productionMetadata` object and initialize/coalesce defaults in persistence. Add explicit route schema metadata for `GET /assets` and `GET /api/v1/assets` so OpenAPI captures the new additive shape. Preserve `POST /api/v1/assets/ingest` and worker/event payload contracts exactly as-is.

**Tech Stack:** TypeScript, Fastify, Node test runner, OpenAPI schema metadata.

---

### Task 1: Add Production Metadata Type and Persistence Defaulting

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Test: `services/control-plane/test/assets-audit.test.ts`

**Step 1: Write the failing test**

In `services/control-plane/test/assets-audit.test.ts`, add assertions that the first row from `GET /assets` includes `productionMetadata` with stable keys and null-first defaults:

```ts
assert.deepEqual(Object.keys(body.assets[0].productionMetadata).sort(), [
  "dueDate",
  "episode",
  "owner",
  "priority",
  "sequence",
  "shot",
  "show",
  "vendor",
  "version"
]);
assert.equal(body.assets[0].productionMetadata.show, null);
assert.equal(body.assets[0].productionMetadata.priority, null);
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts`
Expected: FAIL because `productionMetadata` does not exist.

**Step 3: Write minimal implementation**

In `services/control-plane/src/domain/models.ts`, add:

```ts
export type AssetPriority = "low" | "normal" | "high" | "urgent";

export interface ProductionMetadata {
  show: string | null;
  episode: string | null;
  sequence: string | null;
  shot: string | null;
  version: number | null;
  vendor: string | null;
  priority: AssetPriority | null;
  dueDate: string | null;
  owner: string | null;
}
```

Update `AssetQueueRow` to include `productionMetadata: ProductionMetadata`.

In `services/control-plane/src/persistence/adapters/local-persistence.ts`, add a single metadata default factory and apply it in:
- ingest write path (store initial metadata per asset id),
- assets read path (coalesce legacy/missing metadata).

Keep `Asset` and `IngestResult` unchanged.

In `services/control-plane/src/persistence/adapters/vast-persistence.ts`, keep delegation path parity through local fallback unchanged.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/domain/models.ts services/control-plane/src/persistence/adapters/local-persistence.ts services/control-plane/src/persistence/adapters/vast-persistence.ts services/control-plane/test/assets-audit.test.ts
git commit -m "feat: add queue read-model production metadata defaults"
```

### Task 2: Add Explicit Assets Route Schema and OpenAPI Coverage

**Files:**
- Modify: `services/control-plane/src/http/schemas.ts`
- Modify: `services/control-plane/src/routes/assets.ts`
- Test: `services/control-plane/test/openapi-contract.test.ts`

**Step 1: Write the failing test**

In `services/control-plane/test/openapi-contract.test.ts`, add assertions that:
- `/api/v1/assets` exists in required OpenAPI paths,
- `GET /api/v1/assets` has operation metadata,
- response schema includes `productionMetadata` object under `assets.items`.

Example assertion:

```ts
const operation = body.paths?.["/api/v1/assets"]?.get;
assert.ok(operation, "missing GET /api/v1/assets operation");
const rowSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.assets?.items;
assert.ok(rowSchema?.properties?.productionMetadata, "missing productionMetadata schema");
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/openapi-contract.test.ts`
Expected: FAIL because assets route schema metadata is missing.

**Step 3: Write minimal implementation**

In `services/control-plane/src/http/schemas.ts`, add:

```ts
export const productionMetadataSchema = {
  type: "object",
  required: ["show", "episode", "sequence", "shot", "version", "vendor", "priority", "dueDate", "owner"],
  properties: {
    show: { anyOf: [{ type: "string" }, { type: "null" }] },
    episode: { anyOf: [{ type: "string" }, { type: "null" }] },
    sequence: { anyOf: [{ type: "string" }, { type: "null" }] },
    shot: { anyOf: [{ type: "string" }, { type: "null" }] },
    version: { anyOf: [{ type: "number" }, { type: "null" }] },
    vendor: { anyOf: [{ type: "string" }, { type: "null" }] },
    priority: { anyOf: [{ type: "string", enum: ["low", "normal", "high", "urgent"] }, { type: "null" }] },
    dueDate: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    owner: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
} as const;
```

Then add `assetQueueRowSchema` and `assetsResponseSchema` using `productionMetadataSchema`.

In `services/control-plane/src/routes/assets.ts`, register `schema` metadata for each route prefix with:
- `tags: ["assets"]`
- operationId (`v1ListAssets` for `/api/v1`, `legacyListAssets` for legacy path)
- response `200: assetsResponseSchema`

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/openapi-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/src/http/schemas.ts services/control-plane/src/routes/assets.ts services/control-plane/test/openapi-contract.test.ts
git commit -m "test: lock assets list schema and OpenAPI metadata"
```

### Task 3: Add Contract Non-Regression Test for Ingest Shape

**Files:**
- Modify: `services/control-plane/test/api-v1-contracts.test.ts`

**Step 1: Write the failing test**

In `services/control-plane/test/api-v1-contracts.test.ts`, strengthen ingest success assertions so keys are pinned and cannot drift:

```ts
assert.deepEqual(Object.keys(body.asset).sort(), ["createdAt", "id", "sourceUri", "title"]);
assert.deepEqual(Object.keys(body.job).sort(), [
  "assetId",
  "attemptCount",
  "createdAt",
  "id",
  "lastError",
  "leaseExpiresAt",
  "leaseOwner",
  "maxAttempts",
  "nextAttemptAt",
  "status",
  "updatedAt"
]);
```

Intention: fail if `productionMetadata` leaks into ingest response.

**Step 2: Run test to verify it fails first (if implementation drift exists)**

Run: `npm --prefix services/control-plane test -- test/api-v1-contracts.test.ts`
Expected: Initially may PASS; if PASS, keep assertions as regression lock and continue.

**Step 3: Implement only if needed**

If test fails due to ingest drift, remove metadata from ingest response path by keeping `Asset`/`IngestResult` unchanged and only attaching metadata in `listAssetQueueRows()`.

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/api-v1-contracts.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/control-plane/test/api-v1-contracts.test.ts
git commit -m "test: pin ingest v1 response shape non-regression"
```

### Task 4: Update API Contract Docs for Additive Queue Metadata

**Files:**
- Modify: `docs/api-contracts.md`

**Step 1: Write docs expectation or target text first**

Add a new queue response snippet under `GET /api/v1/assets` that includes nested `productionMetadata` and clearly states this slice is read-model exposure only.

Example snippet:

```json
{
  "assets": [
    {
      "id": "uuid",
      "jobId": "uuid",
      "title": "Queue Asset",
      "sourceUri": "s3://bucket/queue-asset.mov",
      "status": "pending",
      "productionMetadata": {
        "show": null,
        "episode": null,
        "sequence": null,
        "shot": null,
        "version": null,
        "vendor": null,
        "priority": null,
        "dueDate": null,
        "owner": null
      }
    }
  ]
}
```

**Step 2: Run docs tests**

Run: `npm run test:docs`
Expected: PASS.

**Step 3: Commit**

```bash
git add docs/api-contracts.md
git commit -m "docs: describe additive queue production metadata contract"
```

### Task 5: Final Verification Gate

**Files:**
- Modify: none
- Test: focused and full verification commands

**Step 1: Run focused control-plane suites**

Run: `npm --prefix services/control-plane test -- test/assets-audit.test.ts test/openapi-contract.test.ts test/api-v1-contracts.test.ts`
Expected: PASS.

**Step 2: Run contract suite**

Run: `npm run test:contracts`
Expected: PASS.

**Step 3: Run full repository validation**

Run: `npm run test:all`
Expected: PASS.

**Step 4: Verify workspace hygiene before handoff**

Run: `npm run check:workspace`
Expected: PASS.

**Step 5: Commit verification checkpoint**

```bash
git status
```

Expected: clean working tree (or only intentionally deferred artifacts).
