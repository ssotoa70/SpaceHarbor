import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("POST /api/v1/events accepts canonical event envelope", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Canonical Event Demo",
      sourceUri: "s3://bucket/canonical-event-demo.mov"
    }
  });

  const ingestBody = ingest.json();
  const eventPayload = {
    eventId: "evt-canonical-1",
    eventType: "asset.processing.started",
    eventVersion: "1.0",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-canonical-1",
    producer: "media-worker",
    data: {
      assetId: ingestBody.asset.id,
      jobId: ingestBody.job.id
    }
  };

  const first = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: eventPayload
  });

  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, false);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: eventPayload
  });

  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);

  const job = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "processing");

  await app.close();
});

test("POST /api/v1/events rejects invalid contract with unified error envelope", async () => {
  const app = buildApp();

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-invalid-1",
      eventType: "asset.processing.started"
    }
  });

  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, "CONTRACT_VALIDATION_ERROR");
  assert.equal(typeof invalid.json().requestId, "string");

  await app.close();
});

test("POST /api/v1/events rejects out-of-order transition with deterministic error", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Out-of-Order Event Demo",
      sourceUri: "s3://bucket/out-of-order-event-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-order-completed-1",
      eventType: "asset.processing.completed",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-order-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    }
  });

  assert.equal(completed.statusCode, 202);

  const outOfOrder = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-order-failed-1",
      eventType: "asset.processing.failed",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-order-failed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id,
        error: "out-of-order failure"
      }
    }
  });

  assert.equal(outOfOrder.statusCode, 409);
  assert.equal(outOfOrder.json().code, "WORKFLOW_TRANSITION_NOT_ALLOWED");

  await app.close();
});
