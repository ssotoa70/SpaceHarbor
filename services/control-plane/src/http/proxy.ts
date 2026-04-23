/**
 * HTTP proxy helper — relays requests to the vastdb-query service.
 *
 * Used by metadata routes that need to reach vastdb-query. Extracted
 * here so the route modules don't have to import from each other.
 * Previously lived in routes/exr-metadata.ts (deleted in the legacy
 * endpoint cleanup).
 */

import { vastFetch } from "../vast/vast-fetch.js";

/** Base URL of the vastdb-query service. */
function getVastdbQueryUrl(): string {
  return process.env.VASTDB_QUERY_URL ?? "http://vastdb-query:8070";
}

/** Proxy a request to the vastdb-query service. */
export async function proxyToVastdbQuery(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${getVastdbQueryUrl()}${path}`;
  try {
    const response = await vastFetch(url, {
      headers: { "Accept": "application/json" },
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      data: { detail: err instanceof Error ? err.message : "vastdb-query service unreachable" },
    };
  }
}
