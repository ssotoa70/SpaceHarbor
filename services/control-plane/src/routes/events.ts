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
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const canonicalEventBodySchema = {
  type: "object",
  required: ["eventId", "eventType", "eventVersion", "occurredAt", "correlationId", "producer", "data"],
  properties: {
    eventId: { type: "string" },
    eventType: {
      type: "string",
        enum: [
          "asset.processing.started",
          "asset.processing.completed",
          "asset.processing.failed",
          "asset.processing.replay_requested",
          "asset.review.qc_pending",
          "asset.review.in_review",
          "asset.review.approved",
          "asset.review.rejected"
        ]
      },
    eventVersion: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
    correlationId: { type: "string" },
    producer: { type: "string" },
    data: {
      type: "object",
      required: ["assetId", "jobId"],
      properties: {
        assetId: { type: "string" },
        jobId: { type: "string" },
        error: { type: "string" }
      }
    }
  }
} as const;

const eventAcceptedResponseSchema = {
  type: "object",
  required: ["accepted", "duplicate"],
  properties: {
    accepted: { type: "boolean" },
    duplicate: { type: "boolean" },
    status: { type: "string" },
    movedToDlq: { type: "boolean" },
    retryScheduled: { type: "boolean" },
    message: { type: "string" }
  }
} as const;

export async function registerEventsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  app.post(withPrefix("", "/events"), {
    attachValidation: true,
    schema: {
      tags: ["events"],
      operationId: "legacySubmitWorkflowEvent",
      summary: "(Legacy) submit workflow event envelope",
      response: {
        202: eventAcceptedResponseSchema,
        400: errorEnvelopeSchema,
        401: errorEnvelopeSchema,
        403: errorEnvelopeSchema,
        409: errorEnvelopeSchema,
        404: errorEnvelopeSchema
      }
    }
  }, async (request, reply) => {
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
      if (result.reason === "WORKFLOW_TRANSITION_NOT_ALLOWED") {
        return sendError(
          request,
          reply,
          409,
          "WORKFLOW_TRANSITION_NOT_ALLOWED",
          result.message ?? "workflow transition is not allowed",
          {
            route: "/events"
          }
        );
      }

      return sendError(request, reply, 404, "NOT_FOUND", result.message ?? "job not found", {
        route: "/events"
      });
    }

    return reply.status(202).send(result);
  });

  if (!prefixes.includes("/api/v1")) {
    return;
  }

  app.post(withPrefix("/api/v1", "/events"), {
    attachValidation: true,
    schema: {
      tags: ["events"],
      operationId: "v1SubmitWorkflowEvent",
      summary: "Submit canonical workflow event envelope",
      security: [{ ApiKeyAuth: [] as string[] }],
      body: canonicalEventBodySchema,
      response: {
        202: eventAcceptedResponseSchema,
        400: errorEnvelopeSchema,
        401: errorEnvelopeSchema,
        403: errorEnvelopeSchema,
        409: errorEnvelopeSchema,
        404: errorEnvelopeSchema
      }
    }
  }, async (request, reply) => {
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
      if (result.reason === "WORKFLOW_TRANSITION_NOT_ALLOWED") {
        return sendError(
          request,
          reply,
          409,
          "WORKFLOW_TRANSITION_NOT_ALLOWED",
          result.message ?? "workflow transition is not allowed",
          {
            route: "/api/v1/events"
          }
        );
      }

      return sendError(request, reply, 404, "NOT_FOUND", result.message ?? "job not found", {
        route: "/api/v1/events"
      });
    }

    return reply.status(202).send(result);
  });
}
