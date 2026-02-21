import test from "node:test";
import assert from "node:assert/strict";

import { createPersistenceAdapter, resolvePersistenceBackend, resolveVastFallbackToLocal } from "../src/persistence/factory";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence";
import type { OutboundNotifier } from "../src/integrations/outbound/notifier";
import type { OutboundConfig } from "../src/integrations/outbound/types";

test("persistence backend resolution defaults to local", () => {
  assert.equal(resolvePersistenceBackend(undefined), "local");
  assert.equal(resolvePersistenceBackend(""), "local");
});

test("persistence backend resolution accepts supported values", () => {
  assert.equal(resolvePersistenceBackend("local"), "local");
  assert.equal(resolvePersistenceBackend("LOCAL"), "local");
  assert.equal(resolvePersistenceBackend("vast"), "vast");
});

test("persistence backend resolution rejects unsupported values", () => {
  assert.throws(() => resolvePersistenceBackend("sqlite"), /unsupported persistence backend/i);
});

test("persistence adapter factory returns requested adapter", () => {
  assert.equal(createPersistenceAdapter().backend, "local");
  assert.equal(createPersistenceAdapter("vast").backend, "vast");
});

test("strict VAST mode requires full endpoint configuration", () => {
  const previous = {
    strict: process.env.ASSETHARBOR_VAST_STRICT,
    db: process.env.VAST_DATABASE_URL,
    broker: process.env.VAST_EVENT_BROKER_URL,
    engine: process.env.VAST_DATAENGINE_URL
  };

  process.env.ASSETHARBOR_VAST_STRICT = "true";
  delete process.env.VAST_DATABASE_URL;
  delete process.env.VAST_EVENT_BROKER_URL;
  delete process.env.VAST_DATAENGINE_URL;

  assert.throws(() => createPersistenceAdapter("vast"), /missing required VAST configuration/i);

  if (previous.strict === undefined) {
    delete process.env.ASSETHARBOR_VAST_STRICT;
  } else {
    process.env.ASSETHARBOR_VAST_STRICT = previous.strict;
  }

  if (previous.db === undefined) {
    delete process.env.VAST_DATABASE_URL;
  } else {
    process.env.VAST_DATABASE_URL = previous.db;
  }

  if (previous.broker === undefined) {
    delete process.env.VAST_EVENT_BROKER_URL;
  } else {
    process.env.VAST_EVENT_BROKER_URL = previous.broker;
  }

  if (previous.engine === undefined) {
    delete process.env.VAST_DATAENGINE_URL;
  } else {
    process.env.VAST_DATAENGINE_URL = previous.engine;
  }
});

test("VAST fallback policy defaults to local fallback unless explicitly false", () => {
  assert.equal(resolveVastFallbackToLocal(undefined), true);
  assert.equal(resolveVastFallbackToLocal(""), true);
  assert.equal(resolveVastFallbackToLocal("true"), true);
  assert.equal(resolveVastFallbackToLocal("TRUE"), true);
  assert.equal(resolveVastFallbackToLocal("false"), false);
});

test("local persistence exposes null-safe preview and annotation metadata defaults", () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = persistence.createIngestAsset(
    {
      title: "preview-defaults",
      sourceUri: "s3://bucket/preview-defaults.mov"
    },
    { correlationId: "corr-preview-defaults" }
  );

  assert.equal(ingest.job.thumbnail, null);
  assert.equal(ingest.job.proxy, null);
  assert.deepEqual(ingest.job.annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });

  const row = persistence.listAssetQueueRows()[0];
  assert.equal(row.thumbnail, null);
  assert.equal(row.proxy, null);
  assert.deepEqual(row.annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });
});

test("local outbox publish sends webhook notifications and marks items published", async () => {
  const deliveredTargets: string[] = [];
  const notifier: OutboundNotifier = {
    notify: async (target) => {
      deliveredTargets.push(target.target);
    }
  };

  const outboundConfig: OutboundConfig = {
    strictMode: false,
    signingSecret: "secret",
    targets: [
      { target: "slack", url: "https://hooks.example.com/slack" },
      { target: "teams", url: "https://hooks.example.com/teams" }
    ]
  };

  const persistence = new LocalPersistenceAdapter(outboundConfig, notifier);
  persistence.createIngestAsset(
    {
      title: "outbound-success",
      sourceUri: "s3://bucket/outbound-success.mov"
    },
    { correlationId: "corr-outbound-success" }
  );

  const published = await persistence.publishOutbox({ correlationId: "corr-outbound-publish" });
  assert.equal(published, 1);
  assert.deepEqual(deliveredTargets, ["slack", "teams"]);

  const stats = persistence.getWorkflowStats();
  assert.equal(stats.outbound.attempts, 2);
  assert.equal(stats.outbound.success, 2);
  assert.equal(stats.outbound.failure, 0);
});

test("local outbox publish keeps item pending when webhook delivery fails", async () => {
  const notifier: OutboundNotifier = {
    notify: async (target) => {
      if (target.target === "production") {
        throw new Error("simulated webhook failure");
      }
    }
  };

  const outboundConfig: OutboundConfig = {
    strictMode: false,
    signingSecret: "secret",
    targets: [{ target: "production", url: "https://hooks.example.com/production" }]
  };

  const persistence = new LocalPersistenceAdapter(outboundConfig, notifier);
  persistence.createIngestAsset(
    {
      title: "outbound-failure",
      sourceUri: "s3://bucket/outbound-failure.mov"
    },
    { correlationId: "corr-outbound-failure" }
  );

  const published = await persistence.publishOutbox({ correlationId: "corr-outbound-publish-failure" });
  assert.equal(published, 0);

  const outboxItems = persistence.getOutboxItems().filter((item) => !item.publishedAt);
  assert.equal(outboxItems.length, 1);

  const stats = persistence.getWorkflowStats();
  assert.equal(stats.outbound.attempts, 1);
  assert.equal(stats.outbound.success, 0);
  assert.equal(stats.outbound.failure, 1);
});
