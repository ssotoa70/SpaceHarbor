import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import type { VastWorkflowClient } from "../src/persistence/vast/workflow-client.js";

function createBridgedVastAdapter() {
  const backing = new LocalPersistenceAdapter();
  const calls = {
    setJobStatus: 0,
    handleJobFailure: 0,
    hasProcessedEvent: 0,
    markProcessedEvent: 0,
    previewAuditRetention: 0,
    applyAuditRetention: 0
  };

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 202 }),
    ({
      createIngestAsset: (input, context) => backing.createIngestAsset(input, context),
      getJobById: (jobId) => backing.getJobById(jobId),
      claimNextJob: (workerId, leaseSeconds, context) => backing.claimNextJob(workerId, leaseSeconds, context),
      heartbeatJob: (jobId, workerId, leaseSeconds, context) => backing.heartbeatJob(jobId, workerId, leaseSeconds, context),
      replayJob: (jobId, context) => backing.replayJob(jobId, context),
      setJobStatus: (jobId, status, lastError, context) => {
        calls.setJobStatus += 1;
        return backing.setJobStatus(jobId, status, lastError, context);
      },
      handleJobFailure: (jobId, error, context) => {
        calls.handleJobFailure += 1;
        return backing.handleJobFailure(jobId, error, context);
      },
      hasProcessedEvent: (eventId) => {
        calls.hasProcessedEvent += 1;
        return backing.hasProcessedEvent(eventId);
      },
      markProcessedEvent: (eventId) => {
        calls.markProcessedEvent += 1;
        return backing.markProcessedEvent(eventId);
      },
      previewAuditRetention: (cutoffIso) => {
        calls.previewAuditRetention += 1;
        return backing.previewAuditRetention(cutoffIso);
      },
      applyAuditRetention: (cutoffIso, maxDeletePerRun) => {
        calls.applyAuditRetention += 1;
        return backing.applyAuditRetention(cutoffIso, maxDeletePerRun);
      }
    } satisfies Partial<VastWorkflowClient>) as VastWorkflowClient
  );

  return {
    adapter,
    calls
  };
}

test("VAST mode ingest preserves v1 response contract", async () => {
  const previousBackend = process.env.SPACEHARBOR_PERSISTENCE_BACKEND;
  process.env.SPACEHARBOR_PERSISTENCE_BACKEND = "vast";

  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "vast-mode-contract-asset",
      sourceUri: "s3://bucket/vast-mode-contract-asset.mov"
    }
  });

  assert.equal(ingest.statusCode, 201);
  assert.ok(ingest.json().asset.id);
  assert.ok(ingest.json().job.id);

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "worker-vast-contract"
    }
  });

  assert.equal(claim.statusCode, 200);
  assert.ok(claim.json().job);

  await app.close();
  if (previousBackend === undefined) {
    delete process.env.SPACEHARBOR_PERSISTENCE_BACKEND;
  } else {
    process.env.SPACEHARBOR_PERSISTENCE_BACKEND = previousBackend;
  }
});

test("strict VAST workflow failures return unified 500 envelope", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async () => new Response(null, { status: 200 }),
    {
      createIngestAsset: () => {
        throw new Error("database unavailable");
      }
    } as unknown as VastWorkflowClient
  );

  const app = buildApp({
    persistenceAdapter: adapter
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "strict-vast-failure",
      sourceUri: "s3://bucket/strict-vast-failure.mov"
    }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "INTERNAL_ERROR");
  assert.equal(typeof response.json().requestId, "string");
  assert.deepEqual(Object.keys(response.json()).sort(), ["code", "details", "message", "requestId"]);

  await app.close();
});

test("VAST adapter delegates audit retention preview/apply through workflow client", async () => {
  const { adapter, calls } = createBridgedVastAdapter();

  const ingest = await adapter.createIngestAsset(
    {
      title: "vast-retention-delegate",
      sourceUri: "s3://bucket/vast-retention-delegate.mov"
    },
    { correlationId: "corr-vast-retention-delegate", now: "2025-10-01T00:00:00.000Z" }
  );
  assert.ok(ingest.job.id);

  const preview = await adapter.previewAuditRetention("2026-01-01T00:00:00.000Z");
  assert.equal(preview.eligibleCount, 1);

  const apply = await adapter.applyAuditRetention("2026-01-01T00:00:00.000Z");
  assert.equal(apply.deletedCount, 1);

  assert.equal(calls.previewAuditRetention, 1);
  assert.equal(calls.applyAuditRetention, 1);
});

