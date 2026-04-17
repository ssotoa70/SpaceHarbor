/**
 * Tests for /api/v1/assets/:id/metadata — unified DB + sidecar reader.
 * Unit tests for the pure sources-status resolver; contract tests for the
 * route handler land in later tasks.
 */

// Startup gates need these before any app.ts import. Tests also close() the
// app in finally so background workers don't keep the process alive.
process.env.NODE_ENV ??= "development";
process.env.SPACEHARBOR_JWT_SECRET ??= "test-jwt-secret-for-asset-metadata-route-tests-32+";
process.env.SPACEHARBOR_IAM_ENABLED ??= "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE ??= "true";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveSourcesStatus,
  type DbResult,
  type SidecarResult,
} from "../src/routes/asset-metadata.js";

describe("resolveSourcesStatus", () => {
  it("both ok when db returns rows and sidecar exists", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [{ width: 2048 }] },
      { kind: "sidecar", data: { schema_version: "1.0.0" } } as SidecarResult
    );
    assert.deepEqual(r, { db: "ok", sidecar: "ok", dbError: undefined });
  });

  it("db=empty when db returns zero rows", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [] },
      { kind: "missing" }
    );
    assert.equal(r.db, "empty");
    assert.equal(r.sidecar, "missing");
  });

  it("db=unreachable + dbError when db call failed", () => {
    const r = resolveSourcesStatus(
      { kind: "error", message: "circuit 'vast-trino' is OPEN" },
      { kind: "sidecar", data: {} } as SidecarResult
    );
    assert.equal(r.db, "unreachable");
    assert.equal(r.sidecar, "ok");
    assert.equal(r.dbError, "circuit 'vast-trino' is OPEN");
  });

  it("db=disabled when pipeline is missing", () => {
    const r = resolveSourcesStatus(
      { kind: "disabled", reason: "no pipeline for file kind 'other'" },
      { kind: "missing" }
    );
    assert.equal(r.db, "disabled");
    assert.equal(r.sidecar, "missing");
    assert.equal(r.dbError, undefined);
  });

  it("sidecar=missing when sidecar fetch 404s, db continues independently", () => {
    const r = resolveSourcesStatus(
      { kind: "rows", rows: [{ any: 1 }] },
      { kind: "missing" }
    );
    assert.equal(r.db, "ok");
    assert.equal(r.sidecar, "missing");
  });
});
