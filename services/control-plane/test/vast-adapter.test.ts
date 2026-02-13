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
