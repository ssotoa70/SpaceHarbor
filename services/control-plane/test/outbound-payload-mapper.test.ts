import assert from "node:assert/strict";
import test from "node:test";

import type { OutboxItem } from "../src/domain/models.js";
import { mapOutboxItemToOutboundPayload } from "../src/integrations/outbound/payload-mapper";

function makeOutboxItem(eventType: string): OutboxItem {
  return {
    id: "outbox-1",
    eventType,
    correlationId: "corr-1",
    payload: {
      assetId: "asset-1",
      jobId: "job-1"
    },
    createdAt: "2026-02-20T00:00:00.000Z",
    publishedAt: null
  };
}

test("maps outbox item to outbound envelope for slack", () => {
  const payload = mapOutboxItemToOutboundPayload(makeOutboxItem("media.process.completed.v1"), "slack");

  assert.equal(payload.eventType, "media.process.completed.v1");
  assert.equal(payload.assetId, "asset-1");
  assert.equal(payload.jobId, "job-1");
  assert.equal(payload.status, "completed");
  assert.equal(payload.schemaVersion, "1.0");
  assert.match(payload.summary, /slack:/);
});

test("maps outbox item to outbound envelope for teams and production", () => {
  const teamsPayload = mapOutboxItemToOutboundPayload(makeOutboxItem("media.process.claimed.v1"), "teams");
  assert.equal(teamsPayload.status, "processing");
  assert.match(teamsPayload.summary, /teams:/);

  const productionPayload = mapOutboxItemToOutboundPayload(makeOutboxItem("media.process.failed.v1"), "production");
  assert.equal(productionPayload.status, "failed");
  assert.match(productionPayload.summary, /production:/);
});
