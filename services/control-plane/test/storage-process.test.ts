import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

describe("POST /api/v1/storage/process", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("returns 400 when sourceUri is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 on malformed s3:// URI", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://" },
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "INVALID_SOURCE_URI");
  });

  it("returns 415 for unsupported file kinds (pdf)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/notes.pdf" },
    });
    assert.equal(res.statusCode, 415);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "FILE_KIND_NOT_SUPPORTED");
  });

  it("returns 503 when no S3 endpoints are configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/shot.mov" },
    });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "STORAGE_NOT_CONFIGURED");
  });

  it("accepts video file kinds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/clip.mov" },
    });
    // 503 = storage not configured (expected in test env), NOT 415
    assert.notEqual(res.statusCode, 415);
  });

  it("accepts image file kinds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/shot.exr" },
    });
    assert.notEqual(res.statusCode, 415);
  });

  it("accepts raw camera file kinds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/take01.r3d" },
    });
    assert.notEqual(res.statusCode, 415);
  });

  it("is accessible on the legacy prefix", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/storage/process",
      headers: { "content-type": "application/json" },
      payload: { sourceUri: "s3://bucket/shot.mov" },
    });
    assert.notEqual(res.statusCode, 404);
  });
});
