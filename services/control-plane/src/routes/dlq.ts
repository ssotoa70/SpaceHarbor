import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { isValidApiKey, resolveValidApiKeys } from "../iam/auth-plugin.js";
import { resolveIamFlags } from "../iam/feature-flags.js";
import { PERMISSIONS } from "../iam/types.js";

/**
 * Deny DLQ purge unless the caller has destructive:purge_dlq permission (IAM
 * enabled) or is authenticated with a valid API key (IAM disabled). Any
 * authenticated non-admin caller under IAM receives a 403.
 *
 * Returns true if the request was denied (reply already sent).
 */
function denyUnlessPurgeAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const iamFlags = resolveIamFlags();

  if (iamFlags.iamEnabled) {
    const ctx = (request as any).iamContext as { permissions?: Set<string> } | undefined;
    if (!ctx?.permissions?.has(PERMISSIONS.DESTRUCTIVE_PURGE_DLQ)) {
      reply.status(403).send({
        error: `${PERMISSIONS.DESTRUCTIVE_PURGE_DLQ} permission required to purge DLQ`,
      });
      return true;
    }
    return false;
  }

  // IAM disabled: require a valid API key (implies operator/admin access).
  const validKeys = resolveValidApiKeys();
  if (validKeys.length === 0) {
    // Dev mode — no keys configured, allow.
    return false;
  }

  const providedKey = request.headers["x-api-key"];
  if (!providedKey || typeof providedKey !== "string") {
    reply.status(401).send({ error: "API key required to purge DLQ" });
    return true;
  }

  if (!isValidApiKey(providedKey)) {
    reply.status(403).send({ error: "invalid API key" });
    return true;
  }

  return false;
}

export async function registerDlqRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const iamFlags = resolveIamFlags();

    // When IAM is enabled, the global auth hook in app.ts has already authenticated
    // the request and attached iamContext. We only need to verify authentication
    // succeeded — the iamContext being present is the indicator.
    if (iamFlags.iamEnabled) {
      const iamContext = (request as any).iamContext;
      if (!iamContext) {
        // IAM hook should have already rejected unauthenticated requests, but
        // defend in depth: DLQ operations must never be unauthenticated.
        return reply.status(401).send({ error: "authentication required for DLQ operations" });
      }
      // IAM authenticated — let the global authz engine handle permission checks.
      return;
    }

    // When IAM is disabled, fall back to API key enforcement.
    const hasKeys = resolveValidApiKeys().length > 0;
    if (!hasKeys) return; // No key configured = dev mode, skip auth

    const providedKey = request.headers["x-api-key"];
    if (!providedKey || typeof providedKey !== "string") {
      return reply.status(401).send({ error: "API key required for DLQ operations" });
    }

    if (!isValidApiKey(providedKey)) {
      return reply.status(403).send({ error: "invalid API key" });
    }
  };

  app.get("/api/v1/dlq", {
    preHandler: [requireAuth],
    schema: {
      tags: ["dlq"],
      operationId: "listDlqItems",
      summary: "List all dead-letter queue items",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  jobId: { type: "string" },
                  errorMessage: { type: "string" },
                  failedAt: { type: "string" },
                  retryCount: { type: "number" },
                },
              },
            },
          },
        },
        401: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async () => ({
    items: await persistence.getDlqItems()
  }));

  app.get<{ Params: { jobId: string } }>("/api/v1/dlq/:jobId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["dlq"],
      operationId: "getDlqItem",
      summary: "Get a single dead-letter queue item by job ID",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["jobId"],
        properties: { jobId: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            jobId: { type: "string" },
            errorMessage: { type: "string" },
            failedAt: { type: "string" },
            retryCount: { type: "number" },
          },
        },
        401: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        404: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const item = await persistence.getDlqItem(request.params.jobId);
    if (!item) {
      return reply.status(404).send({ error: "DLQ item not found" });
    }
    return item;
  });

  app.post<{ Params: { jobId: string } }>("/api/v1/dlq/:jobId/replay", {
    preHandler: [requireAuth],
    schema: {
      tags: ["dlq"],
      operationId: "replayDlqItem",
      summary: "Replay a single dead-letter queue job",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["jobId"],
        properties: { jobId: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            replayed: { type: "boolean" },
            job: { type: "object" },
          },
        },
        401: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        404: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;
    const context = {
      correlationId: resolveCorrelationId(request),
      now: new Date().toISOString()
    };

    const dlqItem = await persistence.getDlqItem(jobId);
    if (!dlqItem) {
      return reply.status(404).send({ error: "DLQ item not found" });
    }

    const replayed = await persistence.replayJob(jobId, context);
    if (!replayed) {
      return reply.status(404).send({ error: "Job not found" });
    }

    return { replayed: true, job: replayed };
  });

  app.post("/api/v1/dlq/replay-all", {
    preHandler: [requireAuth],
    schema: {
      tags: ["dlq"],
      operationId: "replayAllDlqItems",
      summary: "Replay all items currently in the dead-letter queue",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            replayedCount: { type: "number" },
            totalItems: { type: "number" },
          },
        },
        401: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request) => {
    const context = {
      correlationId: resolveCorrelationId(request),
      now: new Date().toISOString()
    };

    const items = await persistence.getDlqItems();
    let replayedCount = 0;

    for (const item of items) {
      const result = await persistence.replayJob(item.jobId, context);
      if (result) {
        replayedCount += 1;
      }
    }

    return { replayedCount, totalItems: items.length };
  });

  app.delete<{ Querystring: { before?: string } }>("/api/v1/dlq/purge", {
    preHandler: [requireAuth],
    schema: {
      tags: ["dlq"],
      operationId: "purgeDlq",
      summary: "Purge DLQ items older than a given timestamp — requires destructive:purge_dlq permission",
      security: [{ BearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["before"],
        properties: {
          before: { type: "string", description: "ISO 8601 timestamp — purge items created before this time" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: { purgedCount: { type: "number" } },
        },
        400: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        401: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        403: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    // Second gate: requireAuth confirms the caller is authenticated; this check
    // confirms the caller has the destructive:purge_dlq permission (or a valid
    // API key when IAM is disabled). Any non-admin authenticated user gets 403.
    if (denyUnlessPurgeAllowed(request, reply)) return;

    const { before } = request.query;
    if (!before) {
      return reply.status(400).send({ error: "Query parameter 'before' (ISO timestamp) is required" });
    }

    const purgedCount = await persistence.purgeDlqItems(before);
    return { purgedCount };
  });
}
