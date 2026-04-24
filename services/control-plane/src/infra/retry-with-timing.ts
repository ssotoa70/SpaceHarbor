/**
 * callWithRetryAndTiming — standardized retry + structured timing + Prometheus
 * counter for outbound calls (VAST DataEngine, VMS, S3, etc.).
 *
 * Emits one `[timing]` log line per attempt with CSV-ish key=value fields so
 * ops can grep the control-plane log for a specific op's latency distribution.
 * Increments `retry_attempts_total{op, outcome}` on every attempt.
 *
 * See docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md.
 */

import type { FastifyBaseLogger } from "fastify";
import { retryAttemptsTotal } from "./metrics.js";

const DEFAULT_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000] as const;
const DEFAULT_MAX_ATTEMPTS = 6;

export interface RetryOptions {
  op: string;
  maxAttempts?: number;
  backoffMs?: readonly number[];
  jitter?: boolean;
  perAttemptTimeoutMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  signal?: AbortSignal;
  log: FastifyBaseLogger;
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly op: string;
  override readonly cause: unknown;
  constructor(op: string, attempts: number, cause: unknown) {
    super(`retry exhausted after ${attempts} attempt(s) on op=${op}`);
    this.name = "RetryExhaustedError";
    this.op = op;
    this.attempts = attempts;
    this.cause = cause;
  }
}

export async function callWithRetryAndTiming<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const jitter = opts.jitter ?? true;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const startedAt = Date.now();

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt++;
    const attemptStart = Date.now();
    try {
      const result =
        opts.perAttemptTimeoutMs !== undefined
          ? await withTimeout(fn(), opts.perAttemptTimeoutMs)
          : await fn();
      emitTiming(opts.log, opts.op, attempt, Date.now() - attemptStart,
                 Date.now() - startedAt, "ok");
      retryAttemptsTotal.inc({ op: opts.op, outcome: "ok" });
      return result;
    } catch (err) {
      lastErr = err;
      const outcome = classifyError(err);
      const retryable = shouldRetry(err, attempt);
      const finalStatus = !retryable ? "non_retryable"
                        : attempt >= maxAttempts ? "exhausted"
                        : outcome === "timeout" ? "timeout"
                        : "retry";
      emitTiming(opts.log, opts.op, attempt, Date.now() - attemptStart,
                 Date.now() - startedAt, finalStatus, err);
      retryAttemptsTotal.inc({ op: opts.op, outcome: finalStatus });

      if (!retryable || attempt >= maxAttempts) break;

      const base = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      const delayMs = jitter ? base * (0.5 + Math.random()) : base;
      await sleep(delayMs, opts.signal);
    }
  }

  if (shouldRetry(lastErr, attempt) === false) {
    throw lastErr;
  }
  throw new RetryExhaustedError(opts.op, attempt, lastErr);
}

function classifyError(err: unknown): "timeout" | "retry" | "non_retryable" {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  return "retry";
}

function emitTiming(
  log: FastifyBaseLogger, op: string, attempt: number,
  latencyMs: number, cumulativeMs: number,
  status: string, err?: unknown,
): void {
  const reason = err ? ` reason=${String((err as Error).message ?? err).replace(/\s+/g, "_").slice(0, 80)}` : "";
  log.info(
    `[timing] op=${op} attempt=${attempt} latency_ms=${latencyMs} cumulative_ms=${cumulativeMs} status=${status}${reason}`,
  );
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(`timeout after ${ms}ms`);
      e.name = "TimeoutError";
      reject(e);
    }, ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      const e = new Error("aborted");
      e.name = "AbortError";
      reject(e);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
