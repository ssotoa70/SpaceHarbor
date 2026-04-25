import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAssetIntegrityRoute } from "../src/routes/asset-integrity.js";
import type { PersistenceAdapter, AssetIntegritySnapshot } from "../src/persistence/types.js";

function mkApp(snap: AssetIntegritySnapshot | "throw") {
  const app = Fastify();
  const persistence = {
    getAssetIntegrity: async (_id: string) => {
      if (snap === "throw") throw new Error("boom");
      return snap;
    }
  } as unknown as PersistenceAdapter;
  registerAssetIntegrityRoute(app, persistence, ["/api/v1"]);
  return app;
}

test("asset not in catalog: 404 ASSET_NOT_FOUND", async () => {
  const app = mkApp({ assetExists: false, hashes: null, keyframes: null });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/abc/integrity" });
  assert.equal(res.statusCode, 404);
  assert.equal((res.json() as { code: string }).code, "ASSET_NOT_FOUND");
  await app.close();
});

test("asset exists, no integrity: sources empty, objects null", async () => {
  const app = mkApp({ assetExists: true, hashes: null, keyframes: null });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/abc/integrity" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { sources: Record<string, string>; hashes: unknown; keyframes: unknown };
  assert.deepEqual(body.sources, { hashes: "empty", keyframes: "empty" });
  assert.equal(body.hashes, null);
  assert.equal(body.keyframes, null);
  await app.close();
});

test("hashes only: sources={hashes:ok,keyframes:empty}", async () => {
  const app = mkApp({
    assetExists: true,
    hashes: {
      sha256: "aa",
      perceptualHash: null,
      algorithmVersion: "v1",
      bytesHashed: 1,
      hashedAt: "2026-04-19T00:00:00Z"
    },
    keyframes: null
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/abc/integrity" });
  const body = res.json() as { sources: Record<string, string>; hashes: { sha256: string } };
  assert.deepEqual(body.sources, { hashes: "ok", keyframes: "empty" });
  assert.equal(body.hashes.sha256, "aa");
  await app.close();
});

test("both populated: both ok", async () => {
  const app = mkApp({
    assetExists: true,
    hashes: {
      sha256: "aa",
      perceptualHash: "pp",
      algorithmVersion: "v1",
      bytesHashed: 1,
      hashedAt: "x"
    },
    keyframes: {
      keyframeCount: 10,
      keyframePrefix: "p/",
      thumbnailKey: "k.jpg",
      extractedAt: "y"
    }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/abc/integrity" });
  const body = res.json() as { sources: Record<string, string>; keyframes: { keyframe_count: number } };
  assert.deepEqual(body.sources, { hashes: "ok", keyframes: "ok" });
  assert.equal(body.keyframes.keyframe_count, 10);
  await app.close();
});

test("DB unreachable: 503", async () => {
  const app = mkApp("throw");
  const res = await app.inject({ method: "GET", url: "/api/v1/assets/abc/integrity" });
  assert.equal(res.statusCode, 503);
  assert.equal((res.json() as { code: string }).code, "DB_UNREACHABLE");
  await app.close();
});
