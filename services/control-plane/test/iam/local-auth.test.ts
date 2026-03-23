import test from "node:test";
import assert from "node:assert/strict";

import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  LoginThrottler,
} from "../../src/iam/local-auth.js";

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

test("hashPassword returns salt:hash format", async () => {
  const result = await hashPassword("SecurePassword1!");
  assert.ok(result.includes(":"));
  const [salt, hash] = result.split(":");
  assert.equal(salt.length, 32); // 16 bytes = 32 hex chars
  assert.equal(hash.length, 128); // 64 bytes = 128 hex chars
});

test("hashPassword produces different hashes for same password (random salt)", async () => {
  const h1 = await hashPassword("SecurePassword1!");
  const h2 = await hashPassword("SecurePassword1!");
  assert.notEqual(h1, h2);
});

test("verifyPassword returns true for correct password", async () => {
  const hash = await hashPassword("MySecret123ABC");
  const result = await verifyPassword("MySecret123ABC", hash);
  assert.equal(result, true);
});

test("verifyPassword returns false for wrong password", async () => {
  const hash = await hashPassword("MySecret123ABC");
  const result = await verifyPassword("WrongPassword99", hash);
  assert.equal(result, false);
});

test("verifyPassword returns false for malformed hash", async () => {
  const result = await verifyPassword("anything", "not-a-valid-hash");
  assert.equal(result, false);
});

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

test("validatePasswordPolicy accepts strong password", () => {
  const result = validatePasswordPolicy("SecurePass123!");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validatePasswordPolicy rejects short password", () => {
  const result = validatePasswordPolicy("Short1Ab");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("12 characters")));
});

test("validatePasswordPolicy rejects missing uppercase", () => {
  const result = validatePasswordPolicy("alllowercase123");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("uppercase")));
});

test("validatePasswordPolicy rejects missing lowercase", () => {
  const result = validatePasswordPolicy("ALLUPPERCASE123");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("lowercase")));
});

test("validatePasswordPolicy rejects missing digit", () => {
  const result = validatePasswordPolicy("NoDigitsHereABC");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("digit")));
});

test("validatePasswordPolicy returns multiple errors", () => {
  const result = validatePasswordPolicy("short");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});

// ---------------------------------------------------------------------------
// Login throttler
// ---------------------------------------------------------------------------

test("LoginThrottler allows first attempt", () => {
  const throttler = new LoginThrottler({ maxAttempts: 3 });
  assert.equal(throttler.isAllowed("user@test.com"), true);
});

test("LoginThrottler blocks after max attempts", () => {
  const throttler = new LoginThrottler({ maxAttempts: 3, windowMs: 60000, lockoutMs: 60000 });
  throttler.recordFailure("user@test.com");
  throttler.recordFailure("user@test.com");
  throttler.recordFailure("user@test.com");
  assert.equal(throttler.isAllowed("user@test.com"), false);
});

test("LoginThrottler allows different emails independently", () => {
  const throttler = new LoginThrottler({ maxAttempts: 2 });
  throttler.recordFailure("a@test.com");
  throttler.recordFailure("a@test.com");
  assert.equal(throttler.isAllowed("a@test.com"), false);
  assert.equal(throttler.isAllowed("b@test.com"), true);
});

test("LoginThrottler reset clears state", () => {
  const throttler = new LoginThrottler({ maxAttempts: 2 });
  throttler.recordFailure("a@test.com");
  throttler.recordFailure("a@test.com");
  assert.equal(throttler.isAllowed("a@test.com"), false);
  throttler.reset("a@test.com");
  assert.equal(throttler.isAllowed("a@test.com"), true);
});

test("LoginThrottler getAttempts returns count", () => {
  const throttler = new LoginThrottler();
  assert.equal(throttler.getAttempts("x@test.com"), 0);
  throttler.recordFailure("x@test.com");
  assert.equal(throttler.getAttempts("x@test.com"), 1);
  throttler.recordFailure("x@test.com");
  assert.equal(throttler.getAttempts("x@test.com"), 2);
});

test("LoginThrottler recordFailure returns attempt count", () => {
  const throttler = new LoginThrottler();
  assert.equal(throttler.recordFailure("y@test.com"), 1);
  assert.equal(throttler.recordFailure("y@test.com"), 2);
  assert.equal(throttler.recordFailure("y@test.com"), 3);
});
