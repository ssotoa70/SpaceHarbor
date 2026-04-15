/**
 * Concrete FunctionFetcher backed by the live VAST DataEngine API.
 *
 * Implements the `FunctionFetcher` interface from discovery.ts by making
 * an HTTP GET to `{vastUrl}/api/latest/dataengine/functions/?name={name}`
 * with a VMS access token. Handles one-shot 401 retry via the existing
 * VmsTokenManager pattern. Normalizes the VAST response shape into the
 * LiveFunctionRecord interface so discovery doesn't have to know about
 * VAST field names.
 *
 * This module is the one place that knows the VAST DataEngine HTTP
 * contract. Everything upstream (discovery, endpoint, web-ui) is
 * protocol-agnostic.
 */

import { vastFetch } from "../vast/vast-fetch.js";
import { VmsTokenManager } from "../vast/vms-token-manager.js";

import type { FunctionFetcher, LiveFunctionRecord } from "./discovery.js";

export interface VastFetcherContext {
  /** Base URL of the VAST cluster (e.g. `https://var201.selab.vastdata.com`). */
  vastBaseUrl: string;
  /** VMS tenant name — sent as X-Tenant-Name header. */
  tenant: string | null;
  /** Token manager — shared with the existing dataengine-proxy infra. */
  tokenManager: VmsTokenManager;
}

/**
 * Build the live-VAST FunctionFetcher. The context provider is called
 * on every lookup so the fetcher always reads fresh settings — admins
 * can change the VAST URL or credentials at runtime without rebuilding
 * the discovery service.
 */
export function createVastFunctionFetcher(
  contextProvider: () => VastFetcherContext | null,
  doFetch: typeof fetch = vastFetch,
): FunctionFetcher {
  return {
    async fetchByName(name: string): Promise<LiveFunctionRecord | null> {
      const ctx = contextProvider();
      if (!ctx) {
        throw new Error("VAST DataEngine is not configured");
      }

      const url = new URL("/api/latest/dataengine/functions/", ctx.vastBaseUrl);
      url.searchParams.set("name", name);

      const buildHeaders = (token: string): Record<string, string> => {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        };
        if (ctx.tenant) headers["X-Tenant-Name"] = ctx.tenant;
        return headers;
      };

      let token: string;
      try {
        token = await ctx.tokenManager.getToken();
      } catch (err) {
        throw new Error(
          `VAST auth failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: buildHeaders(token),
        });
      } catch (err) {
        throw new Error(
          `VAST DataEngine unreachable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // One-shot 401 retry with a refreshed token (matches dataengine-proxy pattern)
      if (response.status === 401) {
        try {
          token = await ctx.tokenManager.forceRefresh();
        } catch (err) {
          throw new Error(
            `VAST re-auth failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: buildHeaders(token),
        });
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`VAST returned HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as unknown;
      return pickFirstMatch(data, name);
    },
  };
}

/**
 * Extract the first function record matching `name` from the VAST
 * response. Expected shape: `{ data: [{ name, guid, description, ... }] }`.
 * Returns null when the response is empty or contains no match.
 *
 * Isolated as a pure function so it can be unit-tested without any HTTP.
 */
export function pickFirstMatch(data: unknown, name: string): LiveFunctionRecord | null {
  if (!data || typeof data !== "object") return null;
  const envelope = data as Record<string, unknown>;
  const arr = envelope.data;
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const match = arr.find((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as Record<string, unknown>).name === name;
  });
  if (!match) return null;

  return normalizeRecord(match);
}

function normalizeRecord(record: Record<string, unknown>): LiveFunctionRecord {
  const ownerRaw = record.owner;
  const owner = ownerRaw && typeof ownerRaw === "object"
    ? {
        id: typeof (ownerRaw as Record<string, unknown>).id === "string"
          ? ((ownerRaw as Record<string, unknown>).id as string)
          : undefined,
        name: typeof (ownerRaw as Record<string, unknown>).name === "string"
          ? ((ownerRaw as Record<string, unknown>).name as string)
          : undefined,
      }
    : null;

  return {
    guid: String(record.guid ?? ""),
    name: String(record.name ?? ""),
    description: typeof record.description === "string" ? record.description : "",
    owner,
    createdAt: typeof record.created_at === "string" ? record.created_at : null,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
    vrn: typeof record.vrn === "string" ? record.vrn : null,
    lastRevisionNumber:
      typeof record.last_revision_number === "number" ? record.last_revision_number : null,
  };
}
