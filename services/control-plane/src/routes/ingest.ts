import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

interface IngestPayload {
  title: string;
  sourceUri: string;
}

export async function registerIngestRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.post<{ Body: IngestPayload }>(withPrefix(prefix, "/assets/ingest"), async (request, reply) => {
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
    });
  }
}
