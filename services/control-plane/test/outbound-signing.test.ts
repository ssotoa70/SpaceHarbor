import assert from "node:assert/strict";
import test from "node:test";

import { buildOutboundSignature } from "../src/integrations/outbound/signing.js";

test("buildOutboundSignature returns deterministic sha256 format", () => {
  const signatureA = buildOutboundSignature({
    signingSecret: "secret",
    timestamp: "1700000000",
    body: JSON.stringify({ eventType: "media.process.completed.v1", assetId: "asset-1" })
  });

  const signatureB = buildOutboundSignature({
    signingSecret: "secret",
    timestamp: "1700000000",
    body: JSON.stringify({ eventType: "media.process.completed.v1", assetId: "asset-1" })
  });

  assert.equal(signatureA, signatureB);
  assert.match(signatureA, /^sha256=[a-f0-9]{64}$/);
});
