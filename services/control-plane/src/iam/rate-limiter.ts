// ---------------------------------------------------------------------------
// Phase 1.3: Auth Rate Limiter (in-memory sliding window)
// ---------------------------------------------------------------------------
//
// Tracks failed auth attempts per IP using a sliding window.
// No external dependencies — all in-process.
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  maxAttempts: number;     // max failed attempts per window
  windowMs: number;        // sliding window size in ms
  cleanupIntervalMs: number; // how often to purge expired entries
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxAttempts: 10,
  windowMs: 60_000,         // 1 minute
  cleanupIntervalMs: 60_000, // cleanup every minute
};

interface AttemptRecord {
  timestamps: number[];
}

export class AuthRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly config: RateLimiterConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a failed auth attempt. Returns true if the IP is now rate-limited.
   */
  recordFailure(ip: string): boolean {
    const now = Date.now();
    const record = this.attempts.get(ip) ?? { timestamps: [] };

    // Prune old entries outside the window
    const cutoff = now - this.config.windowMs;
    record.timestamps = record.timestamps.filter((t) => t > cutoff);

    // Add current attempt
    record.timestamps.push(now);
    this.attempts.set(ip, record);

    return record.timestamps.length > this.config.maxAttempts;
  }

  /**
   * Check if an IP is currently rate-limited (without recording a new attempt).
   */
  isLimited(ip: string): boolean {
    const record = this.attempts.get(ip);
    if (!record) return false;

    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    const recentAttempts = record.timestamps.filter((t) => t > cutoff);

    return recentAttempts.length > this.config.maxAttempts;
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Stop the cleanup timer.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Remove entries with no recent attempts.
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    for (const [ip, record] of this.attempts) {
      record.timestamps = record.timestamps.filter((t) => t > cutoff);
      if (record.timestamps.length === 0) {
        this.attempts.delete(ip);
      }
    }
  }

  /**
   * Reset all state (for testing).
   */
  reset(): void {
    this.attempts.clear();
  }
}
