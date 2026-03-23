import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestApp() {
  const persistence = new LocalPersistenceAdapter();
  persistence.reset();
  const app = buildApp({ persistenceAdapter: persistence });
  return { app, persistence };
}

// ---------------------------------------------------------------------------
// Existing: shape and basic state test (retained)
// ---------------------------------------------------------------------------

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
  assert.equal(typeof body.degradedMode.fallbackEvents, "number");
  assert.equal(typeof body.outbound.attempts, "number");
  assert.equal(typeof body.outbound.success, "number");
  assert.equal(typeof body.outbound.failure, "number");
  assert.equal(typeof body.outbound.byTarget.slack.attempts, "number");

  assert.ok(body.assets.total >= 1);
  assert.ok(body.jobs.total >= 1);
  assert.ok(body.jobs.processing >= 1);
  assert.ok(body.outbox.pending >= 1);
  assert.equal(body.dlq.total, 0);
  assert.equal(body.degradedMode.fallbackEvents, 0);
  assert.equal(body.outbound.attempts, 0);
  assert.equal(body.outbound.success, 0);
  assert.equal(body.outbound.failure, 0);

  await app.close();
});

// ---------------------------------------------------------------------------
// Shape: metrics response has the complete expected schema
// ---------------------------------------------------------------------------

test("GET /api/v1/metrics returns the complete required schema shape", async () => {
  const { app } = buildTestApp();

  const metrics = await app.inject({
    method: "GET",
    url: "/api/v1/metrics"
  });

  assert.equal(metrics.statusCode, 200);
  const body = metrics.json() as Record<string, unknown>;

  // Top-level keys
  const topLevelKeys = ["assets", "jobs", "queue", "outbox", "dlq", "degradedMode", "outbound"];
  for (const key of topLevelKeys) {
    assert.ok(Object.hasOwn(body, key), `response should have '${key}' key`);
  }

  // assets
  const assets = body.assets as Record<string, number>;
  assert.equal(typeof assets.total, "number");

  // jobs
  const jobs = body.jobs as Record<string, number>;
  for (const field of ["total", "pending", "processing", "completed", "failed", "needsReplay"]) {
    assert.equal(typeof jobs[field], "number", `jobs.${field} should be a number`);
  }

  // queue
  const queue = body.queue as Record<string, number>;
  assert.equal(typeof queue.pending, "number");
  assert.equal(typeof queue.leased, "number");

  // outbox
  const outbox = body.outbox as Record<string, number>;
  assert.equal(typeof outbox.pending, "number");
  assert.equal(typeof outbox.published, "number");

  // dlq
  const dlq = body.dlq as Record<string, number>;
  assert.equal(typeof dlq.total, "number");

  // degradedMode
  const degraded = body.degradedMode as Record<string, number>;
  assert.equal(typeof degraded.fallbackEvents, "number");

  // outbound
  const outbound = body.outbound as {
    attempts: number;
    success: number;
    failure: number;
    byTarget: {
      slack: { attempts: number; success: number; failure: number };
      teams: { attempts: number; success: number; failure: number };
      production: { attempts: number; success: number; failure: number };
    };
  };
  assert.equal(typeof outbound.attempts, "number");
  assert.equal(typeof outbound.success, "number");
  assert.equal(typeof outbound.failure, "number");
  for (const target of ["slack", "teams", "production"] as const) {
    assert.equal(typeof outbound.byTarget[target].attempts, "number",
      `outbound.byTarget.${target}.attempts should be a number`);
    assert.equal(typeof outbound.byTarget[target].success, "number",
      `outbound.byTarget.${target}.success should be a number`);
    assert.equal(typeof outbound.byTarget[target].failure, "number",
      `outbound.byTarget.${target}.failure should be a number`);
  }

  await app.close();
});

// ---------------------------------------------------------------------------
// State reflection: metrics counts change as jobs are ingested and claimed
// ---------------------------------------------------------------------------

