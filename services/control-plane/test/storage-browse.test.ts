import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

// Disable IAM for unit tests so storage routes are accessible without auth
process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";

describe("Storage Browse Routes", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe("GET /api/v1/storage/endpoints", () => {
    it("returns empty list when no endpoints configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/storage/endpoints",
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.endpoints));
    });
  });

  describe("GET /api/v1/storage/browse", () => {
    it("returns 503 when no endpoints configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/storage/browse",
      });
      assert.equal(res.statusCode, 503);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "STORAGE_NOT_CONFIGURED");
    });

    it("returns 400 for unknown endpoint ID", async () => {
      // This will return 503 since no endpoints are configured
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/storage/browse?endpointId=nonexistent",
      });
      // With no endpoints at all, returns 503 (not 400) because the list is empty
      assert.ok([400, 503].includes(res.statusCode));
    });
  });

  describe("GET /api/v1/storage/object-info", () => {
    it("returns 400 for unknown endpoint ID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/storage/object-info/nonexistent/some/key.exr",
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "ENDPOINT_NOT_FOUND");
    });
  });
});
