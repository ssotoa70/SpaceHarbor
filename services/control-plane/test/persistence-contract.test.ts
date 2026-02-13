import test from "node:test";
import assert from "node:assert/strict";

import { createPersistenceAdapter, resolvePersistenceBackend } from "../src/persistence/factory";

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
