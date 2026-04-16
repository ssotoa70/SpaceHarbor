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

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";

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

export const registerLimitTripwire: FastifyPluginAsync = async (app: FastifyInstance) => {
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
};

// ---------------------------------------------------------------------------
// Audit hooks (framework-enforced)
// ---------------------------------------------------------------------------

interface AuditHooksOptions {
  persistence: PersistenceAdapter;
}

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

export const registerAuditHooks: FastifyPluginAsync<AuditHooksOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { persistence } = opts;

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (shouldSkip(request.url)) return;

    const statusCode = reply.statusCode;
    // Don't audit validation failures / auth rejections as successful mutations;
    // IAM subsystem already logs auth decisions via auth_decisions table.
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 409) return;

    try {
      await persistence.recordRequestAudit({
        message: `request completed`,
        correlationId: request.id,
        actor: resolveActor(request),
        method: request.method,
        path: request.url.split("?")[0],
        statusCode,
      });
    } catch (err) {
      // Audit must never break a request. Log and swallow.
      request.log.warn({ err }, "[audit-hook] failed to persist audit row");
    }
  });
};
