/**
 * Framework-enforced request hooks.
 *
 * - `registerLimitTripwire` caps any `limit` query parameter server-side so
 *   no route can return more than `SPACEHARBOR_MAX_LIST_LIMIT` (default 500)
 *   rows. This is a safety net: individual routes that want smaller caps
 *   still enforce them; this only blocks the pathological case of a client
 *   requesting `?limit=100000` and OOM'ing the UI.
 *
 * - `registerAuditHooks` emits a structured audit row for every mutating
 *   request (anything that isn't GET/HEAD/OPTIONS). Runs at `onResponse`
 *   time so the status code is known. Replaces the scattered per-route
 *   manual audit calls with a single framework-level contract.
 *
 * Both are `app.register`-compatible plugins, installed once in app.ts.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import { eventBus } from "../events/bus.js";
import { httpRequestDuration, httpRequestsTotal, normalizeRouteLabel } from "../infra/metrics.js";

// NOTE: These hooks attach directly to the FastifyInstance so they fire for
// EVERY route (Fastify plugin encapsulation would scope them only to routes
// registered inside the plugin — we need global coverage).

// ---------------------------------------------------------------------------
// Limit tripwire
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LIST_LIMIT = 500;

function parseMaxLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SPACEHARBOR_MAX_LIST_LIMIT;
  if (!raw) return DEFAULT_MAX_LIST_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_MAX_LIST_LIMIT;
  return parsed;
}

export function attachLimitTripwire(app: FastifyInstance): void {
  const maxLimit = parseMaxLimit();

  app.addHook("preValidation", async (request: FastifyRequest) => {
    // Only interfere with GET requests that have a `limit` query parameter.
    // Mutating routes with limits are rare and handle their own pagination.
    if (request.method !== "GET") return;
    const query = request.query as Record<string, unknown> | undefined;
    if (!query || query.limit === undefined) return;

    const raw = String(query.limit);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) return; // individual route rejects

    if (parsed > maxLimit) {
      // Mutate in place so downstream route parsing sees the capped value.
      query.limit = String(maxLimit);
      request.log.warn(
        { route: request.url, requested: parsed, capped: maxLimit },
        "[limit-tripwire] request limit capped",
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Audit hooks (framework-enforced)
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths we do NOT audit (health, metrics, static, openapi). Matching is
 * prefix-based for simplicity.
 */
const AUDIT_SKIP_PREFIXES = [
  "/health",
  "/api/v1/metrics",
  "/metrics",
  "/openapi",
  "/docs",
  "/_static",
];

function shouldSkip(url: string): boolean {
  const path = url.split("?")[0];
  return AUDIT_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveActor(request: FastifyRequest): string | undefined {
  const identity = (request as FastifyRequest & { identity?: string }).identity;
  if (identity) return identity;
  return undefined;
}

// ---------------------------------------------------------------------------
// Prometheus RED metrics hook
// ---------------------------------------------------------------------------

/**
 * Attaches onRequest + onResponse hooks that record per-request metrics:
 *   - spaceharbor_http_requests_total{method, route, status}
 *   - spaceharbor_http_request_duration_seconds{method, route, status}
 *
 * Routes are labeled by the matched Fastify route template (e.g. `/assets/:id`),
 * not the raw URL, so cardinality stays bounded. Unmatched 404s fall back to
 * normalizeRouteLabel() which collapses obvious id params.
 *
 * The /metrics endpoint itself is excluded to avoid self-polling noise.
 */
export function attachMetricsHooks(app: FastifyInstance): void {
  // Stamp a high-resolution start timestamp on every request.
  app.addHook("onRequest", async (request: FastifyRequest) => {
    (request as FastifyRequest & { _metricsStart?: bigint })._metricsStart = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split("?")[0];
    if (path === "/metrics" || path === "/api/v1/metrics") return;

    const started = (request as FastifyRequest & { _metricsStart?: bigint })._metricsStart;
    if (started === undefined) return;
    const durationSec = Number(process.hrtime.bigint() - started) / 1e9;

    // Prefer Fastify's matched route template; fall back to normalized URL.
    const matched = (request as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url;
    const route = matched ?? normalizeRouteLabel(request.url);
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationSec);
  });
}

export function attachAuditHooks(app: FastifyInstance, persistence: PersistenceAdapter): void {
  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (shouldSkip(request.url)) return;

    const statusCode = reply.statusCode;
    // Don't audit validation failures / auth rejections as successful mutations;
    // IAM subsystem already logs auth decisions via auth_decisions table.
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 409) return;

    const method = request.method;
    const path = request.url.split("?")[0];
    const actor = resolveActor(request);

    try {
      await persistence.recordRequestAudit({
        message: `request completed`,
        correlationId: request.id,
        actor,
        method,
        path,
        statusCode,
      });
    } catch (err) {
      // Audit must never break a request. Log and swallow.
      request.log.warn({ err }, "[audit-hook] failed to persist audit row");
    }

    // Fan out a generic audit.mutation event onto the bus so triggers can
    // subscribe to mutations across the whole control-plane without each
    // route having to remember to publish. Route-level events (checkin.committed,
    // version.published, etc.) fire in parallel for semantic subscribers.
    try {
      eventBus.publish({
        type: "audit.mutation",
        subject: `request:${request.id}`,
        data: { method, path, statusCode },
        actor: actor ?? null,
        correlationId: request.id,
      });
    } catch (err) {
      request.log.warn({ err }, "[audit-hook] failed to publish event");
    }
  });
}
