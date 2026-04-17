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

import { describe, it, test } from "node:test";
import assert from "node:assert/strict";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import {
  resolveSourcesStatus,
  type DbResult,
  type SidecarResult,
  type AssetMetadataDeps,
} from "../src/routes/asset-metadata.js";
import type { SidecarFetchResult } from "../src/routes/storage-metadata.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests — real Fastify app, stubbed queryFetcher + sidecarFetcher.
// ─────────────────────────────────────────────────────────────────────────────

async function withApp<T>(body: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const app = buildApp();
  try { return await body(app); } finally { await app.close(); }
}

async function seedAsset(
  app: FastifyInstance,
  sourceUri: string,
  title: string,
): Promise<string> {
  const asset = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ title, sourceUri }),
  });
  assert.equal(asset.statusCode, 201, `ingest failed: ${asset.body}`);
  return JSON.parse(asset.body).asset.id as string;
}

function setDeps(app: FastifyInstance, deps: AssetMetadataDeps): void {
  (app as unknown as { __assetMetadataDeps: AssetMetadataDeps }).__assetMetadataDeps = deps;
}

test("GET /api/v1/assets/:id/metadata — 404 when asset missing", async () => {
  await withApp(async (app) => {
    const r = await app.inject({ method: "GET", url: "/api/v1/assets/bogus-id-404/metadata" });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, "ASSET_NOT_FOUND");
  });
});

test("GET /api/v1/assets/:id/metadata — happy path returns db rows + pipeline", async () => {
  await withApp(async (app) => {
    const assetId = await seedAsset(app, "s3://sergio-spaceharbor/uploads/pixar_5603.exr", "pixar_5603.exr");

    setDeps(app, {
      queryFetcher: async () => ({
        ok: true,
        status: 200,
        data: {
          rows: [{ source_uri: "uploads/pixar_5603.exr", width: 2048, height: 858 }],
          bucket: "sergio-db",
          schema: "frame_metadata",
          table: "files",
          matched_by: "source_uri",
          count: 1,
        },
      }),
      sidecarFetcher: async (): Promise<SidecarFetchResult> =>
        ({ ok: false, code: "SIDECAR_NOT_FOUND", message: "no sidecar" }),
    });

    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.sources.db, "ok");
    assert.equal(body.sources.sidecar, "missing");
    assert.equal(body.pipeline?.targetSchema, "frame_metadata");
    assert.equal(body.dbRows.length, 1);
    assert.equal(body.sidecar, null);
  });
});

test("GET /api/v1/assets/:id/metadata — db unreachable falls through to sidecar", async () => {
  await withApp(async (app) => {
    const assetId = await seedAsset(app, "s3://sergio-spaceharbor/uploads/pixar_5603.exr", "pixar_5603_fallback.exr");

    setDeps(app, {
      queryFetcher: async () => ({ ok: false, status: 503, data: { detail: "circuit open" } }),
      sidecarFetcher: async (): Promise<SidecarFetchResult> => ({
        ok: true,
        data: {
          schema_version: "1.0.0",
          file_kind: "image",
          source_uri: "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
          sidecar_key: "uploads/.proxies/pixar_5603_metadata.json",
          bucket: "sergio-spaceharbor",
          bytes: 123,
          data: { width: 2048 },
        },
      }),
    });

    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.sources.db, "unreachable");
    assert.equal(body.sources.sidecar, "ok");
    assert.match(body.dbError, /circuit open/);
    assert.equal(body.dbRows.length, 0);
    assert.ok(body.sidecar);
  });
});

test("GET /api/v1/assets/:id/metadata — non-s3 sourceUri → db=disabled, queryFetcher not called", async () => {
  await withApp(async (app) => {
    const assetId = await seedAsset(app, "file:///tmp/local.exr", "local.exr");

    setDeps(app, {
      queryFetcher: async () => { throw new Error("queryFetcher should not be called for non-s3 URI"); },
      sidecarFetcher: async (): Promise<SidecarFetchResult> =>
        ({ ok: false, code: "SIDECAR_NOT_FOUND", message: "no sidecar" }),
    });

    const r = await app.inject({ method: "GET", url: `/api/v1/assets/${assetId}/metadata` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().sources.db, "disabled");
  });
});
