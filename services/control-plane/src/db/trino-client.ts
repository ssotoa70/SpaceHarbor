/**
 * VAST Database SQL client.
 *
 * Implements the Trino-compatible REST API v1/statement protocol with
 * proper nextUri polling, Basic auth, and configurable timeouts.
 * Uses vastFetch for TLS-safe connections to VAST clusters.
 */

import { vastFetch } from "../vast/vast-fetch.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrinoClientConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  user?: string;
  schema?: string;
  catalog?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
}

export interface TrinoQueryResult {
  columns: Array<{ name: string; type: string }>;
  data: unknown[][];
  rowCount: number;
}

export class TrinoQueryError extends Error {
  constructor(
    message: string,
    public readonly queryId?: string
  ) {
    super(message);
    this.name = "TrinoQueryError";
  }
}

// ---------------------------------------------------------------------------
// Internal response types (from Trino REST API)
// ---------------------------------------------------------------------------

interface TrinoColumn {
  name: string;
  type: string;
}

interface TrinoError {
  message: string;
  errorCode?: number;
  errorName?: string;
  errorType?: string;
}

interface TrinoResponse {
  id?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: { state: string };
  error?: TrinoError;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class TrinoClient {
  private readonly endpoint: string;
  private readonly authHeader: string;
  private readonly user: string;
  private readonly schema: string;
  private readonly catalog: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;

  constructor(config: TrinoClientConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");

    // Warn about plaintext HTTP in production — credentials would be exposed
    if (process.env.NODE_ENV === "production") {
      const url = new URL(this.endpoint);
      if (url.protocol === "http:") {
        console.warn(
          `WARNING: VAST Database endpoint uses plaintext HTTP — credentials may be exposed. ` +
          `Configured endpoint: ${this.endpoint}`,
        );
      }
    }

    // Only include Basic auth when credentials are provided.
    // Standalone Trino (e.g. vastdataorg/trino-vast) uses X-Trino-User, not Basic auth.
    // VAST Database's built-in Trino endpoint uses S3 credentials via Basic auth.
    if (config.accessKey && config.secretKey) {
      const creds = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64");
      this.authHeader = `Basic ${creds}`;
    } else {
      this.authHeader = "";
    }
    this.user = config.user ?? "spaceharbor";
    this.schema = config.schema ?? "spaceharbor/production";
    this.catalog = config.catalog ?? "vast";
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 50;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Execute a SQL statement and return the full result set.
   * Follows the nextUri polling chain until the query completes.
   */
  async query(sql: string): Promise<TrinoQueryResult> {
    const url = `${this.endpoint}/v1/statement`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Trino-User": this.user,
        "X-Trino-Catalog": this.catalog,
        "X-Trino-Schema": this.schema,
      };
      if (this.authHeader) headers["Authorization"] = this.authHeader;

      const response = await vastFetch(url, {
        method: "POST",
        headers,
        body: sql,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        // Log full error for debugging but don't expose to callers
        console.error(`Trino query error: HTTP ${response.status}`, body);
        throw new TrinoQueryError(
          `Trino query failed with status ${response.status}`
        );
      }

      let resp = (await response.json()) as TrinoResponse;
      const queryId = resp.id;
      let columns: TrinoColumn[] = resp.columns ?? [];
      const allData: unknown[][] = [];

      if (resp.data) allData.push(...resp.data);

      // Follow nextUri chain until query completes (with backoff between polls)
      while (resp.nextUri) {
        if (resp.error) {
          throw new TrinoQueryError(resp.error.message, queryId);
        }

        await new Promise((r) => setTimeout(r, this.pollIntervalMs));

        const next = await this.fetchWithRetry(resp.nextUri, {
          headers: { Authorization: this.authHeader },
          signal: controller.signal,
        });
        resp = (await next.json()) as TrinoResponse;

        if (resp.columns && resp.columns.length > 0) {
          columns = resp.columns;
        }
        if (resp.data) allData.push(...resp.data);
      }

      // Check final response for errors
      if (resp.error) {
        throw new TrinoQueryError(resp.error.message, queryId);
      }

      return {
        columns: columns.map((c) => ({ name: c.name, type: c.type })),
        data: allData,
        rowCount: allData.length
      };
    } catch (err) {
      if (err instanceof TrinoQueryError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new TrinoQueryError(`Query timed out after ${this.timeoutMs}ms`);
      }
      throw new TrinoQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if the Trino endpoint is reachable and return its version.
   */
  async healthCheck(): Promise<{ reachable: boolean; version?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);

      try {
        const res = await vastFetch(`${this.endpoint}/v1/info`, {
          headers: { Authorization: this.authHeader },
          signal: controller.signal
        });
        if (!res.ok) return { reachable: false };
        const info = (await res.json()) as { nodeVersion?: { version?: string } };
        return {
          reachable: true,
          version: info.nodeVersion?.version
        };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { reachable: false };
    }
  }

  /**
   * Fetch with exponential backoff retry on 5xx responses.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await vastFetch(url, init);
      if (res.status < 500 || attempt === this.maxRetries) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
      const delay = Math.min(100 * 2 ** attempt, 2000);
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastError ?? new Error("fetchWithRetry exhausted");
  }

  /** The auth header value (for testing). */
  get authorization(): string {
    return this.authHeader;
  }
}