test("strict VAST retention operations fail fast when workflow client throws", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async () => new Response(null, { status: 202 }),
    {
      previewAuditRetention: () => {
        throw new Error("retention preview unavailable");
      }
    } as unknown as VastWorkflowClient
  );

  await assert.rejects(
    () => adapter.previewAuditRetention("2026-01-01T00:00:00.000Z"),
    /vast workflow client failure \(previewAuditRetention\): retention preview unavailable/i
  );
});

test("VAST mode /api/v1/events preserves duplicate-event behavior and uses workflow idempotency path", async () => {
  const { adapter, calls } = createBridgedVastAdapter();
  const app = buildApp({ persistenceAdapter: adapter });

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "vast-events-duplicate-asset",
      sourceUri: "s3://bucket/vast-events-duplicate-asset.mov"
    }
  });

  assert.equal(ingest.statusCode, 201);
  const ingestBody = ingest.json();

  const payload = {
    eventId: "evt-vast-dup-1",
    eventType: "asset.processing.started",
    eventVersion: "1.0",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-vast-dup-1",
    producer: "media-worker",
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
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, false);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload
  });
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);

  assert.equal(calls.setJobStatus >= 1, true);
  assert.equal(calls.hasProcessedEvent >= 2, true);
  assert.equal(calls.markProcessedEvent, 1);

  await app.close();
});

test("VAST mode /api/v1/events preserves retry scheduling and DLQ transition behavior", async () => {
  const { adapter, calls } = createBridgedVastAdapter();
  const app = buildApp({ persistenceAdapter: adapter });

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "vast-events-retry-asset",
      sourceUri: "s3://bucket/vast-events-retry-asset.mov"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const ingestBody = ingest.json();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = await app.inject({
      method: "POST",
      url: "/api/v1/queue/claim",
      payload: {
        workerId: `vast-worker-${attempt}`,
        leaseSeconds: 15,
        now: new Date(Date.now() + attempt * 60_000).toISOString()
      }
    });
    assert.equal(claim.statusCode, 200);

    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        eventId: `evt-vast-failure-${attempt}`,
        eventType: "asset.processing.failed",
        eventVersion: "1.0",
        occurredAt: new Date().toISOString(),
        correlationId: `corr-vast-failure-${attempt}`,
        producer: "media-worker",
        data: {
          assetId: ingestBody.asset.id,
          jobId: ingestBody.job.id,
          error: "transcode-timeout"
        }
      }
    });

    assert.equal(failed.statusCode, 202);
    if (attempt < 3) {
      assert.equal(failed.json().retryScheduled, true);
      assert.equal(failed.json().movedToDlq, false);
    } else {
      assert.equal(failed.json().retryScheduled, false);
      assert.equal(failed.json().movedToDlq, true);
    }
  }

  assert.equal(calls.handleJobFailure, 3);

  await app.close();
});

test("VAST mode surfaces fallback usage in audit trail", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 202 }),
    {
      createIngestAsset: () => {
        throw new Error("vast db unavailable");
      }
    } as unknown as VastWorkflowClient
  );

  const app = buildApp({ persistenceAdapter: adapter });

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "fallback-audit-route-signal",
      sourceUri: "s3://bucket/fallback-audit-route-signal.mov"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const audit = await app.inject({
    method: "GET",
    url: "/api/v1/audit"
  });
  assert.equal(audit.statusCode, 200);
  const fallbackEvent = audit
    .json()
    .events.find(
      (event: {
        message: string;
        signal?: {
          type?: string;
          code?: string;
          severity?: string;
        };
      }) => event.message.includes("vast fallback") && event.message.includes("createIngestAsset")
    );

  assert.ok(fallbackEvent);
  assert.equal(
    audit.json().events.some((event: { message: string }) => event.message.includes("vast fallback") && event.message.includes("createIngestAsset")),
    true
  );
  assert.equal(fallbackEvent.signal?.type, "fallback");
  assert.equal(fallbackEvent.signal?.code, "VAST_FALLBACK");
  assert.equal(fallbackEvent.signal?.severity, "warning");

  const metrics = await app.inject({
    method: "GET",
    url: "/api/v1/metrics"
  });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json().degradedMode.fallbackEvents >= 1, true);

  await app.close();
});
