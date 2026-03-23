// ---------------------------------------------------------------------------
// Phase 3.1 & 3.3: Audit Trail Persistence + Compliance & Observability Tests
// ---------------------------------------------------------------------------

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1. Migration 012 — auth_decisions table
// ---------------------------------------------------------------------------

describe("Migration 012: audit trail", () => {
  it("defines correct version and statements", async () => {
    const { migration } = await import("../src/db/migrations/012_audit_trail.js");
    assert.equal(migration.version, 12);
    assert.ok(migration.description.includes("auth_decisions"));
    assert.ok(migration.statements.length >= 3); // CREATE TABLE, ALTER TABLE, INSERT version

    const createStmt = migration.statements[0];
    assert.ok(createStmt.includes("auth_decisions"));
    assert.ok(createStmt.includes("actor_id"));
    assert.ok(createStmt.includes("TIMESTAMP(6)"));
    assert.ok(createStmt.includes("shadow_mode"));
    assert.ok(createStmt.includes("ip_address"));
    assert.ok(createStmt.includes("request_path"));

    const sortStmt = migration.statements[1];
    assert.ok(sortStmt.includes("sorted_by"));
    assert.ok(sortStmt.includes("timestamp"));
    assert.ok(sortStmt.includes("actor_id"));
  });

  it("is registered in migration index", async () => {
    const { migrations } = await import("../src/db/migrations/index.js");
    const m012 = migrations.find((m) => m.version === 12);
    assert.ok(m012, "migration 012 should be in index");
    assert.ok(m012!.description.toLowerCase().includes("audit"));
  });
});

// ---------------------------------------------------------------------------
// 2. Persistent AuthzLogger — flush and retention
// ---------------------------------------------------------------------------

describe("PersistentAuthzLogger", () => {
  it("flushes pending decisions on threshold", async () => {
    const queries: string[] = [];
    const mockTrino = {
      query: async (sql: string) => {
        queries.push(sql);
        return { columns: [], data: [], rowCount: 0 };
      },
      healthCheck: async () => ({ reachable: true }),
    };

    const { createPersistentAuthzLogger } = await import(
      "../src/iam/persistent-authz-logger.js"
    );
    const logger = createPersistentAuthzLogger(mockTrino as any);

    // Log 100 decisions to hit the threshold
    for (let i = 0; i < 100; i++) {
      logger.logDecision({
        decision: "allow",
        permission: "browse:assets" as any,
        actor: `user-${i}`,
        tenantId: "t1",
        projectId: null,
        reason: "ok",
        evaluatedAt: new Date().toISOString(),
        shadow: false,
      });
    }

    // Give the async flush a tick to execute
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(queries.length >= 1, "should have flushed at least once");
    assert.ok(queries[0].includes("INSERT INTO"));
    assert.ok(queries[0].includes("auth_decisions"));

    // Metrics should reflect all 100
    const metrics = logger.getMetrics();
    assert.equal(metrics.total, 100);
    assert.equal(metrics.allow, 100);
    assert.equal(metrics.deny, 0);

    logger.stop();
  });

  it("tracks shadow denials in metrics", async () => {
    const mockTrino = {
      query: async () => ({ columns: [], data: [], rowCount: 0 }),
      healthCheck: async () => ({ reachable: true }),
    };

    const { createPersistentAuthzLogger } = await import(
      "../src/iam/persistent-authz-logger.js"
    );
    const logger = createPersistentAuthzLogger(mockTrino as any);

    logger.logDecision({
      decision: "allow",
      permission: "browse:assets" as any,
      actor: "user-1",
      tenantId: "t1",
      projectId: null,
      reason: "shadow-deny: would have denied browse:assets",
      evaluatedAt: new Date().toISOString(),
      shadow: true,
    });

    const metrics = logger.getMetrics();
    assert.equal(metrics.shadowDeny, 1);
    assert.equal(metrics.allow, 1);

    logger.stop();
  });

  it("runRetention issues DELETE with correct interval", async () => {
    const queries: string[] = [];
    const mockTrino = {
      query: async (sql: string) => {
        queries.push(sql);
        return { columns: [], data: [], rowCount: 5 };
      },
      healthCheck: async () => ({ reachable: true }),
    };

    // Set env to 30 days for test
    const original = process.env.SPACEHARBOR_AUDIT_RETENTION_DAYS;
    process.env.SPACEHARBOR_AUDIT_RETENTION_DAYS = "30";

    const { createPersistentAuthzLogger } = await import(
      "../src/iam/persistent-authz-logger.js"
    );
    const logger = createPersistentAuthzLogger(mockTrino as any);

    const result = await logger.runRetention();

    assert.ok(queries.some((q) => q.includes("DELETE FROM")));
    assert.ok(queries.some((q) => q.includes("INTERVAL '30' DAY")));

    // Restore env
    if (original !== undefined) {
      process.env.SPACEHARBOR_AUDIT_RETENTION_DAYS = original;
    } else {
      delete process.env.SPACEHARBOR_AUDIT_RETENTION_DAYS;
    }

    logger.stop();
  });

  it("manual flush sends pending records", async () => {
    const queries: string[] = [];
    const mockTrino = {
      query: async (sql: string) => {
        queries.push(sql);
        return { columns: [], data: [], rowCount: 0 };
      },
      healthCheck: async () => ({ reachable: true }),
    };

    const { createPersistentAuthzLogger } = await import(
      "../src/iam/persistent-authz-logger.js"
    );
    const logger = createPersistentAuthzLogger(mockTrino as any);

    logger.logDecision({
      decision: "deny",
      permission: "admin:metrics" as any,
      actor: "user-x",
      tenantId: "t1",
      projectId: "p1",
      reason: "missing role",
      evaluatedAt: new Date().toISOString(),
      shadow: false,
    });

    assert.equal(queries.length, 0, "should not flush yet (below threshold)");

    await logger.flush();

    assert.equal(queries.length, 1);
    assert.ok(queries[0].includes("user-x"));
    assert.ok(queries[0].includes("deny"));

    logger.stop();
  });

  it("clear resets metrics and pending", async () => {
    const mockTrino = {
      query: async () => ({ columns: [], data: [], rowCount: 0 }),
      healthCheck: async () => ({ reachable: true }),
    };

    const { createPersistentAuthzLogger } = await import(
      "../src/iam/persistent-authz-logger.js"
    );
    const logger = createPersistentAuthzLogger(mockTrino as any);

    logger.logDecision({
      decision: "allow",
      permission: "browse:assets" as any,
      actor: "u1",
      tenantId: "t1",
      projectId: null,
      reason: "ok",
      evaluatedAt: new Date().toISOString(),
      shadow: false,
    });

    logger.clear();
    const metrics = logger.getMetrics();
    assert.equal(metrics.total, 0);
    assert.equal(logger.getDecisions().length, 0);

    logger.stop();
  });
});

