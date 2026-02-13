import test from "node:test";
import assert from "node:assert/strict";

import { createPersistenceAdapter, resolvePersistenceBackend, resolveVastFallbackToLocal } from "../src/persistence/factory";

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
