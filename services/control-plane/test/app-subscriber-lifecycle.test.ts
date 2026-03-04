import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("app starts without VAST_EVENT_BROKER_URL — subscriber skipped gracefully", async () => {
  // Ensure env var is not set
  const prev = process.env.VAST_EVENT_BROKER_URL;
  delete process.env.VAST_EVENT_BROKER_URL;

  try {
    const app = buildApp();
    // Should not throw even without broker URL
    await assert.doesNotReject(async () => { await app.ready(); });
    await app.close();
  } finally {
    if (prev !== undefined) process.env.VAST_EVENT_BROKER_URL = prev;
  }
});
