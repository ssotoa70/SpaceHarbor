/**
 * TLS-safe fetch wrapper for VAST cluster connections.
 *
 * VAST clusters commonly use self-signed or internal CA certificates.
 * This wrapper temporarily disables TLS verification for the duration
 * of each request, then restores the original setting.
 *
 * Controlled by SPACEHARBOR_VAST_SKIP_TLS env var (defaults to "true").
 * Set to "false" in production with valid CA certificates.
 */

const shouldSkipTls = (): boolean => {
  const val = process.env.SPACEHARBOR_VAST_SKIP_TLS;
  if (val === "false" || val === "0") return false;
  // Default to true — most VAST clusters use self-signed certs
  return true;
};

/** Saved TLS state for set/restore pattern (used by AWS SDK calls). */
let _savedTls: string | undefined;

/** Temporarily disable TLS verification (for AWS SDK and other libs). */
export function setVastTlsSkip(): void {
  if (!shouldSkipTls()) return;
  _savedTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Restore TLS verification to previous state. */
export function restoreVastTls(): void {
  if (_savedTls === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = _savedTls;
  }
}

/**
 * Fetch wrapper that handles VAST self-signed TLS certificates.
 * Drop-in replacement for global fetch().
 */
export async function vastFetch(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (!shouldSkipTls()) {
    return fetch(url, init);
  }

  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, init);
  } finally {
    // Restore previous value
    if (prev === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
}
