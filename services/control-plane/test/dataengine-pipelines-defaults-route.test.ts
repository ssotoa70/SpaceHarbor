// services/control-plane/test/dataengine-pipelines-defaults-route.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

describe("GET /api/v1/dataengine/pipelines/defaults", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("returns the seed defaults list with the 3 standard file kinds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dataengine/pipelines/defaults",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.pipelines));
    const kinds = new Set(body.pipelines.map((p: { fileKind: string }) => p.fileKind));
    assert.ok(kinds.has("image"), "image kind present");
    assert.ok(kinds.has("video"), "video kind present");
    assert.ok(kinds.has("raw_camera"), "raw_camera kind present");
    // Each entry must conform to the DataEnginePipelineConfig shape
    for (const p of body.pipelines) {
      assert.equal(typeof p.functionName, "string");
      assert.ok(Array.isArray(p.extensions));
      assert.equal(typeof p.targetSchema, "string");
      assert.equal(typeof p.targetTable, "string");
      assert.equal(typeof p.sidecarSchemaId, "string");
    }
  });

  it("route is also accessible on the legacy prefix", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dataengine/pipelines/defaults",
    });
    assert.notEqual(res.statusCode, 404);
  });

  describe("failure modes", () => {
    let appWithFaultyLoader: FastifyInstance;
    before(async () => {
      const { __setPipelineDefaultsLoaderForTests } = await import(
        "../src/routes/dataengine-pipelines-defaults.js"
      );
      __setPipelineDefaultsLoaderForTests({
        load() { throw new Error("disk gone"); },
      });
      appWithFaultyLoader = buildApp();
      await appWithFaultyLoader.ready();
    });
    after(async () => {
      const { __setPipelineDefaultsLoaderForTests } = await import(
        "../src/routes/dataengine-pipelines-defaults.js"
      );
      __setPipelineDefaultsLoaderForTests(null);
      await appWithFaultyLoader.close();
    });

    it("returns 500 SEED_UNAVAILABLE when the loader throws", async () => {
      const res = await appWithFaultyLoader.inject({
        method: "GET",
        url: "/api/v1/dataengine/pipelines/defaults",
      });
      assert.equal(res.statusCode, 500);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "SEED_UNAVAILABLE");
      assert.match(body.message, /disk gone/);
    });
  });

  describe("validation failure", () => {
    let appWithBadSeed: FastifyInstance;
    before(async () => {
      const { __setPipelineDefaultsLoaderForTests } = await import(
        "../src/routes/dataengine-pipelines-defaults.js"
      );
      __setPipelineDefaultsLoaderForTests({
        load() { return [{ fileKind: "bogus", functionName: "x", extensions: [".x"],
                          targetSchema: "s", targetTable: "t", sidecarSchemaId: "s@1" }]; },
      });
      appWithBadSeed = buildApp();
      await appWithBadSeed.ready();
    });
    after(async () => {
      const { __setPipelineDefaultsLoaderForTests } = await import(
        "../src/routes/dataengine-pipelines-defaults.js"
      );
      __setPipelineDefaultsLoaderForTests(null);
      await appWithBadSeed.close();
    });

    it("returns 500 SEED_UNAVAILABLE when validation rejects the seed", async () => {
      const res = await appWithBadSeed.inject({
        method: "GET",
        url: "/api/v1/dataengine/pipelines/defaults",
      });
      assert.equal(res.statusCode, 500);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "SEED_UNAVAILABLE");
      assert.match(body.message, /fileKind must be one of/);
    });
  });
});
