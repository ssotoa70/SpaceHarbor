import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

test("claim queue creates processing lease and outbox publish flow", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "phase2-queue-asset",
      sourceUri: "s3://bucket/phase2-queue-asset.mov"
    },
    headers: {
      "x-correlation-id": "corr-phase2-ingest-1"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "worker-a",
      leaseSeconds: 30
    }
  });

  assert.equal(claim.statusCode, 200);
  const claimBody = claim.json();
  assert.equal(claimBody.job.status, "processing");
  assert.equal(claimBody.job.leaseOwner, "worker-a");
  assert.equal(claimBody.job.attemptCount, 1);

  const outbox = await app.inject({
    method: "GET",
    url: "/api/v1/outbox"
  });

  assert.equal(outbox.statusCode, 200);
  const outboxBody = outbox.json();
  assert.ok(outboxBody.items.length >= 1);
  const requested = outboxBody.items.find(
    (item: { eventType: string; correlationId: string }) => item.eventType === "media.process.requested.v1"
  );
  assert.ok(requested);
  assert.equal(requested.correlationId, "corr-phase2-ingest-1");

  const publish = await app.inject({
    method: "POST",
    url: "/api/v1/outbox/publish"
  });

  assert.equal(publish.statusCode, 200);
  assert.ok(publish.json().publishedCount >= 1);

  await app.close();
});

test("failed jobs retry and then move to DLQ with replay support", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "phase2-retry-asset",
      sourceUri: "s3://bucket/phase2-retry-asset.mov"
    }
  });

  const ingestBody = ingest.json();
  const baseNowMs = Date.now();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = await app.inject({
      method: "POST",
      url: "/api/v1/queue/claim",
      payload: {
        workerId: `worker-${attempt}`,
        leaseSeconds: 10,
        now: new Date(baseNowMs + attempt * 30_000).toISOString()
      }
    });

    assert.equal(claim.statusCode, 200);

    const failedEvent = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        eventId: `evt-phase2-fail-${attempt}`,
        eventType: "asset.processing.failed",
        eventVersion: "1.0",
        occurredAt: new Date().toISOString(),
        correlationId: `corr-phase2-fail-${attempt}`,
        producer: "media-worker",
        data: {
          assetId: ingestBody.asset.id,
          jobId: ingestBody.job.id,
          error: "transcode-timeout"
        }
      }
    });

    assert.equal(failedEvent.statusCode, 202);
  }

  const jobAfterFailures = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });

  assert.equal(jobAfterFailures.statusCode, 200);
  assert.equal(jobAfterFailures.json().status, "failed");
  assert.equal(jobAfterFailures.json().attemptCount, 3);

  const dlq = await app.inject({
    method: "GET",
    url: "/api/v1/dlq"
  });
  assert.equal(dlq.statusCode, 200);
  assert.equal(dlq.json().items.length, 1);
  assert.equal(dlq.json().items[0].jobId, ingestBody.job.id);

  const replay = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingestBody.job.id}/replay`
  });
  assert.equal(replay.statusCode, 202);

  const replayedJob = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(replayedJob.statusCode, 200);
  assert.equal(replayedJob.json().status, "pending");

  await app.close();
});

test("lease heartbeat and stale reaper support worker recovery", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "phase2-lease-asset",
      sourceUri: "s3://bucket/phase2-lease-asset.mov"
    }
  });

  const ingestBody = ingest.json();

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "lease-worker",
      leaseSeconds: 1
    }
  });

  assert.equal(claim.statusCode, 200);

  const heartbeat = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingestBody.job.id}/heartbeat`,
    payload: {
      workerId: "lease-worker",
      leaseSeconds: 90
    }
  });

  assert.equal(heartbeat.statusCode, 200);

  const reapNotExpired = await app.inject({
    method: "POST",
    url: "/api/v1/queue/reap-stale",
    payload: {
      now: new Date(Date.now() + 1_000).toISOString()
    }
  });

  assert.equal(reapNotExpired.statusCode, 200);
  assert.equal(reapNotExpired.json().requeuedCount, 0);

  const reapExpired = await app.inject({
    method: "POST",
    url: "/api/v1/queue/reap-stale",
    payload: {
      now: new Date(Date.now() + 91_000).toISOString()
    }
  });

  assert.equal(reapExpired.statusCode, 200);
  assert.equal(reapExpired.json().requeuedCount, 1);

  const reclaimed = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "lease-worker-2",
      leaseSeconds: 30,
      now: new Date(Date.now() + 91_000).toISOString()
    }
  });

  assert.equal(reclaimed.statusCode, 200);
  assert.equal(reclaimed.json().job.id, ingestBody.job.id);

  await app.close();
});

test("responses expose correlation ids for observability", async () => {
  const app = buildApp();

  const correlation = "corr-phase2-observability-1";
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/assets",
    headers: {
      "x-correlation-id": correlation
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-correlation-id"], correlation);

  await app.close();
});
