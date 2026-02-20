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

test("GET /api/v1/assets returns additive review/QC status values", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "v1 qc status demo",
      sourceUri: "s3://bucket/v1-qc-status-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-api-v1-qc-completed-1",
      eventType: "asset.processing.completed",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-api-v1-qc-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    }
  });
  assert.equal(completed.statusCode, 202);

  const qcPending = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-api-v1-qc-pending-1",
      eventType: "asset.review.qc_pending",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-api-v1-qc-pending-1",
      producer: "post-qc",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    }
  });
  assert.equal(qcPending.statusCode, 202);

  const assets = await app.inject({ method: "GET", url: "/api/v1/assets" });
  assert.equal(assets.statusCode, 200);
  assert.ok(Array.isArray(assets.json().assets));
  assert.equal(assets.json().assets[0].status, "qc_pending");
  assert.equal(assets.json().assets[0].thumbnail, null);
  assert.equal(assets.json().assets[0].proxy, null);
  assert.deepEqual(assets.json().assets[0].annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });

  const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${ingestBody.job.id}` });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().thumbnail, null);
  assert.equal(job.json().proxy, null);
  assert.deepEqual(job.json().annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });

  await app.close();
});
