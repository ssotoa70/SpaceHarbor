import type { FastifyInstance } from "fastify";

import { processAssetEvent } from "../events/processor.js";
import {
  isCanonicalAssetEventEnvelope,
  isLegacyAssetEventEnvelope,
  normalizeCanonicalEvent,
  normalizeLegacyEvent
} from "../events/types.js";
import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerEventsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  app.post(withPrefix("", "/events"), async (request, reply) => {
    if (!isLegacyAssetEventEnvelope(request.body)) {
      return sendError(request, reply, 400, "CONTRACT_VALIDATION_ERROR", "invalid event envelope", {
        route: "/events",
        expected: "legacy"
      });
    }

    const result = processAssetEvent(persistence, normalizeLegacyEvent(request.body), {
      correlationId: resolveCorrelationId(request)
    }, {
      enableRetryOnFailure: false
    });
    if (!result.accepted) {
      return sendError(request, reply, 404, "NOT_FOUND", result.message ?? "job not found", {
        route: "/events"
      });
    }

    return reply.status(202).send(result);
  });

  if (!prefixes.includes("/api/v1")) {
    return;
  }

  app.post(withPrefix("/api/v1", "/events"), async (request, reply) => {
    if (!isCanonicalAssetEventEnvelope(request.body)) {
      return sendError(request, reply, 400, "CONTRACT_VALIDATION_ERROR", "invalid event envelope", {
        route: "/api/v1/events",
        expected: "canonical"
      });
    }

    const result = processAssetEvent(persistence, normalizeCanonicalEvent(request.body), {
      correlationId: resolveCorrelationId(request)
    }, {
      enableRetryOnFailure: true
    });
    if (!result.accepted) {
      return sendError(request, reply, 404, "NOT_FOUND", result.message ?? "job not found", {
        route: "/api/v1/events"
      });
    }

    return reply.status(202).send(result);
  });
}
