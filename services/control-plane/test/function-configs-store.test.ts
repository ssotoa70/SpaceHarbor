import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createFunctionConfigsStore,
  ValidationError,
  NotFoundError,
  type StoreDeps,
} from "../src/config/function-configs-store.js";

function mkDeps(rows: any[] = []): StoreDeps & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    queryScope: mock.fn(async (scope: string) => {
      calls.push({ type: "queryScope", scope });
      return rows.filter((r) => r.scope === scope);
    }),
    upsertValue: mock.fn(async (row: any) => {
      calls.push({ type: "upsertValue", ...row });
      const idx = rows.findIndex((r) => r.scope === row.scope && r.key === row.key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
    }),
  };
}

test("getScope empty: returns [] and reads DB once", async () => {
  const deps = mkDeps([]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  const r1 = await store.getScope("asset-integrity");
  const r2 = await store.getScope("asset-integrity");
  assert.deepEqual(r1, []);
  assert.deepEqual(r2, []);
  assert.equal(deps.calls.filter((c) => c.type === "queryScope").length, 1);
});

test("getScope with rows: returns typed shape + caches", async () => {
  const deps = mkDeps([
    { scope: "asset-integrity", key: "k1", value_type: "int",
      value_json: "5", default_json: "4", min_json: "1", max_json: "10",
      description: "d", label: "L", category: "Hashing",
      last_edited_by: null, last_edited_at: null },
  ]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  const r = await store.getScope("asset-integrity");
  assert.equal(r.length, 1);
  assert.equal(r[0].value, 5);
  assert.equal(r[0].default, 4);
  assert.equal(r[0].min, 1);
  assert.equal(r[0].max, 10);
  await store.getScope("asset-integrity");
  assert.equal(deps.calls.filter((c) => c.type === "queryScope").length, 1);
});

test("setValue valid int: writes, bumps metadata, invalidates cache", async () => {
  const deps = mkDeps([
    { scope: "asset-integrity", key: "k", value_type: "int",
      value_json: "5", default_json: "4", min_json: "1", max_json: "10",
      description: "d", label: "L", category: "H",
      last_edited_by: null, last_edited_at: null },
  ]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  await store.getScope("asset-integrity"); // warm cache
  await store.setValue("asset-integrity", "k", 7, "admin@example.com");
  const upsert = deps.calls.find((c) => c.type === "upsertValue");
  assert.equal(upsert.scope, "asset-integrity");
  assert.equal(upsert.key, "k");
  assert.equal(upsert.value_json, "7");
  assert.equal(upsert.last_edited_by, "admin@example.com");
  // read after write hits DB again (cache was invalidated)
  await store.getScope("asset-integrity");
  assert.equal(deps.calls.filter((c) => c.type === "queryScope").length, 2);
});

test("setValue out-of-range: throws ValidationError, no DB write", async () => {
  const deps = mkDeps([
    { scope: "asset-integrity", key: "k", value_type: "int",
      value_json: "5", default_json: "4", min_json: "1", max_json: "10",
      description: "d", label: "L", category: "H",
      last_edited_by: null, last_edited_at: null },
  ]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  await assert.rejects(() => store.setValue("asset-integrity", "k", 99, "a@x"), ValidationError);
  assert.equal(deps.calls.filter((c) => c.type === "upsertValue").length, 0);
});

test("setValue wrong type: rejects", async () => {
  const deps = mkDeps([
    { scope: "asset-integrity", key: "k", value_type: "int",
      value_json: "5", default_json: "4", min_json: "1", max_json: "10",
      description: "d", label: "L", category: "H",
      last_edited_by: null, last_edited_at: null },
  ]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  await assert.rejects(() => store.setValue("asset-integrity", "k", "seven" as any, "a@x"), ValidationError);
});

test("setValue unknown key: throws NotFoundError", async () => {
  const deps = mkDeps([]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  await assert.rejects(() => store.setValue("asset-integrity", "nope", 1, "a@x"), NotFoundError);
});

test("resetToDefault: writes default_json as current, invalidates cache", async () => {
  const deps = mkDeps([
    { scope: "asset-integrity", key: "k", value_type: "int",
      value_json: "9", default_json: "4", min_json: "1", max_json: "10",
      description: "d", label: "L", category: "H",
      last_edited_by: "x", last_edited_at: "2026-04-19T00:00:00Z" },
  ]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 60_000 });
  await store.resetToDefault("asset-integrity", "k", "admin@x");
  const upsert = deps.calls.find((c) => c.type === "upsertValue");
  assert.equal(upsert.value_json, "4");
});

test("cache expiry after TTL: re-queries DB", async () => {
  const deps = mkDeps([]);
  const store = createFunctionConfigsStore(deps, { cacheTtlMs: 10, clock: { now: () => Date.now() } });
  await store.getScope("asset-integrity");
  await new Promise((r) => setTimeout(r, 20));
  await store.getScope("asset-integrity");
  assert.equal(deps.calls.filter((c) => c.type === "queryScope").length, 2);
});
