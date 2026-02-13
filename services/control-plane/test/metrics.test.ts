import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("GET /api/v1/metrics returns workflow and queue statistics", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "metrics-asset",
      sourceUri: "s3://bucket/metrics-asset.mov"
    },
    headers: {
      "x-correlation-id": "corr-metrics-1"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "metrics-worker",
      leaseSeconds: 60
    }
  });
  assert.equal(claim.statusCode, 200);

  const metrics = await app.inject({
    method: "GET",
    url: "/api/v1/metrics",
    headers: {
      "x-correlation-id": "corr-metrics-2"
    }
  });

  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.headers["x-correlation-id"], "corr-metrics-2");

  const body = metrics.json();
  assert.equal(typeof body.assets.total, "number");
  assert.equal(typeof body.jobs.total, "number");
  assert.equal(typeof body.jobs.processing, "number");
  assert.equal(typeof body.queue.pending, "number");
  assert.equal(typeof body.outbox.pending, "number");
  assert.equal(typeof body.dlq.total, "number");

  assert.ok(body.assets.total >= 1);
  assert.ok(body.jobs.total >= 1);
  assert.ok(body.jobs.processing >= 1);
  assert.ok(body.outbox.pending >= 1);
  assert.equal(body.dlq.total, 0);

  await app.close();
});
