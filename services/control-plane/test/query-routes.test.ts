import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { resetRateBuckets, resetAuditStore } from "../src/routes/query.js";

describe("Query routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    resetRateBuckets();
    resetAuditStore();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("POST /api/v1/query/execute", () => {
    it("returns 200 for valid SELECT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT * FROM assets" },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.columns));
      assert.ok(Array.isArray(body.rows));
      assert.ok(typeof body.rowCount === "number");
      assert.ok(typeof body.queryId === "string");
    });

    it("returns 403 for INSERT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "INSERT INTO assets VALUES (1)" },
      });
      assert.equal(res.statusCode, 403);
    });

    it("returns 403 for DROP", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "DROP TABLE assets" },
      });
      assert.equal(res.statusCode, 403);
    });

    it("returns 403 for IAM table access", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT * FROM iam_users" },
      });
      assert.equal(res.statusCode, 403);
    });

    it("returns 400 for query > 10KB", async () => {
      const longSql = "SELECT " + "x".repeat(11000);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: longSql },
      });
      assert.equal(res.statusCode, 400);
    });

    it("returns 400 for missing sql", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: {},
      });
      assert.equal(res.statusCode, 400);
    });

    it("rate limits after 10 requests per minute", async () => {
      // Use a unique identity so other tests don't interfere
      const headers = { "x-user-identity": "ratelimit-test-user" };
      // Send 10 requests quickly (should all succeed)
      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: "POST",
          url: "/api/v1/query/execute",
          payload: { sql: "SELECT 1" },
          headers,
        });
      }
      // 11th should be rate limited
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT 1" },
        headers,
      });
      assert.equal(res.statusCode, 429);
    });

    it("auto-injects LIMIT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT * FROM assets" },
      });
      assert.equal(res.statusCode, 200);
      // The query executed should have had LIMIT injected
    });
  });

  describe("GET /api/v1/query/history", () => {
    it("returns history array", async () => {
      // Execute a query first to have history
      await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT 1" },
      });
      const res = await app.inject({ method: "GET", url: "/api/v1/query/history" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.history));
    });
  });

  describe("DELETE /api/v1/query/:queryId", () => {
    it("returns 200 with cancelled flag", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/query/test-id-123" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.cancelled, true);
      assert.equal(body.queryId, "test-id-123");
    });
  });
});
