import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { resetRateBuckets, resetAuditStore } from "../src/routes/query.js";

describe("Analytics & Query Console — Integration", () => {
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

  // ── Analytics endpoints smoke ──

  describe("Analytics endpoints return valid data", () => {
    for (const endpoint of ["assets", "pipeline", "storage", "render"]) {
      it(`GET /api/v1/analytics/${endpoint} returns 200`, async () => {
        const res = await app.inject({ method: "GET", url: `/api/v1/analytics/${endpoint}` });
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.ok(typeof body.range === "string");
        assert.ok(typeof body.cachedAt === "string");
      });
    }

    it("all 4 endpoints work with range=24h", async () => {
      for (const endpoint of ["assets", "pipeline", "storage", "render"]) {
        const res = await app.inject({ method: "GET", url: `/api/v1/analytics/${endpoint}?range=24h` });
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.range, "24h");
      }
    });

    it("all 4 endpoints work with range=90d", async () => {
      for (const endpoint of ["assets", "pipeline", "storage", "render"]) {
        const res = await app.inject({ method: "GET", url: `/api/v1/analytics/${endpoint}?range=90d` });
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.range, "90d");
      }
    });
  });

  // ── Query execute + audit trail ──

  describe("Query execution and audit", () => {
    it("SELECT returns 200 and creates audit entry", async () => {
      const execRes = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT * FROM assets" },
      });
      assert.equal(execRes.statusCode, 200);
      const execBody = JSON.parse(execRes.body);
      assert.ok(Array.isArray(execBody.columns));
      assert.ok(typeof execBody.queryId === "string");

      // Verify audit entry was created
      const histRes = await app.inject({ method: "GET", url: "/api/v1/query/history" });
      assert.equal(histRes.statusCode, 200);
      const histBody = JSON.parse(histRes.body);
      assert.ok(histBody.history.length >= 1);
      const latest = histBody.history[0];
      assert.equal(latest.status, "success");
      assert.ok(latest.sqlText.includes("SELECT"));
    });

    it("INSERT returns 403 and audit records denial", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "INSERT INTO assets VALUES ('x')" },
      });
      assert.equal(res.statusCode, 403);

      const histRes = await app.inject({ method: "GET", url: "/api/v1/query/history" });
      const histBody = JSON.parse(histRes.body);
      const denied = histBody.history.find((h: any) => h.status === "denied");
      assert.ok(denied, "Expected a denied audit entry");
    });

    it("DROP TABLE returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "DROP TABLE assets" },
      });
      assert.equal(res.statusCode, 403);
    });

    it("IAM table access returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT * FROM iam_users" },
      });
      assert.equal(res.statusCode, 403);
    });

    it("cancel endpoint returns 200", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/query/some-query-id" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.cancelled, true);
    });
  });

  // ── Cross-feature: analytics + query coexist ──

  describe("Both features coexist without interference", () => {
    it("analytics and query endpoints work in same app instance", async () => {
      // Hit analytics
      const analyticsRes = await app.inject({ method: "GET", url: "/api/v1/analytics/assets" });
      assert.equal(analyticsRes.statusCode, 200);

      // Hit query
      const queryRes = await app.inject({
        method: "POST",
        url: "/api/v1/query/execute",
        payload: { sql: "SELECT 1" },
      });
      assert.equal(queryRes.statusCode, 200);

      // Hit analytics again (should be cached)
      const analyticsRes2 = await app.inject({ method: "GET", url: "/api/v1/analytics/assets" });
      assert.equal(analyticsRes2.statusCode, 200);
      const body1 = JSON.parse(analyticsRes.body);
      const body2 = JSON.parse(analyticsRes2.body);
      assert.equal(body1.cachedAt, body2.cachedAt);
    });
  });

  // ── Non-prefixed routes ──

  describe("Non-prefixed routes also work", () => {
    it("GET /analytics/assets works", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/assets" });
      assert.equal(res.statusCode, 200);
    });

    it("POST /query/execute works", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/query/execute",
        payload: { sql: "SHOW TABLES" },
      });
      assert.equal(res.statusCode, 200);
    });
  });
});
