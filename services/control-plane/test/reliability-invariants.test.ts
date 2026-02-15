import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("duplicate canonical event remains idempotent without extra state mutation", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "reliability-duplicate-invariant",
      sourceUri: "s3://bucket/reliability-duplicate-invariant.mov"
    }
  });

  assert.equal(ingest.statusCode, 201);
  const ingestBody = ingest.json();

  const payload = {
    eventId: "evt-reliability-invariant-1",
    eventType: "asset.processing.started",
    eventVersion: "1.0",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-reliability-invariant-1",
    producer: "reliability-suite",
    data: {
      assetId: ingestBody.asset.id,
      jobId: ingestBody.job.id
    }
  };

  const first = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload
  });
  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload
  });

  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, false);
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);

  const job = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "processing");

  const audit = await app.inject({
    method: "GET",
    url: "/api/v1/audit"
  });
  assert.equal(audit.statusCode, 200);
  const processingTransitions = audit
    .json()
    .events.filter((event: { message: string }) => event.message.includes("moved to processing"));
  assert.equal(processingTransitions.length, 1);

  await app.close();
});

test("unknown job event is rejected without changing workflow counters", async () => {
  const app = buildApp();

  const before = await app.inject({
    method: "GET",
    url: "/api/v1/metrics"
  });
  assert.equal(before.statusCode, 200);
  const beforeMetrics = before.json();

  const event = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-reliability-unknown-job-1",
      eventType: "asset.processing.started",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-reliability-unknown-job-1",
      producer: "reliability-suite",
      data: {
        assetId: "asset-missing",
        jobId: "job-missing"
      }
    }
  });

  assert.equal(event.statusCode, 404);
  assert.equal(event.json().code, "NOT_FOUND");

  const after = await app.inject({
    method: "GET",
    url: "/api/v1/metrics"
  });
  assert.equal(after.statusCode, 200);
  const afterMetrics = after.json();

  assert.deepEqual(afterMetrics.assets, beforeMetrics.assets);
  assert.deepEqual(afterMetrics.jobs, beforeMetrics.jobs);
  assert.deepEqual(afterMetrics.queue, beforeMetrics.queue);
  assert.deepEqual(afterMetrics.dlq, beforeMetrics.dlq);

  await app.close();
});

test("wrong-worker heartbeat is rejected and lease ownership remains unchanged", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "reliability-lease-invariant",
      sourceUri: "s3://bucket/reliability-lease-invariant.mov"
    }
  });
  assert.equal(ingest.statusCode, 201);
  const ingestBody = ingest.json();

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "worker-primary",
      leaseSeconds: 30
    }
  });
  assert.equal(claim.statusCode, 200);

  const wrongHeartbeat = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingestBody.job.id}/heartbeat`,
    payload: {
      workerId: "worker-secondary",
      leaseSeconds: 30
    }
  });

  assert.equal(wrongHeartbeat.statusCode, 404);
  assert.equal(wrongHeartbeat.json().code, "NOT_FOUND");

  const job = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "processing");
  assert.equal(job.json().leaseOwner, "worker-primary");

  await app.close();
});
