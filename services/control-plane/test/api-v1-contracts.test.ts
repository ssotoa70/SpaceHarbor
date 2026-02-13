import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("POST /api/v1/assets/ingest validates payload with unified error envelope", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      sourceUri: "s3://bucket/missing-title.mov"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(Object.keys(response.json()).sort(), ["code", "details", "message", "requestId"]);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.equal(typeof response.json().requestId, "string");

  await app.close();
});

test("GET /api/v1/jobs/:id returns not found envelope", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/jobs/missing-id"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "NOT_FOUND");
  assert.equal(typeof response.json().requestId, "string");

  await app.close();
});

test("POST /api/v1/assets/ingest succeeds with stable v1 response shape", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "v1 launch teaser",
      sourceUri: "s3://bucket/v1-launch-teaser.mov"
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.ok(body.asset.id);
  assert.ok(body.job.id);
  assert.equal(body.job.status, "pending");

  await app.close();
});
