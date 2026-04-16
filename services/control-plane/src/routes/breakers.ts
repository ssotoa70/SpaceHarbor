/**
 * Circuit breaker observability.
 *
 *   GET  /admin/breakers            list all breakers + state
 *   POST /admin/breakers/:name/reset  force-close a breaker
 *
 * These are admin-only endpoints — handy during incident response when ops
 * needs to see "is the Trino circuit open right now?" without tailing logs.
 * Prometheus scraping + Grafana dashboard lands in Phase 4.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { getBreaker, listBreakers } from "../infra/circuit-breaker.js";

export async function registerBreakersRoute(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    app.get(
      withPrefix(prefix, "/admin/breakers"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${op}ListCircuitBreakers`,
          summary: "List current state of all circuit breakers",
          response: {
            200: {
              type: "object",
              properties: {
                breakers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      state: { type: "string" },
                      failureCount: { type: "integer" },
                      successCount: { type: "integer" },
                      lastFailureAt: { type: ["string", "null"] },
                      openedAt: { type: ["string", "null"] },
                      nextAttemptAt: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async () => ({ breakers: listBreakers() }),
    );

    app.post<{ Params: { name: string } }>(
      withPrefix(prefix, "/admin/breakers/:name/reset"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${op}ResetCircuitBreaker`,
          summary: "Force-close a circuit breaker (admin override)",
          response: {
            200: { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" } } },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const breaker = getBreaker(request.params.name);
        if (!breaker) {
          return sendError(request, reply, 404, "NOT_FOUND", `No breaker named "${request.params.name}"`);
        }
        breaker.reset();
        return { ok: true, name: request.params.name };
      },
    );
  }
}
