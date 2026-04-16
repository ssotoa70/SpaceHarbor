/**
 * Circuit breaker — minimal dependency-free state machine for wrapping
 * calls to external services (VAST Trino, S3, Kafka, HTTP webhooks).
 *
 * Why we have this: when a downstream dep (Trino, VAST cluster, S3) goes
 * slow or fails in a sustained way, every in-flight request starts
 * timing out. Those retries compound latency, tie up the event loop,
 * and can push the control-plane into a restart loop. A circuit breaker
 * opens after repeated failures and short-circuits subsequent calls
 * until the dep recovers.
 *
 * States:
 *   closed     — normal. Failures accumulate; after `failureThreshold`
 *                consecutive failures, open the circuit.
 *   open       — fast-fail every call for `openDurationMs`. At the end
 *                of that window, transition to half-open.
 *   half-open  — allow ONE probe call through. If it succeeds, close.
 *                If it fails, re-open for another window.
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ name: "trino", failureThreshold: 5 });
 *   const result = await breaker.execute(() => trinoClient.query(sql));
 *
 * When the breaker is open, `execute` throws a CircuitOpenError. Callers
 * should map this to a user-facing 503 Retry-After rather than surfacing
 * the raw "circuit open" to clients.
 *
 * Metrics: each breaker exposes `stats()` for observability. Phase 4
 * (Prometheus) will register these as gauges.
 */

export interface CircuitBreakerOptions {
  name: string;
  /** Number of consecutive failures before opening. */
  failureThreshold: number;
  /** How long to stay open before trying a half-open probe. */
  openDurationMs: number;
  /** Optional: classify an error as "expected" (doesn't trip the breaker). */
  isExpectedError?: (err: unknown) => boolean;
}

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN";
  constructor(name: string, retryAfterMs: number) {
    super(`Circuit "${name}" is OPEN; retry after ${retryAfterMs}ms`);
    this.name = "CircuitOpenError";
  }
}

interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  nextAttemptAt: string | null;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt: Date | null = null;
  private openedAt: Date | null = null;
  private nextAttemptAt: Date | null = null;
  private inProbe = false;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check state
    if (this.state === "open") {
      if (!this.nextAttemptAt || this.nextAttemptAt.getTime() > Date.now()) {
        const retryAfter = this.nextAttemptAt
          ? this.nextAttemptAt.getTime() - Date.now()
          : this.opts.openDurationMs;
        throw new CircuitOpenError(this.opts.name, Math.max(0, retryAfter));
      }
      // Time window elapsed — transition to half-open and let THIS call probe.
      this.state = "half-open";
      this.inProbe = false;
    }
    if (this.state === "half-open" && this.inProbe) {
      // Already have a probe in flight — reject concurrent callers until
      // the probe resolves.
      throw new CircuitOpenError(this.opts.name, 100);
    }
    if (this.state === "half-open") this.inProbe = true;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (this.opts.isExpectedError?.(err)) {
        // Expected / business-level errors don't trip the breaker
        // (e.g. 404 from S3 when an object doesn't exist is not a "service failure").
        this.inProbe = false;
        throw err;
      }
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    this.failureCount = 0;
    if (this.state === "half-open") {
      this.state = "closed";
      this.openedAt = null;
      this.nextAttemptAt = null;
    }
    this.inProbe = false;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureAt = new Date();
    if (this.state === "half-open") {
      this.open();
      return;
    }
    if (this.failureCount >= this.opts.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "open";
    this.openedAt = new Date();
    this.nextAttemptAt = new Date(Date.now() + this.opts.openDurationMs);
    this.inProbe = false;
  }

  /** Force-close the breaker (admin action). */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.openedAt = null;
    this.nextAttemptAt = null;
    this.inProbe = false;
  }

  stats(): CircuitBreakerStats {
    return {
      name: this.opts.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      openedAt: this.openedAt?.toISOString() ?? null,
      nextAttemptAt: this.nextAttemptAt?.toISOString() ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Global registry — accessible by an observability endpoint so ops can see
// which breakers are open at any given time.
// ---------------------------------------------------------------------------

const registry = new Map<string, CircuitBreaker>();

export function registerBreaker(breaker: CircuitBreaker): void {
  registry.set(breaker.stats().name, breaker);
}

export function listBreakers(): CircuitBreakerStats[] {
  return [...registry.values()].map((b) => b.stats());
}

export function getBreaker(name: string): CircuitBreaker | undefined {
  return registry.get(name);
}

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

/**
 * Breaker for VAST Trino queries. Opens after 5 consecutive failures and
 * stays open for 30 seconds before a probe attempt.
 */
export const trinoBreaker = new CircuitBreaker({
  name: "vast-trino",
  failureThreshold: parseInt(process.env.SPACEHARBOR_TRINO_BREAKER_THRESHOLD ?? "5", 10),
  openDurationMs: parseInt(process.env.SPACEHARBOR_TRINO_BREAKER_OPEN_MS ?? "30000", 10),
});
registerBreaker(trinoBreaker);

/**
 * Breaker for S3 calls (CreateMultipartUpload, CompleteMultipartUpload,
 * AbortMultipartUpload, etc.). S3 404s on HeadObject are EXPECTED during
 * normal lookup flow, so we pre-classify them.
 */
export const s3Breaker = new CircuitBreaker({
  name: "vast-s3",
  failureThreshold: parseInt(process.env.SPACEHARBOR_S3_BREAKER_THRESHOLD ?? "5", 10),
  openDurationMs: parseInt(process.env.SPACEHARBOR_S3_BREAKER_OPEN_MS ?? "30000", 10),
  isExpectedError: (err) => {
    const e = err as { $metadata?: { httpStatusCode?: number }; Code?: string; name?: string };
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404) return true;
    if (e?.name === "NoSuchKey" || e?.Code === "NoSuchKey") return true;
    if (e?.name === "NoSuchUpload" || e?.Code === "NoSuchUpload") return true;
    return false;
  },
});
registerBreaker(s3Breaker);

/**
 * Breaker for Kafka producer publishes. Event broker outages must not
 * cascade into user-facing HTTP errors — a blocked producer should just
 * log and move on (DLQ-style handling is Phase 3+).
 */
export const kafkaBreaker = new CircuitBreaker({
  name: "vast-kafka",
  failureThreshold: parseInt(process.env.SPACEHARBOR_KAFKA_BREAKER_THRESHOLD ?? "3", 10),
  openDurationMs: parseInt(process.env.SPACEHARBOR_KAFKA_BREAKER_OPEN_MS ?? "15000", 10),
});
registerBreaker(kafkaBreaker);
