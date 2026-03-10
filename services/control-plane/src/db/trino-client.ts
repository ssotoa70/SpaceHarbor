/**
 * Shared Trino REST client for VAST Database.
 *
 * Implements the Trino REST API v1/statement protocol with proper nextUri
 * polling, Basic auth, and configurable timeouts.
 */

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

  constructor(config: TrinoClientConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    const creds = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64");
    this.authHeader = `Basic ${creds}`;
    this.user = config.user ?? "assetharbor";
    this.schema = config.schema ?? "assetharbor/production";
    this.catalog = config.catalog ?? "vast";
    this.timeoutMs = config.timeoutMs ?? 30_000;
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
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader,
          "X-Trino-User": this.user,
          "X-Trino-Catalog": this.catalog,
          "X-Trino-Schema": this.schema
        },
        body: sql,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new TrinoQueryError(`HTTP ${response.status}: ${body}`);
      }

      let resp = (await response.json()) as TrinoResponse;
      const queryId = resp.id;
      let columns: TrinoColumn[] = resp.columns ?? [];
      const allData: unknown[][] = [];

      if (resp.data) allData.push(...resp.data);

      // Follow nextUri chain until query completes
      while (resp.nextUri) {
        if (resp.error) {
          throw new TrinoQueryError(resp.error.message, queryId);
        }

        const next = await fetch(resp.nextUri, {
          headers: { Authorization: this.authHeader },
          signal: controller.signal
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
        const res = await fetch(`${this.endpoint}/v1/info`, {
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

  /** The auth header value (for testing). */
  get authorization(): string {
    return this.authHeader;
  }
}