test("metrics reflect increasing asset and job counts after ingests", async () => {
  const { app } = buildTestApp();

  const baseline = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    assets: { total: number };
    jobs: { total: number; pending: number };
  };

  // Ingest two assets
  for (const n of [1, 2]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      payload: {
        title: `Metrics State Asset ${n}`,
        sourceUri: `s3://bucket/metrics-state-${n}.mov`
      }
    });
    assert.equal(res.statusCode, 201);
  }

  const after = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    assets: { total: number };
    jobs: { total: number; pending: number };
  };

  assert.equal(after.assets.total, baseline.assets.total + 2,
    "assets.total should increase by 2 after two ingests");
  assert.equal(after.jobs.total, baseline.jobs.total + 2,
    "jobs.total should increase by 2 after two ingests");
  assert.ok(after.jobs.pending >= 2,
    "jobs.pending should be at least 2 (from ingests, before any claim)");

  await app.close();
});

test("metrics reflect processing count after a job is claimed", async () => {
  const { app } = buildTestApp();

  // Ingest an asset to create a pending job
  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Claim Metrics Asset",
      sourceUri: "s3://bucket/claim-metrics.exr"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const beforeClaim = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    jobs: { pending: number; processing: number };
    queue: { pending: number; leased: number };
  };
  const pendingBefore = beforeClaim.jobs.pending;
  const processingBefore = beforeClaim.jobs.processing;
  const queuePendingBefore = beforeClaim.queue.pending;
  const queueLeasedBefore = beforeClaim.queue.leased;

  // Claim the job
  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: { workerId: "metrics-worker", leaseSeconds: 300 }
  });
  assert.equal(claim.statusCode, 200);

  const afterClaim = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    jobs: { pending: number; processing: number };
    queue: { pending: number; leased: number };
  };

  assert.ok(afterClaim.jobs.processing >= processingBefore + 1,
    "jobs.processing should increase after a claim");
  assert.ok(afterClaim.jobs.pending <= pendingBefore,
    "jobs.pending should decrease or stay the same after a claim");
  assert.ok(afterClaim.queue.leased >= queueLeasedBefore + 1,
    "queue.leased should increase after a claim");

  await app.close();
});

// ---------------------------------------------------------------------------
// Idempotency: metrics endpoint is read-only and does not mutate state
// ---------------------------------------------------------------------------

test("calling GET /api/v1/metrics twice returns identical counts (read-only)", async () => {
  const { app } = buildTestApp();

  // Ingest one asset to get a non-trivial state
  await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title: "Idempotency Check", sourceUri: "s3://bucket/idempotency.mov" }
  });

  const first = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    assets: { total: number };
    jobs: { total: number };
  };
  const second = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    assets: { total: number };
    jobs: { total: number };
  };

  assert.equal(first.assets.total, second.assets.total,
    "assets.total should be identical on consecutive reads");
  assert.equal(first.jobs.total, second.jobs.total,
    "jobs.total should be identical on consecutive reads");

  await app.close();
});

// ---------------------------------------------------------------------------
// Fresh state: new app instance starts with zeroed counts
// ---------------------------------------------------------------------------

test("fresh persistence adapter starts with zero assets, jobs, and DLQ items", async () => {
  const { app } = buildTestApp();

  const metrics = (await app.inject({ method: "GET", url: "/api/v1/metrics" })).json() as {
    assets: { total: number };
    jobs: { total: number; pending: number; processing: number; completed: number; failed: number };
    dlq: { total: number };
    degradedMode: { fallbackEvents: number };
  };

  assert.equal(metrics.assets.total, 0);
  assert.equal(metrics.jobs.total, 0);
  assert.equal(metrics.jobs.pending, 0);
  assert.equal(metrics.jobs.processing, 0);
  assert.equal(metrics.jobs.completed, 0);
  assert.equal(metrics.jobs.failed, 0);
  assert.equal(metrics.dlq.total, 0);
  assert.equal(metrics.degradedMode.fallbackEvents, 0);

  await app.close();
});