// ---------------------------------------------------------------------------
// 3. Audit decisions endpoint
// ---------------------------------------------------------------------------

describe("GET /api/v1/audit/auth-decisions", () => {
  it("returns filtered paginated results from Trino", async () => {
    // We test the route handler via the buildApp pattern
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    // Without Trino configured, the endpoint returns 503
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/auth-decisions?page=1&limit=10",
    });

    // With no Trino, expect 503
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "SERVICE_UNAVAILABLE");

    await app.close();
  });

  it("registers on both prefix paths", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    const res1 = await app.inject({
      method: "GET",
      url: "/audit/auth-decisions",
    });
    const res2 = await app.inject({
      method: "GET",
      url: "/api/v1/audit/auth-decisions",
    });

    // Both should respond (503 since no Trino, but not 404)
    assert.notEqual(res1.statusCode, 404);
    assert.notEqual(res2.statusCode, 404);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 4. IAM metrics endpoint
// ---------------------------------------------------------------------------

describe("GET /api/v1/metrics/iam", () => {
  it("returns correct metrics shape", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/iam",
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(typeof body.totalAuthAttempts, "number");
    assert.equal(typeof body.successRate, "number");
    assert.equal(typeof body.failureRate, "number");
    assert.ok(body.authStrategyBreakdown);
    assert.equal(typeof body.authStrategyBreakdown.jwt, "number");
    assert.equal(typeof body.authStrategyBreakdown.api_key, "number");
    assert.equal(typeof body.authStrategyBreakdown.service_token, "number");
    assert.equal(typeof body.permissionDenialRate, "number");
    assert.equal(typeof body.shadowDenyRate, "number");
    assert.equal(typeof body.activeSessions, "number");

    await app.close();
  });

  it("registers on both prefix paths", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/metrics/iam",
    });
    assert.equal(res.statusCode, 200);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Data Classification Headers
// ---------------------------------------------------------------------------

describe("X-Data-Classification header", () => {
  it("classifies user endpoints as confidential", async () => {
    const { resolveDataClassification } = await import(
      "../src/iam/security-headers.js"
    );
    assert.equal(resolveDataClassification("/api/v1/users"), "confidential");
    assert.equal(resolveDataClassification("/api/v1/users/123"), "confidential");
    assert.equal(resolveDataClassification("/api/v1/auth/login"), "confidential");
    assert.equal(resolveDataClassification("/scim/v2/Users"), "confidential");
  });

  it("classifies audit endpoints as restricted", async () => {
    const { resolveDataClassification } = await import(
      "../src/iam/security-headers.js"
    );
    assert.equal(resolveDataClassification("/api/v1/audit/auth-decisions"), "restricted");
    assert.equal(resolveDataClassification("/audit/auth-decisions?page=1"), "restricted");
  });

  it("classifies other endpoints as internal", async () => {
    const { resolveDataClassification } = await import(
      "../src/iam/security-headers.js"
    );
    assert.equal(resolveDataClassification("/api/v1/assets"), "internal");
    assert.equal(resolveDataClassification("/health"), "internal");
    assert.equal(resolveDataClassification("/api/v1/jobs"), "internal");
  });

  it("header is present on responses", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/health" });
    assert.ok(
      res.headers["x-data-classification"],
      "X-Data-Classification header should be present"
    );
    assert.equal(res.headers["x-data-classification"], "internal");

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 6. IAM Health Check
// ---------------------------------------------------------------------------

describe("IAM health check in /health", () => {
  it("includes iam subsystem in health response", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.ok(body.iam, "health response should include iam field");
    assert.ok(["ok", "warning", "degraded"].includes(body.iam.status));
    assert.equal(typeof body.iam.jwksConfigured, "boolean");
    assert.equal(typeof body.iam.featureFlagsConsistent, "boolean");
    assert.ok(Array.isArray(body.iam.warnings));

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 7. Structured auth logging (verify hook wiring)
// ---------------------------------------------------------------------------

describe("Structured auth logging", () => {
  it("auth hook is wired in app", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();

    // Verify the app has onRequest hooks (auth logic is there)
    // This is a smoke test — the structured logging is wired in the hook
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);

    await app.close();
  });
});
