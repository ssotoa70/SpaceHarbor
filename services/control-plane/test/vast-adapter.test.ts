import test from "node:test";
import assert from "node:assert/strict";

import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence";

test("VAST adapter delegates ingest writes through workflow client boundary", () => {
  const calls: string[] = [];

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true
    },
    async () => new Response(null, { status: 200 }),
    {
      createIngestAsset: () => {
        calls.push("createIngestAsset");
        return null;
      }
    }
  );

  adapter.createIngestAsset(
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

test("strict VAST mode throws when workflow client write fails", () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    {
      createIngestAsset: () => {
        throw new Error("db write failed");
      }
    }
  );

  assert.throws(
    () => {
      adapter.createIngestAsset(
        {
          title: "strict-failure-asset",
          sourceUri: "s3://bucket/strict-failure-asset.mov"
        },
        {
          correlationId: "corr-vast-strict-failure"
        }
      );
    },
    /vast workflow client failure/i
  );
});

test("fallback VAST mode uses local store when workflow client write fails", () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    {
      createIngestAsset: () => {
        throw new Error("temporary db outage");
      }
    }
  );

  const result = adapter.createIngestAsset(
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

test("VAST adapter delegates event lifecycle and idempotency operations through workflow client", () => {
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
    {
      setJobStatus: () => {
        calls.push("setJobStatus");
        return null;
      },
      handleJobFailure: () => {
        calls.push("handleJobFailure");
        return {
          accepted: true,
          status: "pending",
          retryScheduled: true,
          movedToDlq: false
        };
      },
      hasProcessedEvent: () => {
        calls.push("hasProcessedEvent");
        return true;
      },
      markProcessedEvent: () => {
        calls.push("markProcessedEvent");
      }
    }
  );

  adapter.setJobStatus("job-1", "processing", null, { correlationId: "corr-vast-set-status" });
  adapter.handleJobFailure("job-1", "simulated-failure", { correlationId: "corr-vast-failure" });
  const isDuplicate = adapter.hasProcessedEvent("evt-1");
  adapter.markProcessedEvent("evt-1");

  assert.equal(isDuplicate, true);
  assert.equal(calls.includes("setJobStatus"), true);
  assert.equal(calls.includes("handleJobFailure"), true);
  assert.equal(calls.includes("hasProcessedEvent"), true);
  assert.equal(calls.includes("markProcessedEvent"), true);
});

test("strict VAST mode throws when workflow client setJobStatus fails", () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    {
      setJobStatus: () => {
        throw new Error("set status unavailable");
      }
    }
  );

  assert.throws(
    () => {
      adapter.setJobStatus("job-1", "processing", null, {
        correlationId: "corr-vast-strict-set-status"
      });
    },
    /vast workflow client failure/i
  );
});

test("fallback VAST mode attempts setJobStatus via client then falls back to local", () => {
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
    {
      setJobStatus: () => {
        attempts += 1;
        throw new Error("set status temporary outage");
      }
    }
  );

  const ingest = adapter.createIngestAsset(
    {
      title: "set-status-fallback",
      sourceUri: "s3://bucket/set-status-fallback.mov"
    },
    {
      correlationId: "corr-set-status-fallback-ingest"
    }
  );

  const updated = adapter.setJobStatus(ingest.job.id, "completed", null, {
    correlationId: "corr-set-status-fallback-update"
  });

  assert.equal(attempts, 1);
  assert.equal(updated?.status, "completed");
});

test("fallback VAST mode records an audit signal when client write fails", () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 200 }),
    {
      setJobStatus: () => {
        throw new Error("set status unavailable");
      }
    }
  );

  const ingest = adapter.createIngestAsset(
    {
      title: "fallback-audit-signal",
      sourceUri: "s3://bucket/fallback-audit-signal.mov"
    },
    {
      correlationId: "corr-fallback-audit-signal"
    }
  );

  adapter.setJobStatus(ingest.job.id, "completed", null, {
    correlationId: "corr-fallback-audit-update"
  });

  const events = adapter.getAuditEvents();
  assert.equal(
    events.some((event) => event.message.includes("vast fallback") && event.message.includes("setJobStatus")),
    true
  );
});

test("VAST adapter publishes outbox items to event broker endpoint", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];

  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true
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

  adapter.createIngestAsset(
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
      strict: true
    },
    async () => {
      throw new Error("network down");
    }
  );

  adapter.createIngestAsset(
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
