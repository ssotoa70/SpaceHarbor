/**
 * End-to-end test for POST /api/v1/scanner/ingest — exercises HMAC
 * verification + path-parser + hierarchy-resolver + asset ingest in one
 * shot using the in-memory persistence adapter.
 */

// buildApp's startup gates require a strong JWT secret unless NODE_ENV=development.
// Set both before importing app.js so the gate passes deterministically. Each
// test also `app.close()`s in finally so background workers don't keep the
// process alive past the test run.
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
process.env.SPACEHARBOR_JWT_SECRET ??= "test-jwt-secret-for-scanner-ingest-route-tests-32+";
process.env.SPACEHARBOR_IAM_ENABLED ??= "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE ??= "true";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

const SECRET = "test-scanner-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

async function withApp<T>(
  setup: () => void,
  body: (app: FastifyInstance) => Promise<T>,
): Promise<T> {
  setup();
  const app = buildApp();
  try {
    return await body(app);
  } finally {
    await app.close();
  }
}

test("POST /api/v1/scanner/ingest returns 503 when SCANNER_SECRET is unset", async () => {
  const previous = process.env.SPACEHARBOR_SCANNER_SECRET;
  delete process.env.SPACEHARBOR_SCANNER_SECRET;
  try {
    await withApp(() => {}, async (app) => {
      const body = JSON.stringify({ bucket: "b", key: "k" });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scanner/ingest",
        headers: { "content-type": "application/json", "x-scanner-signature": "deadbeef" },
        payload: body,
      });
      assert.equal(res.statusCode, 503);
    });
  } finally {
    if (previous !== undefined) process.env.SPACEHARBOR_SCANNER_SECRET = previous;
  }
});

test("POST /api/v1/scanner/ingest rejects bad HMAC with 401", async () => {
  await withApp(
    () => { process.env.SPACEHARBOR_SCANNER_SECRET = SECRET; },
    async (app) => {
      const body = JSON.stringify({ bucket: "b", key: "projects/X/Y/Z/render/v001/file.exr" });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scanner/ingest",
        headers: { "content-type": "application/json", "x-scanner-signature": "0".repeat(64) },
        payload: body,
      });
      assert.equal(res.statusCode, 401);
      const json = res.json() as { code: string };
      assert.equal(json.code, "BAD_SIGNATURE");
    },
  );
});

test("POST /api/v1/scanner/ingest skips non-render paths with status=skipped", async () => {
  await withApp(
    () => { process.env.SPACEHARBOR_SCANNER_SECRET = SECRET; },
    async (app) => {
      const body = JSON.stringify({ bucket: "b", key: "projects/X/dailies/preview.mov" });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scanner/ingest",
        headers: { "content-type": "application/json", "x-scanner-signature": sign(body) },
        payload: body,
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as { status: string };
      assert.equal(json.status, "skipped");
    },
  );
});

test("POST /api/v1/scanner/ingest returns 404 when project not found", async () => {
  await withApp(
    () => { process.env.SPACEHARBOR_SCANNER_SECRET = SECRET; },
    async (app) => {
      const body = JSON.stringify({
        bucket: "b",
        key: "projects/UNKNOWN/SEQ_010/SH040/render/v001/file.exr",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scanner/ingest",
        headers: { "content-type": "application/json", "x-scanner-signature": sign(body) },
        payload: body,
      });
      assert.equal(res.statusCode, 404);
      const json = res.json() as { code: string };
      assert.equal(json.code, "PROJECT_NOT_FOUND");
    },
  );
});

test("POST /api/v1/scanner/ingest end-to-end happy path: parse + auto-resolve + ingest", async () => {
  await withApp(
    () => { process.env.SPACEHARBOR_SCANNER_SECRET = SECRET; },
    async (app) => {
      // Seed: create a project so the resolver has something to find.
      const projectRes = await app.inject({
        method: "POST",
        url: "/api/v1/hierarchy/projects",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          code: "PROJ_NOVA",
          name: "Project Nova",
          type: "feature",
          status: "active",
        }),
      });
      assert.equal(projectRes.statusCode, 201, `project create failed: ${projectRes.body}`);

      const body = JSON.stringify({
        bucket: "render-bucket",
        key: "projects/PROJ_NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr",
        etag: "abc123",
        size: 12345,
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scanner/ingest",
        headers: { "content-type": "application/json", "x-scanner-signature": sign(body) },
        payload: body,
      });
      assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
      const json = res.json() as { status: string; assetId: string; jobId: string };
      assert.equal(json.status, "ingested");
      assert.ok(json.assetId);
      assert.ok(json.jobId);
    },
  );
});
