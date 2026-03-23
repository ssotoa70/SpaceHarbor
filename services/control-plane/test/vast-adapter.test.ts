import test from "node:test";
import assert from "node:assert/strict";

import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence.js";
import type { IngestResult } from "../src/domain/models.js";
import type { VastWorkflowClient } from "../src/persistence/vast/workflow-client.js";

/**
 * Helper: create a partial workflow client mock cast to the full interface.
 * In tests we only implement the methods under test; the rest are never called.
 */
function mockWorkflowClient(overrides: Partial<VastWorkflowClient>): VastWorkflowClient {
  return overrides as VastWorkflowClient;
}

test("VAST adapter delegates ingest writes through workflow client boundary", async () => {
  const calls: string[] = [];

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      createIngestAsset: async () => {
        calls.push("createIngestAsset");
        return null as unknown as IngestResult;
      }
    })
  );

  await adapter.createIngestAsset(
    {
      title: "vast-boundary-asset",
      sourceUri: "s3://bucket/vast-boundary-asset.mov"
    },
    {
      correlationId: "corr-vast-boundary-1"
    }
  );

  assert.equal(calls.includes("createIngestAsset"), true);
});

test("strict VAST mode throws when workflow client write fails", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      createIngestAsset: async () => {
        throw new Error("db write failed");
      }
    })
  );

  await assert.rejects(
    () =>
      adapter.createIngestAsset(
        {
          title: "strict-failure-asset",
          sourceUri: "s3://bucket/strict-failure-asset.mov"
        },
        {
          correlationId: "corr-vast-strict-failure"
        }
      ),
    /vast workflow client failure/i
  );
});

test("fallback VAST mode uses local store when workflow client write fails", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      createIngestAsset: async () => {
        throw new Error("temporary db outage");
      }
    })
  );

  const result = await adapter.createIngestAsset(
    {
      title: "fallback-success-asset",
      sourceUri: "s3://bucket/fallback-success-asset.mov"
    },
    {
      correlationId: "corr-vast-fallback-success"
    }
  );

  assert.ok(result.asset.id);
  assert.ok(result.job.id);
});

test("VAST adapter delegates event lifecycle and idempotency operations through workflow client", async () => {
  const calls: string[] = [];

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      setJobStatus: async () => {
        calls.push("setJobStatus");
        return null;
      },
      getJobById: async () => {
        // Return null so setJobStatus skips the transition guard
        return null;
      },
      handleJobFailure: async () => {
        calls.push("handleJobFailure");
        return {
          accepted: true,
          status: "pending" as const,
          retryScheduled: true,
          movedToDlq: false
        };
      },
      hasProcessedEvent: async () => {
        calls.push("hasProcessedEvent");
        return true;
      },
      markProcessedEvent: async () => {
        calls.push("markProcessedEvent");
      }
    })
  );

  await adapter.setJobStatus("job-1", "processing", null, { correlationId: "corr-vast-set-status" });
  await adapter.handleJobFailure("job-1", "simulated-failure", { correlationId: "corr-vast-failure" });
  const isDuplicate = await adapter.hasProcessedEvent("evt-1");
  await adapter.markProcessedEvent("evt-1");

  assert.equal(isDuplicate, true);
  assert.equal(calls.includes("setJobStatus"), true);
  assert.equal(calls.includes("handleJobFailure"), true);
  assert.equal(calls.includes("hasProcessedEvent"), true);
  assert.equal(calls.includes("markProcessedEvent"), true);
});

test("strict VAST mode throws when workflow client setJobStatus fails", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      setJobStatus: async () => {
        throw new Error("set status unavailable");
      },
      getJobById: async () => {
        // Return null so setJobStatus skips the transition guard
        return null;
      }
    })
  );

  await assert.rejects(
    () =>
      adapter.setJobStatus("job-1", "processing", null, {
        correlationId: "corr-vast-strict-set-status"
      }),
    /vast workflow client failure/i
  );
});

test("fallback VAST mode attempts setJobStatus via client then falls back to local", async () => {
  let attempts = 0;
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      setJobStatus: async () => {
        attempts += 1;
        throw new Error("set status temporary outage");
      },
      getJobById: async () => {
        // Return null so setJobStatus skips the transition guard
        return null;
      }
    })
  );

  const ingest = await adapter.createIngestAsset(
    {
      title: "set-status-fallback",
      sourceUri: "s3://bucket/set-status-fallback.mov"
    },
    {
      correlationId: "corr-set-status-fallback-ingest"
    }
  );

  const updated = await adapter.setJobStatus(ingest.job.id, "completed", null, {
    correlationId: "corr-set-status-fallback-update"
  });

  assert.equal(attempts, 1);
  assert.equal(updated?.status, "completed");
});

test("fallback VAST mode records an audit signal when client write fails", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    mockWorkflowClient({
      setJobStatus: async () => {
        throw new Error("set status unavailable");
      },
      getJobById: async () => {
        // Return null so setJobStatus skips the transition guard
        return null;
      }
    })
  );

  const ingest = await adapter.createIngestAsset(
    {
      title: "fallback-audit-signal",
      sourceUri: "s3://bucket/fallback-audit-signal.mov"
    },
    {
      correlationId: "corr-fallback-audit-signal"
    }
  );

  await adapter.setJobStatus(ingest.job.id, "completed", null, {
    correlationId: "corr-fallback-audit-update"
  });

  const events = await adapter.getAuditEvents();
  const fallbackEvent = events.find((event) =>
    event.message.includes("vast fallback") && event.message.includes("setJobStatus")
  ) as
    | {
        signal?: {
          type?: string;
          code?: string;
          severity?: string;
        };
      }
    | undefined;

  assert.ok(fallbackEvent);
  assert.equal(
    events.some((event) => event.message.includes("vast fallback") && event.message.includes("setJobStatus")),
    true
  );
  assert.equal(fallbackEvent.signal?.type, "fallback");
  assert.equal(fallbackEvent.signal?.code, "VAST_FALLBACK");
  assert.equal(fallbackEvent.signal?.severity, "warning");
});

test("VAST adapter publishes outbox items to event broker endpoint", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(null, {
        status: 202
      });
    }
  );

  await adapter.createIngestAsset(
    {
      title: "vast-outbox-asset",
      sourceUri: "s3://bucket/vast-outbox-asset.mov"
    },
    {
      correlationId: "corr-vast-outbox-1"
    }
  );

  const publishedCount = await adapter.publishOutbox({
    correlationId: "corr-vast-outbox-publish"
  });

  assert.ok(publishedCount >= 1);
  assert.ok(calls.length >= 1);
  assert.equal(calls[0].url, "https://events.example/events");
  assert.equal(typeof calls[0].body, "object");
});

test("VAST adapter publish handles broker exceptions safely", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async () => {
      throw new Error("network down");
    }
  );

  await adapter.createIngestAsset(
    {
      title: "vast-outbox-network-failure",
      sourceUri: "s3://bucket/vast-outbox-network-failure.mov"
    },
    {
      correlationId: "corr-vast-outbox-failure"
    }
  );

  const publishedCount = await adapter.publishOutbox({
    correlationId: "corr-vast-outbox-publish-failure"
  });

  assert.equal(publishedCount, 0);
});
