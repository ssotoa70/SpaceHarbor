import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

// Disable IAM for unit tests so storage routes are accessible without auth
process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

/**
 * Integration tests for GET /storage/metadata.
 *
 * These tests don't (and must not) hit real S3 — they rely on the
 * deterministic behavior of the route with no configured storage endpoints
 * (503) or with malformed inputs (400 / 415). Tests that exercise the
 * happy path with mocked S3 live in sidecar-fetcher.test.ts.
 */
describe("GET /api/v1/storage/metadata", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("returns 400 when sourceUri is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/storage/metadata" });
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when sourceUri is malformed s3://", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://"),
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "INVALID_SOURCE_URI");
  });

  it("returns 415 for unsupported file kinds (pdf, html)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/notes.pdf"),
    });
    assert.equal(res.statusCode, 415);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "FILE_KIND_NOT_SUPPORTED");
  });

  it("returns 415 for files without an extension", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/README"),
    });
    assert.equal(res.statusCode, 415);
  });

  it("returns 503 when no storage endpoints are configured (even for valid video URI)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/footage/shot.mov"),
    });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "STORAGE_NOT_CONFIGURED");
  });

  it("accepts raw camera formats as supported file kinds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/A001_001.R3D"),
    });
    // Should not be 415 — raw_camera is a supported kind. Will be 503
    // because no endpoints are configured in the test app.
    assert.notEqual(res.statusCode, 415);
    assert.equal(res.statusCode, 503);
  });

  it("accepts image formats as supported file kinds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/shot.0042.exr"),
    });
    assert.notEqual(res.statusCode, 415);
  });

  it("accepts the legacy prefix path /storage/metadata as well", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/storage/metadata?sourceUri=" + encodeURIComponent("s3://bucket/shot.mov"),
    });
    // Route exists on the legacy prefix — returns 503 (no storage) not 404.
    assert.notEqual(res.statusCode, 404);
  });
});
