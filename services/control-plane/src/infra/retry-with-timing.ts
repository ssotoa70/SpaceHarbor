/**
 * callWithRetryAndTiming — standardized retry + timing wrapper.
 *
 * Wraps any async operation with:
 *   - exponential backoff with optional ±50% jitter
 *   - per-attempt timeout ceiling (via AbortController)
 *   - caller-supplied shouldRetry predicate
 *   - external AbortSignal for mid-backoff cancellation
 *   - [timing] structured log line per attempt
 *   - retry_attempts_total{op,outcome} Prometheus counter
 *
 * Matches the infra/ module style (functional exports; class only for
 * distinct error types).
 *
 * See docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md.
 */

import type { FastifyBaseLogger } from "fastify";

import { retryAttemptsTotal } from "./metrics.js";

export type RetryOutcome =
  | "ok"
  | "retry"
  | "non_retryable"
  | "exhausted"
  | "timeout";

export interface RetryOptions {
  /** Operation name — goes into [timing] log prefix and the metric's op label. */
  op: string;
  /** Number of attempts (default: 6). */
  maxAttempts?: number;
  /** Base backoff schedule in ms (default: [5000, 15000, 30000, 60000, 120000]). */
  backoffMs?: readonly number[];
  /** ±50% jitter (default: true). */
  jitter?: boolean;
  /** Per-attempt timeout ceiling in ms (default: none). */
  perAttemptTimeoutMs?: number;
  /** Predicate — false means stop retrying. Default: retry on any Error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** AbortSignal for mid-backoff cancellation. */
  signal?: AbortSignal;
  /** Fastify logger or compatible (has .info). */
  log: FastifyBaseLogger;
}

/** Thrown when all attempts are exhausted. Preserves the last cause. */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly op: string;
  override readonly cause: unknown;
  constructor(op: string, attempts: number, cause: unknown) {
    super(`retry exhausted for op=${op} after ${attempts} attempts`);
    this.name = "RetryExhaustedError";
    this.op = op;
    this.attempts = attempts;
    this.cause = cause;
  }
}

const DEFAULT_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000] as const;
const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * Test-only helper: counter state placeholder. Kept so tests can call it.
 *
 * The Prometheus counter in infra/metrics.ts is process-global. Rather than
 * reset it (which would fight the registry singleton), tests assert on log
 * shape / behavior rather than absolute counter values.
 */
export function __resetRetryCounterForTests(): void {
  // No-op today; Prometheus counters in infra/metrics.ts are process-global.
  // Tests use incremental/format assertions rather than absolute values.
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runWithTimeout<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number | undefined,
  parentSignal?: AbortSignal,
): Promise<T> {
  // When no timeout AND no parent signal, no orchestration needed.
  if (!timeoutMs && !parentSignal) return fn();

  const controller = new AbortController();
  // Forward the caller's AbortSignal into the inner controller so fn
  // sees it as a unified abort source (timeout OR external cancel).
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (timeoutMs) {
      timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }
    // Race the fn against an abort-rejecting promise so we see timeouts
    // even if fn doesn't respect the signal.
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        const err = new Error(timeoutMs ? `attempt exceeded ${timeoutMs}ms` : "aborted");
        err.name = timeoutMs ? "TimeoutError" : "AbortError";
        reject(err);
      };
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    // Swallow unhandled rejection on the losing side of the race: if fn()
    // rejects after abortPromise wins, Node would otherwise warn.
    const fnPromise = fn(controller.signal);
    fnPromise.catch(() => {});
    return await Promise.race([fnPromise, abortPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

function jitterAround(baseMs: number, jitter: boolean): number {
  if (!jitter) return baseMs;
  return Math.round(baseMs * (0.5 + Math.random()));
}

/**
 * Map metric outcome label → log status token.
 *
 * Spec (Layer A error model): log `status=error` for non-retryable failures
 * while the metric retains `outcome="non_retryable"`. All other outcomes
 * pass through unchanged.
 */
function logStatusFor(outcome: RetryOutcome): string {
  return outcome === "non_retryable" ? "error" : outcome;
}

function emitTimingLine(
  log: FastifyBaseLogger,
  fields: {
    op: string;
    attempt: number;
    latencyMs: number;
    cumulativeMs: number;
    outcome: RetryOutcome;
    reason?: string;
  },
): void {
  const parts = [
    "[timing]",
    `op=${fields.op}`,
    `attempt=${fields.attempt}`,
    `latency_ms=${fields.latencyMs}`,
    `cumulative_ms=${fields.cumulativeMs}`,
    `status=${logStatusFor(fields.outcome)}`,
  ];
  if (fields.reason) {
    const reason = fields.reason.replace(/\s+/g, " ").slice(0, 180);
    parts.push(`reason=${reason}`);
  }
  log.info(parts.join(" "));
}

/**
 * Execute `fn` with retry + timing + metric emission.
 *
 * Invariants:
 *   - Emits exactly one [timing] log line per attempt.
 *   - Increments retry_attempts_total{op, outcome} per attempt.
 *   - On all-attempts-fail, throws RetryExhaustedError wrapping the last cause.
 *   - On shouldRetry=false, throws the original error directly (no wrapper).
 */
export async function callWithRetryAndTiming<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const jitter = opts.jitter ?? true;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      const err = new Error("aborted before attempt");
      err.name = "AbortError";
      throw err;
    }
    const attemptStartedAt = Date.now();
    try {
      const result = await runWithTimeout(fn, opts.perAttemptTimeoutMs, opts.signal);
      const now = Date.now();
      emitTimingLine(opts.log, {
        op: opts.op,
        attempt,
        latencyMs: now - attemptStartedAt,
        cumulativeMs: now - startedAt,
        outcome: "ok",
      });
      retryAttemptsTotal.inc({ op: opts.op, outcome: "ok" });
      return result;
    } catch (err) {
      lastError = err;
      const now = Date.now();
      const isTimeout = (err as { name?: string })?.name === "TimeoutError";
      const retryable = shouldRetry(err, attempt);
      const willRetry = retryable && attempt < maxAttempts;
      const outcome: RetryOutcome = !retryable
        ? "non_retryable"
        : attempt >= maxAttempts
          ? "exhausted"
          : isTimeout
            ? "timeout"
            : "retry";
      emitTimingLine(opts.log, {
        op: opts.op,
        attempt,
        latencyMs: now - attemptStartedAt,
        cumulativeMs: now - startedAt,
        outcome,
        reason: (err as Error)?.message,
      });
      retryAttemptsTotal.inc({ op: opts.op, outcome });
      if (!willRetry) {
        if (!retryable) {
          // Non-retryable: throw original error directly (no wrapper).
          throw err;
        }
        // Exhausted retryable: wrap in RetryExhaustedError preserving cause.
        throw new RetryExhaustedError(opts.op, attempt, err);
      }
      const baseMs = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
      await sleepWithAbort(jitterAround(baseMs, jitter), opts.signal);
    }
  }
  // Unreachable — the loop always either returns or throws.
  throw new RetryExhaustedError(opts.op, maxAttempts, lastError);
}
