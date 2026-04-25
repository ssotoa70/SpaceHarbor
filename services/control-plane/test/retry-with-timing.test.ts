import { describe, it, test } from "node:test";
import assert from "node:assert/strict";

import {
  callWithRetryAndTiming,
  RetryExhaustedError,
  __resetRetryCounterForTests,
} from "../src/infra/retry-with-timing.js";

function makeLog(): { log: any; lines: string[] } {
  const lines: string[] = [];
  const capture = (msg: string) => lines.push(msg);
  const log = {
    info: (obj: unknown, msg?: string) => capture(typeof obj === "string" ? obj : (msg ?? "")),
    warn: (obj: unknown, msg?: string) => capture(typeof obj === "string" ? obj : (msg ?? "")),
    error: (obj: unknown, msg?: string) => capture(typeof obj === "string" ? obj : (msg ?? "")),
    debug: () => {},
    child: () => log,
  } as any;
  return { log, lines };
}

describe("callWithRetryAndTiming", () => {
  it("returns result on first success", async () => {
    __resetRetryCounterForTests();
    const { log, lines } = makeLog();
    const result = await callWithRetryAndTiming(
      async () => "ok",
      { op: "test-op", log, maxAttempts: 3, backoffMs: [10, 20] },
    );
    assert.equal(result, "ok");
    const timing = lines.filter((l) => l.includes("[timing]"));
    assert.equal(timing.length, 1);
    assert.match(timing[0], /status=ok/);
    assert.match(timing[0], /attempt=1/);
    assert.match(timing[0], /op=test-op/);
  });

  it("retries then succeeds", async () => {
    __resetRetryCounterForTests();
    const { log, lines } = makeLog();
    let calls = 0;
    const result = await callWithRetryAndTiming(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { op: "retry-op", log, maxAttempts: 5, backoffMs: [1, 2, 3, 4] },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    const timing = lines.filter((l) => l.includes("[timing]"));
    assert.equal(timing.length, 3);
    assert.equal(timing.filter((l) => l.includes("status=retry")).length, 2);
    assert.equal(timing.filter((l) => l.includes("status=ok")).length, 1);
  });

  it("exhausts attempts and throws RetryExhaustedError with cause preserved", async () => {
    __resetRetryCounterForTests();
    const { log } = makeLog();
    const innerError = new Error("persistent");
    await assert.rejects(
      () => callWithRetryAndTiming(
        async () => { throw innerError; },
        { op: "fail-op", log, maxAttempts: 3, backoffMs: [1, 1] },
      ),
      (err: unknown) => {
        assert.ok(err instanceof RetryExhaustedError);
        assert.equal((err as RetryExhaustedError).attempts, 3);
        assert.equal((err as RetryExhaustedError).op, "fail-op");
        assert.equal((err as RetryExhaustedError).cause, innerError);
        return true;
      },
    );
  });

  it("honors shouldRetry=false predicate and throws original error", async () => {
    __resetRetryCounterForTests();
    const { log } = makeLog();
    let calls = 0;
    const innerError = new Error("non-retryable");
    await assert.rejects(
      () => callWithRetryAndTiming(
        async () => { calls++; throw innerError; },
        {
          op: "non-retry-op",
          log,
          maxAttempts: 5,
          backoffMs: [1],
          shouldRetry: () => false,
        },
      ),
      (err: unknown) => err === innerError,
    );
    assert.equal(calls, 1);
  });

  it("per-attempt timeout fires and counts as timeout outcome", async () => {
    __resetRetryCounterForTests();
    const { log, lines } = makeLog();
    await assert.rejects(
      () => callWithRetryAndTiming(
        async () => new Promise((resolve) => setTimeout(resolve, 1000)),
        {
          op: "timeout-op",
          log,
          maxAttempts: 2,
          backoffMs: [1],
          perAttemptTimeoutMs: 50,
        },
      ),
    );
    const timing = lines.filter((l) => l.includes("[timing]"));
    assert.ok(timing.some((l) => l.includes("status=timeout")));
  });

  it("abort signal mid-backoff short-circuits with AbortError", async () => {
    __resetRetryCounterForTests();
    const { log } = makeLog();
    const controller = new AbortController();
    const promise = callWithRetryAndTiming(
      async () => { throw new Error("fail once"); },
      {
        op: "abort-op",
        log,
        maxAttempts: 5,
        backoffMs: [1000, 2000],
        signal: controller.signal,
      },
    );
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => promise, (err: unknown) => {
      return (err as Error).name === "AbortError";
    });
  });

  it("log format has all required fields", async () => {
    __resetRetryCounterForTests();
    const { log, lines } = makeLog();
    await callWithRetryAndTiming(async () => "ok", { op: "fmt-op", log });
    const line = lines.find((l) => l.includes("[timing]"))!;
    assert.match(line, /\[timing\]/);
    assert.match(line, /op=fmt-op/);
    assert.match(line, /attempt=\d+/);
    assert.match(line, /latency_ms=\d+/);
    assert.match(line, /cumulative_ms=\d+/);
    assert.match(line, /status=\w+/);
  });

  it("emits status=error (not status=non_retryable) on shouldRetry=false", async () => {
    __resetRetryCounterForTests();
    const { log, lines } = makeLog();
    await assert.rejects(
      () => callWithRetryAndTiming(
        async () => { throw new Error("persistent"); },
        { op: "err-op", log, maxAttempts: 5, backoffMs: [1], shouldRetry: () => false },
      ),
    );
    const timing = lines.filter((l) => l.includes("[timing]"));
    assert.equal(timing.length, 1);
    assert.match(timing[0], /status=error/);
    assert.ok(!timing[0].includes("status=non_retryable"), "should not emit status=non_retryable in logs");
  });

  it("passes an AbortSignal to fn that is aborted when perAttemptTimeoutMs fires", async () => {
    __resetRetryCounterForTests();
    const { log } = makeLog();
    let signalSeenByFn: AbortSignal | undefined;
    let abortObservedByFn = false;
    await assert.rejects(
      () => callWithRetryAndTiming(
        async (signal) => {
          signalSeenByFn = signal;
          // Park long enough for the timeout to fire; note whether the
          // signal aborts during our wait.
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              abortObservedByFn = true;
              reject(new Error("fn observed abort"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            setTimeout(resolve, 500);
          });
        },
        { op: "cancel-op", log, maxAttempts: 1, backoffMs: [1], perAttemptTimeoutMs: 30 },
      ),
    );
    assert.ok(signalSeenByFn, "fn should have received an AbortSignal argument");
    assert.equal(abortObservedByFn, true, "fn's abort listener should have fired");
  });

  it("jitter stays within ±50% of base backoff across 50 runs", async () => {
    const base = 100;
    const delays: number[] = [];
    for (let i = 0; i < 50; i++) {
      const { log } = makeLog();
      let calls = 0;
      const started = Date.now();
      await callWithRetryAndTiming(
        async () => {
          calls++;
          if (calls === 1) throw new Error("once");
          return "ok";
        },
        { op: "jitter-op", log, maxAttempts: 2, backoffMs: [base], jitter: true },
      );
      delays.push(Date.now() - started);
    }
    const minExpected = base * 0.5;
    const maxExpected = base * 1.5 + 200;
    for (const d of delays) {
      assert.ok(d >= minExpected - 20, `delay ${d} below min ${minExpected}`);
      assert.ok(d <= maxExpected, `delay ${d} above max ${maxExpected}`);
    }
  });
});
