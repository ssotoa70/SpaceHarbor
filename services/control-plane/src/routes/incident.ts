import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const guidedActionsSchema = {
  type: "object",
  required: ["acknowledged", "owner", "escalated", "nextUpdateEta", "updatedAt"],
  properties: {
    acknowledged: { type: "boolean" },
    owner: { type: "string" },
    escalated: { type: "boolean" },
    nextUpdateEta: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    },
    updatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;

const noteSchema = {
  type: "object",
  required: ["id", "message", "correlationId", "author", "at"],
  properties: {
    id: { type: "string" },
    message: { type: "string" },
    correlationId: { type: "string" },
    author: { type: "string" },
    at: { type: "string", format: "date-time" }
  }
} as const;

const handoffSchema = {
  type: "object",
  required: ["state", "fromOwner", "toOwner", "summary", "updatedAt"],
  properties: {
    state: { type: "string", enum: ["none", "handoff_requested", "handoff_accepted"] },
    fromOwner: { type: "string" },
    toOwner: { type: "string" },
    summary: { type: "string" },
    updatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;

const coordinationSchema = {
  type: "object",
  required: ["guidedActions", "handoff", "notes"],
  properties: {
    guidedActions: guidedActionsSchema,
    handoff: handoffSchema,
    notes: {
      type: "array",
      items: noteSchema
    }
  }
} as const;

const updateActionsBodySchema = {
  type: "object",
  required: ["acknowledged", "owner", "escalated", "nextUpdateEta", "expectedUpdatedAt"],
  properties: {
    acknowledged: { type: "boolean" },
    owner: { type: "string" },
    escalated: { type: "boolean" },
    nextUpdateEta: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    },
    expectedUpdatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;

const createNoteBodySchema = {
  type: "object",
  required: ["message", "correlationId", "author"],
  properties: {
    message: { type: "string", minLength: 1 },
    correlationId: { type: "string", minLength: 1 },
    author: { type: "string", minLength: 1 }
  }
} as const;

const updateHandoffBodySchema = {
  type: "object",
  required: ["state", "fromOwner", "toOwner", "summary", "expectedUpdatedAt"],
  properties: {
    state: { type: "string", enum: ["none", "handoff_requested", "handoff_accepted"] },
    fromOwner: { type: "string" },
    toOwner: { type: "string" },
    summary: { type: "string" },
    expectedUpdatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;

function operationIdForPrefix(prefix: string, baseName: string): string {
  return prefix === "/api/v1" ? `v1${baseName}` : `legacy${baseName}`;
}

export async function registerIncidentRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(withPrefix(prefix, "/incident/coordination"), {
      schema: {
        tags: ["operations"],
        operationId: operationIdForPrefix(prefix, "GetIncidentCoordination"),
        summary: "Get shared incident coordination state",
        response: {
          200: coordinationSchema
        }
      }
    }, async () => persistence.getIncidentCoordination());

    app.put<{
      Body: {
        acknowledged: boolean;
        owner: string;
        escalated: boolean;
        nextUpdateEta: string | null;
        expectedUpdatedAt: string | null;
      };
    }>(
      withPrefix(prefix, "/incident/coordination/actions"),
      {
        attachValidation: true,
        schema: {
          tags: ["operations"],
          operationId: operationIdForPrefix(prefix, "UpdateIncidentActions"),
          summary: "Update shared incident guided actions",
          body: updateActionsBodySchema,
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {}),
          response: {
            200: {
              type: "object",
              required: ["guidedActions"],
              properties: {
                guidedActions: guidedActionsSchema
              }
            },
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const owner = request.body.owner.trim();
        const nextUpdateEta = request.body.nextUpdateEta;
        const expectedUpdatedAt = request.body.expectedUpdatedAt;

        if (nextUpdateEta !== null && Number.isNaN(new Date(nextUpdateEta).getTime())) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "nextUpdateEta must be an ISO date-time or null", {
            fields: ["nextUpdateEta"]
          });
        }

        const current = persistence.getIncidentCoordination().guidedActions.updatedAt;
        if (expectedUpdatedAt !== current) {
          return sendError(request, reply, 409, "COORDINATION_CONFLICT", "guided actions changed; refresh and retry", {
            expectedUpdatedAt,
            currentUpdatedAt: current
          });
        }

        const guidedActions = persistence.updateIncidentGuidedActions(
          {
            acknowledged: request.body.acknowledged,
            owner,
            escalated: request.body.escalated,
            nextUpdateEta
          },
          {
            correlationId: resolveCorrelationId(request)
          }
        );

        return reply.status(200).send({ guidedActions });
      }
    );

    app.post<{
      Body: {
        message: string;
        correlationId: string;
        author: string;
      };
    }>(
      withPrefix(prefix, "/incident/coordination/notes"),
      {
        attachValidation: true,
        schema: {
          tags: ["operations"],
          operationId: operationIdForPrefix(prefix, "CreateIncidentNote"),
          summary: "Add a shared incident timeline note",
          body: createNoteBodySchema,
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {}),
          response: {
            201: {
              type: "object",
              required: ["note"],
              properties: {
                note: noteSchema
              }
            },
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const message = request.body.message.trim();
        const correlationId = request.body.correlationId.trim();
        const author = request.body.author.trim();

        if (!message || !correlationId || !author) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "message, correlationId, and author are required", {
            fields: ["message", "correlationId", "author"]
          });
        }

        const note = persistence.addIncidentNote(
          {
            message,
            correlationId,
            author
          },
          {
            correlationId: resolveCorrelationId(request)
          }
        );

        return reply.status(201).send({ note });
      }
    );

    app.put<{
      Body: {
        state: "none" | "handoff_requested" | "handoff_accepted";
        fromOwner: string;
        toOwner: string;
        summary: string;
        expectedUpdatedAt: string | null;
      };
    }>(
      withPrefix(prefix, "/incident/coordination/handoff"),
      {
        attachValidation: true,
        schema: {
          tags: ["operations"],
          operationId: operationIdForPrefix(prefix, "UpdateIncidentHandoff"),
          summary: "Update incident handoff state",
          body: updateHandoffBodySchema,
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {}),
          response: {
            200: {
              type: "object",
              required: ["handoff"],
              properties: {
                handoff: handoffSchema
              }
            },
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const fromOwner = request.body.fromOwner.trim();
        const toOwner = request.body.toOwner.trim();
        const summary = request.body.summary.trim();
        const expectedUpdatedAt = request.body.expectedUpdatedAt;

        if (request.body.state !== "none" && (!fromOwner || !toOwner)) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "fromOwner and toOwner are required when handoff is active", {
            fields: ["fromOwner", "toOwner"]
          });
        }

        const current = persistence.getIncidentCoordination().handoff.updatedAt;
        if (expectedUpdatedAt !== current) {
          return sendError(request, reply, 409, "COORDINATION_CONFLICT", "incident handoff changed; refresh and retry", {
            expectedUpdatedAt,
            currentUpdatedAt: current
          });
        }

        const handoff = persistence.updateIncidentHandoff(
          {
            state: request.body.state,
            fromOwner,
            toOwner,
            summary
          },
          {
            correlationId: resolveCorrelationId(request)
          }
        );

        return reply.status(200).send({ handoff });
      }
    );
  }
}
