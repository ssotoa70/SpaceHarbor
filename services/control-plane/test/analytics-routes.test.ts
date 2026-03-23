import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

describe("Analytics routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("GET /api/v1/analytics/assets", () => {
    it("returns 200 with correct shape", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/assets" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.totalAssets === "number");
      assert.ok(Array.isArray(body.byStatus));
      assert.ok(Array.isArray(body.byMediaType));
      assert.ok(Array.isArray(body.topAccessed));
      assert.ok(typeof body.range === "string");
      assert.ok(typeof body.cachedAt === "string");
    });

    it("accepts range=24h", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/assets?range=24h" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.range, "24h");
    });

    it("accepts range=30d", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/assets?range=30d" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.range, "30d");
    });

    it("returns 400 for invalid range", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/assets?range=invalid" });
      assert.equal(res.statusCode, 400);
    });

    it("cache returns same cachedAt on second call", async () => {
      const res1 = await app.inject({ method: "GET", url: "/api/v1/analytics/assets?range=7d" });
      const body1 = JSON.parse(res1.body);
      const res2 = await app.inject({ method: "GET", url: "/api/v1/analytics/assets?range=7d" });
      const body2 = JSON.parse(res2.body);
      assert.equal(body1.cachedAt, body2.cachedAt);
    });
  });

  describe("GET /api/v1/analytics/pipeline", () => {
    it("returns 200 with correct shape", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/pipeline" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.completionRate === "number");
      assert.ok(typeof body.throughputPerHour === "number");
      assert.ok(typeof body.dlqSize === "number");
      assert.ok(Array.isArray(body.jobsByStatus));
      assert.ok(typeof body.cachedAt === "string");
    });
  });

  describe("GET /api/v1/analytics/storage", () => {
    it("returns 200 with correct shape", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/storage" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.totalBytes === "number");
      assert.ok(Array.isArray(body.byMediaType));
      assert.ok(typeof body.cachedAt === "string");
    });
  });

  describe("GET /api/v1/analytics/render", () => {
    it("returns 200 with correct shape", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/analytics/render" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.totalCoreHours === "number");
      assert.ok(typeof body.avgRenderTimeSeconds === "number");
      assert.ok(Array.isArray(body.jobsByEngine));
      assert.ok(typeof body.cachedAt === "string");
    });
  });

  describe("non-prefixed routes", () => {
    it("GET /analytics/assets also works", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/assets" });
      assert.equal(res.statusCode, 200);
    });
  });
});
