import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Saves and restores env vars around a test callback. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const backup: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    backup[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(backup)) {
      if (backup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = backup[key];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests — use a single shared app to avoid Kafka connection issues
// ---------------------------------------------------------------------------

describe("Platform Settings Routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/v1/platform/settings ─────────────────────────────────────

  describe("GET /api/v1/platform/settings", () => {
    it("returns platform configuration shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/platform/settings",
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);

      // Verify top-level sections exist
      assert.ok("vastDatabase" in body);
      assert.ok("vastEventBroker" in body);
      assert.ok("vastDataEngine" in body);
      assert.ok("authentication" in body);
      assert.ok("storage" in body);
      assert.ok("scim" in body);

      // Verify vastDatabase shape
      assert.equal(typeof body.vastDatabase.configured, "boolean");
      assert.ok(["connected", "disconnected", "error"].includes(body.vastDatabase.status));
      assert.equal(typeof body.vastDatabase.tablesDeployed, "boolean");

      // Verify authentication shape
      assert.ok(["local", "oidc"].includes(body.authentication.mode));
      assert.equal(typeof body.authentication.iamEnabled, "boolean");
      assert.equal(typeof body.authentication.shadowMode, "boolean");
      assert.equal(typeof body.authentication.rolloutRing, "string");

      // Verify storage shape
      assert.equal(typeof body.storage.configured, "boolean");

      // Verify scim shape
      assert.equal(typeof body.scim.configured, "boolean");
      assert.equal(typeof body.scim.enabled, "boolean");
    });

    it("shows not_configured status when no env vars set", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/platform/settings",
      });
      const body = JSON.parse(res.body);

      // Without env vars, database should be disconnected
      assert.equal(body.vastDatabase.configured, false);
      assert.equal(body.vastDatabase.endpoint, null);

      // Event broker should not be configured
      assert.equal(body.vastEventBroker.configured, false);
      assert.equal(body.vastEventBroker.status, "not_configured");

      // DataEngine should not be configured
      assert.equal(body.vastDataEngine.configured, false);
      assert.equal(body.vastDataEngine.status, "not_configured");
    });
  });

  // ── POST /api/v1/platform/settings/test-connection ────────────────────

  describe("POST /api/v1/platform/settings/test-connection", () => {
    it("returns error when event_broker is not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/platform/settings/test-connection",
        payload: { service: "event_broker" },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.service, "event_broker");
      assert.equal(body.status, "error");
      assert.ok(body.message.includes("not configured"));
    });

    it("returns error when vast_database is not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/platform/settings/test-connection",
        payload: { service: "vast_database" },
      });
      const body = JSON.parse(res.body);
      assert.equal(body.service, "vast_database");
      assert.equal(body.status, "error");
      assert.ok(body.message.includes("not configured"));
    });

    it("returns error when s3 is not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/platform/settings/test-connection",
        payload: { service: "s3" },
      });
      const body = JSON.parse(res.body);
      assert.equal(body.service, "s3");
      assert.equal(body.status, "error");
    });

    it("returns ok when s3 is fully configured", async () => {
      await withEnv(
        {
          SPACEHARBOR_S3_ENDPOINT: "https://s3.example.com",
          SPACEHARBOR_S3_BUCKET: "spaceharbor-assets",
        },
        async () => {
          // Use same app — env vars are read at request time in test-connection
          const res = await app.inject({
            method: "POST",
            url: "/api/v1/platform/settings/test-connection",
            payload: { service: "s3" },
          });
          const body = JSON.parse(res.body);
          assert.equal(body.status, "ok");
          assert.ok(body.message.includes("configured"));
        },
      );
    });

    it("returns error for data_engine when not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/platform/settings/test-connection",
        payload: { service: "data_engine" },
      });
      const body = JSON.parse(res.body);
      assert.equal(body.service, "data_engine");
      assert.equal(body.status, "error");
    });

    it("returns ok for event_broker when env var set at request time", async () => {
      await withEnv(
        { VAST_EVENT_BROKER_URL: "kafka://broker:9092" },
        async () => {
          const res = await app.inject({
            method: "POST",
            url: "/api/v1/platform/settings/test-connection",
            payload: { service: "event_broker" },
          });
          const body = JSON.parse(res.body);
          assert.equal(body.status, "ok");
        },
      );
    });
  });

  // ── GET /api/v1/platform/settings/schema-status ───────────────────────

  describe("GET /api/v1/platform/settings/schema-status", () => {
    it("returns schema status with available migrations", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/platform/settings/schema-status",
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);

      assert.equal(typeof body.currentVersion, "number");
      assert.equal(typeof body.availableMigrations, "number");
      assert.equal(typeof body.upToDate, "boolean");
      assert.ok(Array.isArray(body.pending));

      // Without Trino, currentVersion should be 0 and all migrations pending
      assert.equal(body.currentVersion, 0);
      assert.ok(body.availableMigrations > 0);
      assert.equal(body.upToDate, false);
      assert.equal(body.pending.length, body.availableMigrations);

      // Each pending item should have version and description
      for (const p of body.pending) {
        assert.equal(typeof p.version, "number");
        assert.equal(typeof p.description, "string");
      }
    });
  });

  // ── POST /api/v1/platform/settings/deploy-schema ──────────────────────

  describe("POST /api/v1/platform/settings/deploy-schema", () => {
    it("returns 503 when Trino is not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/platform/settings/deploy-schema",
      });
      assert.equal(res.statusCode, 503);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "SERVICE_UNAVAILABLE");
    });
  });

  // ── Dual prefix registration ──────────────────────────────────────────

  describe("root prefix routes", () => {
    it("GET /platform/settings also works (root prefix)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/platform/settings",
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok("vastDatabase" in body);
    });

    it("GET /platform/settings/schema-status also works (root prefix)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/platform/settings/schema-status",
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(typeof body.currentVersion, "number");
    });
  });
});
