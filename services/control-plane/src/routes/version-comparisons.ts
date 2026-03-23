import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  errorEnvelopeSchema,
  versionComparisonSchema,
  versionComparisonsResponseSchema,
  createVersionComparisonBodySchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerVersionComparisonRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /versions/:versionAId/compare/:versionBId — create a comparison
    app.post<{
      Params: { versionAId: string; versionBId: string };
      Body: {
        comparisonType: string;
        diffMetadata?: string;
        pixelDiffPercentage?: number;
        frameDiffCount?: number;
        resolutionMatch: boolean;
        colorspaceMatch: boolean;
        createdBy: string;
      };
    }>(
      withPrefix(prefix, "/versions/:versionAId/compare/:versionBId"),
      {
        schema: {
          operationId: `${opPrefix}CreateVersionComparison`,
          body: createVersionComparisonBodySchema,
          response: {
            201: { type: "object", required: ["comparison"], properties: { comparison: versionComparisonSchema } },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { versionAId, versionBId } = request.params;
        const comparison = await persistence.createVersionComparison(
          { ...request.body, versionAId, versionBId },
          { correlationId: (request as any).correlationId ?? request.id }
        );
        return reply.code(201).send({ comparison });
      }
    );

    // GET /versions/:id/comparisons — list all comparisons for a version
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/versions/:id/comparisons"),
      {
        schema: {
          operationId: `${opPrefix}ListVersionComparisons`,
          response: {
            200: versionComparisonsResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request) => {
        const comparisons = await persistence.listComparisonsByVersion(request.params.id);
        return { comparisons };
      }
    );
  }
}
