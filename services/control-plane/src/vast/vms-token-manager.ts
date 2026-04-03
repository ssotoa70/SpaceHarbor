/**
 * VmsTokenManager — manages VMS JWT authentication for VAST DataEngine proxy.
 *
 * Handles login via /api/latest/token/, caches access + refresh tokens in memory,
 * auto-refreshes 60s before expiry, and deduplicates concurrent refresh requests.
 *
 * The browser never sees VMS tokens — they stay server-side only.
 */

export interface VmsCredentials {
  username: string;
  password: string;
}

export interface VmsTokenPair {
  access: string;
  refresh: string;
}

interface TokenState {
  access: string;
  refresh: string;
  /** Unix ms when the access token expires (decoded from JWT or estimated). */
  expiresAt: number;
}

/** How many ms before expiry to proactively refresh. */
const REFRESH_BUFFER_MS = 60_000;

/** Fallback token lifetime if we can't decode the JWT exp claim (5 minutes). */
const DEFAULT_LIFETIME_MS = 5 * 60_000;

export class VmsTokenManager {
  private state: TokenState | null = null;
  private refreshPromise: Promise<void> | null = null;
  private readonly baseUrl: string;
  private readonly credentials: VmsCredentials;
  private readonly fetchFn: typeof fetch;

  constructor(
    baseUrl: string,
    credentials: VmsCredentials,
    fetchFn: typeof fetch = fetch,
  ) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.credentials = credentials;
    this.fetchFn = fetchFn;
  }

  /**
   * Get a valid access token. Logs in or refreshes as needed.
   * Safe to call concurrently — only one refresh/login runs at a time.
   */
  async getToken(): Promise<string> {
    if (this.state && !this.isExpiringSoon()) {
      return this.state.access;
    }

    // If we have a refresh token, try refreshing; otherwise full login
    if (this.state?.refresh) {
      await this.ensureRefresh();
    } else {
      await this.ensureLogin();
    }

    if (!this.state) {
      throw new Error("VmsTokenManager: failed to obtain access token");
    }
    return this.state.access;
  }

  /** Force a fresh login (e.g. after a 401). */
  async forceRefresh(): Promise<string> {
    this.clear();
    await this.ensureLogin();
    // ensureLogin sets this.state; re-read after await
    const s = this.state as TokenState | null;
    if (!s) {
      throw new Error("VmsTokenManager: failed to obtain access token after force refresh");
    }
    return s.access;
  }

  /** Clear cached tokens (e.g. when credentials change). */
  clear(): void {
    this.state = null;
    this.refreshPromise = null;
  }

  /** Check if VMS is reachable with the current credentials. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/latest/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.credentials.username,
          password: this.credentials.password,
        }),
      });

      if (response.ok) {
        // Parse tokens to confirm they're valid
        const data = (await response.json()) as Record<string, unknown>;
        if (data.access && data.refresh) {
          // Cache the tokens since we got them anyway
          this.state = {
            access: String(data.access),
            refresh: String(data.refresh),
            expiresAt: this.decodeExpiry(String(data.access)),
          };
          return { ok: true, message: "VMS authentication successful" };
        }
        return { ok: false, message: "VMS returned unexpected token format" };
      }

      if (response.status === 401) {
        return { ok: false, message: "Invalid VMS credentials" };
      }
      return { ok: false, message: `VMS returned HTTP ${response.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `VMS connection failed: ${msg}` };
    }
  }

  // ── Private ──

  private isExpiringSoon(): boolean {
    if (!this.state) return true;
    return Date.now() >= this.state.expiresAt - REFRESH_BUFFER_MS;
  }

  /** Deduplicated login — only one login request runs at a time. */
  private async ensureLogin(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doLogin().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /** Deduplicated refresh — only one refresh request runs at a time. */
  private async ensureRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doLogin(): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/api/latest/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.credentials.username,
        password: this.credentials.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`VMS login failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!data.access || !data.refresh) {
      throw new Error("VMS login response missing access/refresh tokens");
    }

    this.state = {
      access: String(data.access),
      refresh: String(data.refresh),
      expiresAt: this.decodeExpiry(String(data.access)),
    };
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.state?.refresh;
    if (!refreshToken) {
      return this.doLogin();
    }

    try {
      const response = await this.fetchFn(
        `${this.baseUrl}/api/latest/token/refresh/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: refreshToken }),
        },
      );

      if (!response.ok) {
        // Refresh failed — fall back to full login
        this.state = null;
        return this.doLogin();
      }

      const data = (await response.json()) as Record<string, unknown>;
      if (!data.access) {
        this.state = null;
        return this.doLogin();
      }

      this.state = {
        access: String(data.access),
        refresh: data.refresh ? String(data.refresh) : refreshToken,
        expiresAt: this.decodeExpiry(String(data.access)),
      };
    } catch {
      // Network error on refresh — fall back to full login
      this.state = null;
      return this.doLogin();
    }
  }

  /**
   * Decode the `exp` claim from a JWT to get expiry time.
   * Falls back to DEFAULT_LIFETIME_MS if decoding fails.
   */
  private decodeExpiry(jwt: string): number {
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return Date.now() + DEFAULT_LIFETIME_MS;
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf-8"),
      ) as { exp?: number };
      if (typeof payload.exp === "number") {
        return payload.exp * 1000; // JWT exp is seconds
      }
    } catch {
      // Ignore decode errors
    }
    return Date.now() + DEFAULT_LIFETIME_MS;
  }
}
