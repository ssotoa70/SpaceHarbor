import { test } from "node:test";
import assert from "node:assert/strict";
import { callWithRetryAndTiming, RetryExhaustedError } from "../src/infra/retry-with-timing.js";

function makeLogger(): { calls: any[]; log: any } {
  const calls: any[] = [];
  const mk = (level: string) => (...args: any[]) => calls.push({ level, args });
  return {
    calls,
    log: { info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug") } as any,
  };
}

test("first-call-succeeds: returns result and emits a single status=ok line", async () => {
  const { calls, log } = makeLogger();
  let n = 0;
  const result = await callWithRetryAndTiming(async () => { n++; return "ok"; }, {
    op: "unit-op", maxAttempts: 3, backoffMs: [1, 2], jitter: false, log,
  });
  assert.equal(result, "ok");
  assert.equal(n, 1);
  const timing = calls.filter((c) => String(c.args[0]).startsWith("[timing]"));
  assert.equal(timing.length, 1);
  assert.match(timing[0].args[0], /op=unit-op attempt=1 .*status=ok/);
});

test("retries-then-succeeds: fn called 3x, 3 timing lines", async () => {
  const { calls, log } = makeLogger();
  let n = 0;
  const result = await callWithRetryAndTiming(async () => {
    n++;
    if (n < 3) throw new Error("transient");
    return "ok";
  }, { op: "u", maxAttempts: 5, backoffMs: [1, 1, 1, 1], jitter: false, log });
  assert.equal(result, "ok");
  assert.equal(n, 3);
  const timing = calls.filter((c) => String(c.args[0]).startsWith("[timing]"));
  assert.equal(timing.length, 3);
  assert.match(timing[0].args[0], /attempt=1 .*status=retry/);
  assert.match(timing[1].args[0], /attempt=2 .*status=retry/);
  assert.match(timing[2].args[0], /attempt=3 .*status=ok/);
});

test("exhaustion: throws RetryExhaustedError preserving cause", async () => {
  const { log } = makeLogger();
  const cause = new Error("still failing");
  await assert.rejects(
    () => callWithRetryAndTiming(async () => { throw cause; }, {
      op: "u", maxAttempts: 3, backoffMs: [1, 1], jitter: false, log,
    }),
    (err: unknown) => {
      assert.ok(err instanceof RetryExhaustedError);
      assert.equal((err as RetryExhaustedError).attempts, 3);
      assert.equal((err as RetryExhaustedError).op, "u");
      assert.equal((err as RetryExhaustedError).cause, cause);
      return true;
    },
  );
});

test("shouldRetry returning false: 1 attempt then throws", async () => {
  const { log } = makeLogger();
  let n = 0;
  await assert.rejects(
    () => callWithRetryAndTiming(async () => { n++; throw new Error("fatal"); }, {
      op: "u", maxAttempts: 5, backoffMs: [1, 1], jitter: false, log,
      shouldRetry: () => false,
    }),
    /fatal/,
  );
  assert.equal(n, 1);
});

test("per-attempt timeout: AbortError thrown, counted as retryable", async () => {
  const { log } = makeLogger();
  let n = 0;
  const result = await callWithRetryAndTiming(async (): Promise<string> => {
    n++;
    if (n === 1) {
      await new Promise((r) => setTimeout(r, 200));
      return "late";
    }
    return "on-time";
  }, { op: "u", maxAttempts: 3, backoffMs: [1, 1], jitter: false,
       perAttemptTimeoutMs: 20, log });
  assert.equal(result, "on-time");
  assert.equal(n, 2);
});

test("abort mid-backoff: sleep short-circuits with AbortError", async () => {
  const { log } = makeLogger();
  const ctrl = new AbortController();
  const p = callWithRetryAndTiming(async () => { throw new Error("x"); }, {
    op: "u", maxAttempts: 5, backoffMs: [1000], jitter: false, log, signal: ctrl.signal,
  });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (err: any) => err?.name === "AbortError" || /abort/i.test(String(err)));
});

test("log format: includes op, attempt, latency_ms, cumulative_ms", async () => {
  const { calls, log } = makeLogger();
  await callWithRetryAndTiming(async () => "ok", {
    op: "myop", maxAttempts: 1, backoffMs: [], jitter: false, log,
  });
  const line = String(calls.find((c) => String(c.args[0]).startsWith("[timing]")).args[0]);
  assert.match(line, /\[timing\]/);
  assert.match(line, /op=myop/);
  assert.match(line, /attempt=1/);
  assert.match(line, /latency_ms=\d+/);
  assert.match(line, /cumulative_ms=\d+/);
});

test("jitter bounds: delays stay within ±50% over many runs", async () => {
  const { log } = makeLogger();
  const observed: number[] = [];
  const orig = setTimeout;
  (globalThis as any).setTimeout = ((fn: any, ms: number) => {
    observed.push(ms);
    return orig(fn, 0);
  }) as any;
  try {
    for (let i = 0; i < 40; i++) {
      try {
        await callWithRetryAndTiming(async () => { throw new Error("x"); }, {
          op: "u", maxAttempts: 2, backoffMs: [100], jitter: true, log,
        });
      } catch { /* expected */ }
    }
  } finally {
    (globalThis as any).setTimeout = orig;
  }
  assert.ok(observed.length > 0);
  const min = Math.min(...observed);
  const max = Math.max(...observed);
  assert.ok(min >= 50 - 1, `min=${min} below 50ms`);
  assert.ok(max <= 150 + 1, `max=${max} above 150ms`);
});
