// services/control-plane/test/metadata-lookup-proxy-route.test.ts
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

process.env.SPACEHARBOR_IAM_ENABLED = "false";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE = "true";
process.env.NODE_ENV = "development";

import { buildApp } from "../src/app.js";
import { __setMetadataLookupProxyForTests } from "../src/routes/metadata-lookup-proxy.js";

describe("GET /api/v1/metadata/lookup (admin proxy)", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    __setMetadataLookupProxyForTests(null);
    await app.close();
  });

  beforeEach(() => {
    __setMetadataLookupProxyForTests(null);
  });

  it("relays vastdb-query success body as-is", async () => {
    __setMetadataLookupProxyForTests(async (path: string) => ({
      ok: true,
      status: 200,
      data: { rows: [{ file_id: "abc", file_path: "bucket/key.exr" }], count: 1, matched_by: "file_path" },
    }));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?path=s3://bucket/key.exr&schema=frame_metadata&table=files",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 1);
    assert.equal(body.matched_by, "file_path");
    assert.equal(body.rows[0].file_path, "bucket/key.exr");
  });

  it("returns 400 VALIDATION_ERROR when path is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?schema=frame_metadata&table=files",
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when schema is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?path=s3://bucket/key.exr&table=files",
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when table is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?path=s3://bucket/key.exr&schema=frame_metadata",
    });
    assert.equal(res.statusCode, 400);
  });

  it("maps 503 from vastdb-query to LOOKUP_UNREACHABLE envelope", async () => {
    __setMetadataLookupProxyForTests(async () => ({
      ok: false,
      status: 503,
      data: { detail: "vastdb-query service unreachable" },
    }));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?path=s3://bucket/key.exr&schema=frame_metadata&table=files",
    });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "LOOKUP_UNREACHABLE");
    assert.match(body.message, /vastdb-query/);
  });

  it("relays 4xx from vastdb-query with its body", async () => {
    __setMetadataLookupProxyForTests(async () => ({
      ok: false,
      status: 404,
      data: { detail: "no row found for path" },
    }));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metadata/lookup?path=s3://bucket/missing.exr&schema=frame_metadata&table=files",
    });
    assert.equal(res.statusCode, 404);
  });
});
