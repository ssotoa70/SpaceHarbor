import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

// ---------------------------------------------------------------------------
// processedEventIds LRU eviction (cap 10K)
// ---------------------------------------------------------------------------

test("processedEventIds evicts oldest entries when exceeding 10K cap", async () => {
  const adapter = new LocalPersistenceAdapter();

  // Insert exactly 10000 events
  for (let i = 0; i < 10_000; i++) {
    await adapter.markProcessedEvent(`event-${i}`);
  }

  // All 10000 should be present
  assert.ok(await adapter.hasProcessedEvent("event-0"), "event-0 should exist before eviction");
  assert.ok(await adapter.hasProcessedEvent("event-9999"), "event-9999 should exist");

  // Adding one more triggers 10% batch eviction (evicts ~1001 oldest)
  await adapter.markProcessedEvent("event-10000");

  assert.ok(!(await adapter.hasProcessedEvent("event-0")), "event-0 should be evicted after cap exceeded");
  // After 10% batch eviction, ~1001 oldest entries are removed
  assert.ok(!(await adapter.hasProcessedEvent("event-999")), "event-999 should be evicted (in oldest 10%)");
  assert.ok(await adapter.hasProcessedEvent("event-9999"), "event-9999 should still exist");
  assert.ok(await adapter.hasProcessedEvent("event-10000"), "event-10000 should exist");
});

test("processedEventIds 10% batch eviction on cap exceeded", async () => {
  const adapter = new LocalPersistenceAdapter();

  // Insert 10001 events to trigger eviction
  for (let i = 0; i < 10_001; i++) {
    await adapter.markProcessedEvent(`evt-${i}`);
  }

  // 10% of 10001 = 1001 oldest entries evicted
  assert.ok(!(await adapter.hasProcessedEvent("evt-0")), "evt-0 should be evicted");
  assert.ok(!(await adapter.hasProcessedEvent("evt-1000")), "evt-1000 should be evicted");
  assert.ok(await adapter.hasProcessedEvent("evt-1001"), "evt-1001 should still exist");
  assert.ok(await adapter.hasProcessedEvent("evt-10000"), "evt-10000 should still exist");
});

test("processedEventIds reset clears all entries", async () => {
  const adapter = new LocalPersistenceAdapter();

  await adapter.markProcessedEvent("a");
  await adapter.markProcessedEvent("b");
  assert.ok(await adapter.hasProcessedEvent("a"));

  adapter.reset();
  assert.ok(!(await adapter.hasProcessedEvent("a")), "after reset, event should be gone");
  assert.ok(!(await adapter.hasProcessedEvent("b")), "after reset, event should be gone");
});

// ---------------------------------------------------------------------------
// Approval audit log in persistence
// ---------------------------------------------------------------------------

test("approval audit log: append, get, filter by assetId, and reset", async () => {
  const adapter = new LocalPersistenceAdapter();

  const entry1 = {
    id: "audit-1",
    assetId: "asset-A",
    action: "request_review" as const,
    performedBy: "jane",
    note: null,
    at: "2026-03-10T00:00:00.000Z",
  };

  const entry2 = {
    id: "audit-2",
    assetId: "asset-B",
    action: "approve" as const,
    performedBy: "bob",
    note: "LGTM",
    at: "2026-03-10T00:01:00.000Z",
  };

  await adapter.appendApprovalAuditEntry(entry1);
  await adapter.appendApprovalAuditEntry(entry2);

  // getApprovalAuditLog returns a copy
  const all = await adapter.getApprovalAuditLog();
  assert.equal(all.length, 2);

  // Filter by assetId
  const forA = await adapter.getApprovalAuditLogByAssetId("asset-A");
  assert.equal(forA.length, 1);
  assert.equal(forA[0].id, "audit-1");

  const forB = await adapter.getApprovalAuditLogByAssetId("asset-B");
  assert.equal(forB.length, 1);
  assert.equal(forB[0].id, "audit-2");

  // Reset
  await adapter.resetApprovalAuditLog();
  assert.equal((await adapter.getApprovalAuditLog()).length, 0);
});

test("approval audit log is cleared by persistence.reset()", async () => {
  const adapter = new LocalPersistenceAdapter();

  await adapter.appendApprovalAuditEntry({
    id: "audit-x",
    assetId: "asset-X",
    action: "approve",
    performedBy: "tester",
    note: null,
    at: new Date().toISOString(),
  });

  assert.equal((await adapter.getApprovalAuditLog()).length, 1);
  adapter.reset();
  assert.equal((await adapter.getApprovalAuditLog()).length, 0);
});

// ---------------------------------------------------------------------------
// DCC audit trail in persistence
// ---------------------------------------------------------------------------

test("DCC audit trail: append, get, and clear", async () => {
  const adapter = new LocalPersistenceAdapter();

  const entry = {
    id: "dcc-1",
    action: "DCC export requested via Maya",
    asset_id: "asset-001",
    format: "exr",
    timestamp: new Date().toISOString(),
  };

  await adapter.appendDccAuditEntry(entry);

  const trail = await adapter.getDccAuditTrail();
  assert.equal(trail.length, 1);
  assert.equal(trail[0].action, "DCC export requested via Maya");

  await adapter.clearDccAuditTrail();
  assert.equal((await adapter.getDccAuditTrail()).length, 0);
});

test("DCC audit trail is cleared by persistence.reset()", async () => {
  const adapter = new LocalPersistenceAdapter();

  await adapter.appendDccAuditEntry({
    id: "dcc-x",
    action: "test",
    asset_id: null,
    format: null,
    timestamp: new Date().toISOString(),
  });

  assert.equal((await adapter.getDccAuditTrail()).length, 1);
  adapter.reset();
  assert.equal((await adapter.getDccAuditTrail()).length, 0);
});
