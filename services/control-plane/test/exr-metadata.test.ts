import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

describe("EXR Metadata Routes", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe("GET /api/v1/exr-metadata/files", () => {
    it("returns 503 when Trino is not configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/exr-metadata/files",
      });
      assert.equal(res.statusCode, 503);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "TRINO_UNAVAILABLE");
    });
  });

  describe("GET /api/v1/exr-metadata/files/:fileId", () => {
    it("returns 503 when Trino is not configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/exr-metadata/files/test-file-id",
      });
      assert.equal(res.statusCode, 503);
    });
  });

  describe("GET /api/v1/exr-metadata/lookup", () => {
    it("returns 503 when Trino is not configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/exr-metadata/lookup?path=/test/file.exr",
      });
      assert.equal(res.statusCode, 503);
    });
  });

  describe("GET /api/v1/exr-metadata/stats", () => {
    it("returns 503 when Trino is not configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/exr-metadata/stats",
      });
      assert.equal(res.statusCode, 503);
    });
  });
});
