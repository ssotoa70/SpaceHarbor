import test from "node:test";
import assert from "node:assert/strict";

import { AuthRateLimiter } from "../../src/iam/rate-limiter.js";

test("allows requests below threshold", () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 60_000 });

  // 3 failures should not trigger rate limiting
  assert.equal(limiter.recordFailure("1.2.3.4"), false);
  assert.equal(limiter.recordFailure("1.2.3.4"), false);
  assert.equal(limiter.recordFailure("1.2.3.4"), false);
  assert.equal(limiter.isLimited("1.2.3.4"), false);
});

test("blocks after exceeding max attempts", () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 60_000 });

  limiter.recordFailure("1.2.3.4");
  limiter.recordFailure("1.2.3.4");
  limiter.recordFailure("1.2.3.4");
  const blocked = limiter.recordFailure("1.2.3.4"); // 4th attempt
  assert.equal(blocked, true);
  assert.equal(limiter.isLimited("1.2.3.4"), true);
});

test("different IPs are tracked independently", () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 60_000 });

  limiter.recordFailure("1.1.1.1");
  limiter.recordFailure("1.1.1.1");
  limiter.recordFailure("1.1.1.1"); // 3rd — blocked

  assert.equal(limiter.isLimited("1.1.1.1"), true);
  assert.equal(limiter.isLimited("2.2.2.2"), false);
});

test("attempts expire after window", async () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 50 });

  limiter.recordFailure("1.2.3.4");
  limiter.recordFailure("1.2.3.4");
  limiter.recordFailure("1.2.3.4"); // blocked

  assert.equal(limiter.isLimited("1.2.3.4"), true);

  // Wait for the window to expire
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(limiter.isLimited("1.2.3.4"), false);
});

test("reset clears all state", () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 1, windowMs: 60_000 });

  limiter.recordFailure("1.2.3.4");
  limiter.recordFailure("1.2.3.4"); // blocked
  assert.equal(limiter.isLimited("1.2.3.4"), true);

  limiter.reset();
  assert.equal(limiter.isLimited("1.2.3.4"), false);
});

test("11th failed attempt triggers rate limit (default config)", () => {
  const limiter = new AuthRateLimiter(); // default: 10 attempts/minute

  for (let i = 0; i < 10; i++) {
    limiter.recordFailure("10.0.0.1");
  }
  assert.equal(limiter.isLimited("10.0.0.1"), false);

  const blocked = limiter.recordFailure("10.0.0.1"); // 11th
  assert.equal(blocked, true);
  assert.equal(limiter.isLimited("10.0.0.1"), true);
});
