import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

describe("GET /api/v1/assets/:id/review-uri", () => {
  it("returns 200 with rvlink URI for known asset", async () => {
    const ingestRes = await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      headers: { "content-type": "application/json" },
      payload: {
        title: "hero_plate_v001.exr",
        sourceUri: "vast://ingest/sh010/hero_plate_v001.exr",
      },
    });
    assert.equal(ingestRes.statusCode, 201, `ingest failed: ${ingestRes.body}`);
    const { asset } = ingestRes.json();
    const assetId = asset.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/assets/${assetId}/review-uri`,
    });
    assert.equal(res.statusCode, 200, `review-uri failed: ${res.body}`);
    const body = res.json();
    assert.ok(body.uri, "should have uri");
    assert.ok(
      body.uri.startsWith("rvlink://"),
      `uri should start with rvlink://, got: ${body.uri}`,
    );
    assert.ok(body.format, "should have format");
    assert.equal(body.asset_id, assetId);
  });

  it("returns 404 for unknown asset", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/assets/nonexistent-uuid-9999/review-uri",
    });
    assert.equal(res.statusCode, 404);
  });
});
