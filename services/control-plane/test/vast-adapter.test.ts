import test from "node:test";
import assert from "node:assert/strict";

import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence";

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
