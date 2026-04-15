import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

describe("GET /api/v1/dataengine/pipelines/active", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Start each test with an empty pipeline list
    await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: { dataEnginePipelines: [] },
    });
  });

  it("returns empty list when no pipelines are configured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dataengine/pipelines/active",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.pipelines, []);
  });

  it("returns configured pipelines tagged as vast-unreachable when VAST is unconfigured", async () => {
    // Configure one pipeline via Settings
    await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [
          {
            fileKind: "image",
            functionName: "frame-metadata-extractor",
            extensions: [".exr"],
            targetSchema: "frame_metadata",
            targetTable: "files",
            sidecarSchemaId: "frame@1",
          },
        ],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dataengine/pipelines/active",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.pipelines.length, 1);
    assert.equal(body.pipelines[0].config.functionName, "frame-metadata-extractor");
    // VAST not configured in the test app → status should flag the issue
    assert.equal(body.pipelines[0].status, "vast-unreachable");
    assert.equal(body.pipelines[0].live, null);
    // The config data is still present so UI can render labels
    assert.deepEqual(body.pipelines[0].config.extensions, [".exr"]);
  });

  it("accepts the force query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dataengine/pipelines/active?force=true",
    });
    assert.equal(res.statusCode, 200);
  });

  it("route is also accessible on the legacy prefix", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dataengine/pipelines/active",
    });
    // Should not 404 — the legacy prefix is registered alongside /api/v1
    assert.notEqual(res.statusCode, 404);
  });
});
