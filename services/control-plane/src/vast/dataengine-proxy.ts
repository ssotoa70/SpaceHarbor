/**
 * Generic proxy helper for forwarding requests to the VAST DataEngine REST API.
 *
 * - Constructs the VAST target URL from the mapped path
 * - Gets a valid JWT from VmsTokenManager
 * - Forwards query params + request body as-is
 * - On 401 from VAST: retries once with a fresh token
 * - Normalizes errors to SpaceHarbor ErrorEnvelope via sendError()
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { sendError } from "../http/errors.js";
import type { VmsTokenManager } from "./vms-token-manager.js";
import { vastFetch } from "./vast-fetch.js";

export interface ProxyContext {
  tokenManager: VmsTokenManager;
  vastBaseUrl: string;
  fetchFn?: typeof fetch;
}

/**
 * Forward a request to the VAST DataEngine API.
 *
 * @param request - Fastify request
 * @param reply   - Fastify reply
 * @param method  - HTTP method (GET, POST, PUT, DELETE)
 * @param vastPath - Path on the VAST API (e.g. "/api/latest/dataengine/functions/")
 * @param ctx     - Proxy context with token manager and VAST base URL
 */
export async function proxyToVast(
  request: FastifyRequest,
  reply: FastifyReply,
  method: string,
  vastPath: string,
  ctx: ProxyContext,
): Promise<void> {
  const doFetch = ctx.fetchFn ?? vastFetch;

  // Build VAST target URL
  const url = new URL(vastPath, ctx.vastBaseUrl);

  // Forward query params as-is (pagination, filtering, etc.)
  const query = request.query as Record<string, string> | undefined;
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  // Build headers
  const buildHeaders = (token: string): Record<string, string> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (method !== "GET" && method !== "DELETE") {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  };

  // Build body
  const body =
    method !== "GET" && method !== "DELETE" && request.body
      ? JSON.stringify(request.body)
      : undefined;

  // First attempt
  let token: string;
  try {
    token = await ctx.tokenManager.getToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to authenticate with VMS";
    return sendError(request, reply, 502, "VAST_AUTH_ERROR", msg);
  }

  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      method,
      headers: buildHeaders(token),
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "VAST DataEngine unreachable";
    return sendError(request, reply, 502, "VAST_NETWORK_ERROR", msg);
  }

  // Retry once on 401 with a fresh token
  if (response.status === 401) {
    try {
      token = await ctx.tokenManager.forceRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to re-authenticate with VMS";
      return sendError(request, reply, 502, "VAST_AUTH_ERROR", msg);
    }

    try {
      response = await doFetch(url.toString(), {
        method,
        headers: buildHeaders(token),
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "VAST DataEngine unreachable";
      return sendError(request, reply, 502, "VAST_NETWORK_ERROR", msg);
    }
  }

  // Forward VAST response
  if (response.ok) {
    // Some endpoints (DELETE) may return empty body
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return reply.status(response.status).send(data);
    }
    // No JSON body — forward status only
    return reply.status(response.status === 204 ? 204 : 200).send();
  }

  // Error from VAST — normalize to ErrorEnvelope
  let vastMessage: string;
  try {
    const text = await response.text();
    // Try to extract a message from JSON error bodies
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      vastMessage =
        typeof parsed.detail === "string"
          ? parsed.detail
          : typeof parsed.message === "string"
            ? parsed.message
            : text;
    } catch {
      vastMessage = text || `VAST returned HTTP ${response.status}`;
    }
  } catch {
    vastMessage = `VAST returned HTTP ${response.status}`;
  }

  // Map VAST status codes to appropriate proxy status codes
  const statusCode = response.status >= 400 && response.status < 500
    ? response.status // Forward 4xx as-is (client errors)
    : 502;            // 5xx from VAST → 502 Bad Gateway

  return sendError(request, reply, statusCode, "VAST_ERROR", vastMessage);
}
