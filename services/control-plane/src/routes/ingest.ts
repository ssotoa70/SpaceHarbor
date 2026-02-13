import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { assetSchema, errorEnvelopeSchema, workflowJobSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

interface IngestPayload {
  title: string;
  sourceUri: string;
}

const ingestBodySchema = {
  type: "object",
  required: ["title", "sourceUri"],
  properties: {
    title: { type: "string", minLength: 1 },
    sourceUri: { type: "string", minLength: 1 }
  }
} as const;

const ingestResponseSchema = {
  type: "object",
  required: ["asset", "job"],
  properties: {
    asset: assetSchema,
    job: workflowJobSchema
  }
} as const;

export async function registerIngestRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const routePath = withPrefix(prefix, "/assets/ingest");
    app.post<{ Body: IngestPayload }>(
      routePath,
      {
        attachValidation: true,
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1IngestAsset" : "legacyIngestAsset",
          summary: "Register a media asset for ingest",
          body: ingestBodySchema,
          response: {
            201: ingestResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema
          },
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {})
        }
      },
      async (request, reply) => {
        const title = request.body?.title?.trim();
        const sourceUri = request.body?.sourceUri?.trim();

        if (!title || !sourceUri) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "title and sourceUri are required", {
            fields: ["title", "sourceUri"]
          });
        }

        const result = persistence.createIngestAsset(
          { title, sourceUri },
          { correlationId: resolveCorrelationId(request) }
        );
        return reply.status(201).send(result);
      }
    );
  }
}
