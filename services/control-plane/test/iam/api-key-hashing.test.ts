import test from "node:test";
import assert from "node:assert/strict";

import { hashApiKey, verifyApiKey, isApiKeyExpired, calculateApiKeyExpiration } from "../../src/iam/api-key-hashing.js";

test("hashApiKey returns hex-encoded hash and salt", async () => {
  const result = await hashApiKey("my-secret-key");
  assert.ok(result.hash.length === 128); // 64 bytes = 128 hex chars
  assert.ok(result.salt.length === 32);  // 16 bytes = 32 hex chars
  assert.ok(/^[0-9a-f]+$/.test(result.hash));
  assert.ok(/^[0-9a-f]+$/.test(result.salt));
});

test("different salts produce different hashes for same key", async () => {
  const r1 = await hashApiKey("same-key");
  const r2 = await hashApiKey("same-key");
  assert.notEqual(r1.salt, r2.salt);
  assert.notEqual(r1.hash, r2.hash);
});

test("verifyApiKey returns true for correct key", async () => {
  const { hash, salt } = await hashApiKey("test-key-123");
  const isValid = await verifyApiKey("test-key-123", hash, salt);
  assert.equal(isValid, true);
});

test("verifyApiKey returns false for wrong key", async () => {
  const { hash, salt } = await hashApiKey("correct-key");
  const isValid = await verifyApiKey("wrong-key", hash, salt);
  assert.equal(isValid, false);
});

test("verifyApiKey returns false for wrong salt", async () => {
  const { hash } = await hashApiKey("test-key");
  // Use a random 16-byte salt (different from the original)
  const wrongSalt = "00".repeat(16);
  const isValid = await verifyApiKey("test-key", hash, wrongSalt);
  assert.equal(isValid, false);
});

// ---------------------------------------------------------------------------
// API key expiration
// ---------------------------------------------------------------------------

test("isApiKeyExpired returns false for null expiration", () => {
  assert.equal(isApiKeyExpired(null), false);
});

test("isApiKeyExpired returns false for future expiration", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  assert.equal(isApiKeyExpired(future), false);
});

test("isApiKeyExpired returns true for past expiration", () => {
  const past = new Date(Date.now() - 86400_000).toISOString();
  assert.equal(isApiKeyExpired(past), true);
});

test("calculateApiKeyExpiration returns future date", () => {
  const expiration = calculateApiKeyExpiration();
  const expiresAt = new Date(expiration);
  assert.ok(expiresAt.getTime() > Date.now());
  // Default 365 days — should be roughly a year from now
  const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  assert.ok(diffDays > 360 && diffDays < 370);
});

test("calculateApiKeyExpiration respects SPACEHARBOR_API_KEY_MAX_AGE_DAYS", () => {
  const backup = process.env.SPACEHARBOR_API_KEY_MAX_AGE_DAYS;
  try {
    process.env.SPACEHARBOR_API_KEY_MAX_AGE_DAYS = "7";
    const expiration = calculateApiKeyExpiration();
    const diffDays = (new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays > 6 && diffDays < 8);
  } finally {
    if (backup === undefined) delete process.env.SPACEHARBOR_API_KEY_MAX_AGE_DAYS;
    else process.env.SPACEHARBOR_API_KEY_MAX_AGE_DAYS = backup;
  }
});
