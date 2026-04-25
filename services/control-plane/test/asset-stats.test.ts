import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAssetStatsRoute } from "../src/routes/asset-stats.js";
import type { PersistenceAdapter } from "../src/persistence/types.js";

function mkApp(stats: unknown, throwErr?: Error) {
  const app = Fastify();
  const persistence = {
    getAssetStats: async () => {
      if (throwErr) throw throwErr;
      return stats;
    }
  } as unknown as PersistenceAdapter;
  registerAssetStatsRoute(app, persistence, ["/api/v1"]);
  return app;
}

test("asset-stats: empty catalog — all counters 0", async () => {
  const app = mkApp({
    total: 0,
    byStatus: {},
    byKind: {},
    integrity: { hashed: 0, withKeyframes: 0 }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/stats" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.total, 0);
  assert.deepEqual(body.integrity, { hashed: 0, with_keyframes: 0 });
  await app.close();
});

test("asset-stats: populated catalog + empty integrity — counts match fixtures", async () => {
  const app = mkApp({
    total: 25,
    byStatus: { pending: 5, processed: 20 },
    byKind: { image: 15, video: 10 },
    integrity: { hashed: 0, withKeyframes: 0 }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/stats" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.total, 25);
  assert.deepEqual(body.byStatus, { pending: 5, processed: 20 });
  assert.deepEqual(body.byKind, { image: 15, video: 10 });
  assert.equal((body.integrity as Record<string, number>).hashed, 0);
  await app.close();
});

test("asset-stats: integrity populated — counter reflects row count", async () => {
  const app = mkApp({
    total: 3,
    byStatus: { processed: 3 },
    byKind: { video: 3 },
    integrity: { hashed: 3, withKeyframes: 2 }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/stats" });
  const body = res.json() as Record<string, unknown>;
  const integrity = body.integrity as Record<string, number>;
  assert.equal(integrity.hashed, 3);
  assert.equal(integrity.with_keyframes, 2);
  await app.close();
});

test("asset-stats: DB unreachable — 503 DB_UNREACHABLE", async () => {
  const app = mkApp(null, new Error("VAST DB unreachable"));
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/stats" });
  assert.equal(res.statusCode, 503);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.code, "DB_UNREACHABLE");
  await app.close();
});

test("asset-stats: response shape — exact top-level keys", async () => {
  const app = mkApp({
    total: 0,
    byStatus: {},
    byKind: {},
    integrity: { hashed: 0, withKeyframes: 0 }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/stats" });
  const body = res.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["byKind", "byStatus", "integrity", "total"]);
  assert.deepEqual(
    Object.keys(body.integrity as Record<string, unknown>).sort(),
    ["hashed", "with_keyframes"]
  );
  await app.close();
});
