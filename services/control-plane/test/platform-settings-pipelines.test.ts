import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

// Test setup matches other platform-settings integration tests — disable IAM
// so the /platform/settings routes are reachable without an admin bearer.
process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";
import type { DataEnginePipelineConfig } from "../src/data-engine/pipeline-config.js";

const frameConfig: DataEnginePipelineConfig = {
  fileKind: "image",
  functionName: "frame-metadata-extractor",
  extensions: [".exr", ".dpx", ".tif"],
  targetSchema: "frame_metadata",
  targetTable: "frames",
  sidecarSchemaId: "frame@1",
  displayLabel: "Frame Metadata",
};

const videoConfig: DataEnginePipelineConfig = {
  fileKind: "video",
  functionName: "video-metadata-extractor",
  extensions: [".mp4", ".mov", ".mxf"],
  targetSchema: "video_metadata",
  targetTable: "files",
  sidecarSchemaId: "video@1",
};

describe("PUT /platform/settings dataEnginePipelines", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Reset to empty so each test starts from a clean slate
    await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: { dataEnginePipelines: [] },
    });
  });

  it("GET returns an empty list when nothing configured", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/platform/settings" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.dataEnginePipelines, []);
  });

  it("PUT accepts a two-pipeline config and GET returns it verbatim", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: { dataEnginePipelines: [frameConfig, videoConfig] },
    });
    assert.equal(put.statusCode, 200, `PUT failed: ${put.body}`);

    const get = await app.inject({ method: "GET", url: "/api/v1/platform/settings" });
    assert.equal(get.statusCode, 200);
    const body = JSON.parse(get.body);
    assert.equal(body.dataEnginePipelines.length, 2);
    assert.equal(body.dataEnginePipelines[0].functionName, "frame-metadata-extractor");
    assert.equal(body.dataEnginePipelines[1].functionName, "video-metadata-extractor");
    assert.deepEqual(body.dataEnginePipelines[0].extensions, [".exr", ".dpx", ".tif"]);
  });

  it("PUT normalizes extension case to lowercase", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [{ ...frameConfig, extensions: [".EXR", ".DPX"] }],
      },
    });
    assert.equal(put.statusCode, 200);
    const get = await app.inject({ method: "GET", url: "/api/v1/platform/settings" });
    const body = JSON.parse(get.body);
    assert.deepEqual(body.dataEnginePipelines[0].extensions, [".exr", ".dpx"]);
  });

  it("PUT returns 400 on invalid fileKind (caught by Fastify schema)", async () => {
    // Shape errors (type/enum/required) are caught by Fastify's JSON-schema
    // validator before my custom validator runs — the error message comes
    // from Fastify in that case. Both layers combined give full coverage:
    // Fastify catches malformed shape, my validator catches semantic
    // cross-entry invariants (see the dup-fileKind test below).
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [{ ...frameConfig, fileKind: "bogus" }],
      },
    });
    assert.equal(put.statusCode, 400);
    const body = JSON.parse(put.body);
    // Accept either Fastify's generic "must be equal to one of the allowed values"
    // or my custom "fileKind must be one of" message.
    assert.match(body.message, /fileKind|allowed values/);
  });

  it("PUT returns 400 on malformed extension (caught by Fastify schema pattern)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [{ ...frameConfig, extensions: ["no-leading-dot"] }],
      },
    });
    assert.equal(put.statusCode, 400);
  });

  it("PUT returns 400 on duplicate fileKind entries", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [frameConfig, { ...frameConfig, functionName: "other" }],
      },
    });
    assert.equal(put.statusCode, 400);
    const body = JSON.parse(put.body);
    assert.match(body.message, /duplicate pipeline for fileKind=image/);
  });

  it("PUT returns 400 on extension conflict between pipelines", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: {
        dataEnginePipelines: [
          frameConfig,
          { ...videoConfig, extensions: [".exr", ".mp4"] },
        ],
      },
    });
    assert.equal(put.statusCode, 400);
    const body = JSON.parse(put.body);
    assert.match(body.message, /claimed by both fileKind=image and fileKind=video/);
  });

  it("PUT leaves existing pipelines untouched when the field is absent", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: { dataEnginePipelines: [frameConfig] },
    });
    // Now PUT a body with no dataEnginePipelines field at all
    await app.inject({
      method: "PUT",
      url: "/api/v1/platform/settings",
      headers: { "content-type": "application/json" },
      payload: { vastEventBroker: { brokerUrl: null, topic: null } },
    });
    const get = await app.inject({ method: "GET", url: "/api/v1/platform/settings" });
    const body = JSON.parse(get.body);
    assert.equal(body.dataEnginePipelines.length, 1);
    assert.equal(body.dataEnginePipelines[0].functionName, "frame-metadata-extractor");
  });
});
