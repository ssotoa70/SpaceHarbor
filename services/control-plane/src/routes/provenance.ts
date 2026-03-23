import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  errorEnvelopeSchema,
  assetProvenanceSchema,
  provenanceResponseSchema,
  createProvenanceBodySchema,
  lineageResponseSchema,
  versionTreeResponseSchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { LineageRelationshipType } from "../domain/models.js";

export async function registerProvenanceRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /versions/:id/provenance — record provenance for a version
    app.post<{
      Params: { id: string };
      Body: {
        creator?: string;
        softwareUsed?: string;
        softwareVersion?: string;
        renderJobId?: string;
        pipelineStage?: string;
        vastStoragePath?: string;
        vastElementHandle?: string;
        sourceHost?: string;
        sourceProcessId?: string;
      };
    }>(
      withPrefix(prefix, "/versions/:id/provenance"),
      {
        schema: {
          tags: ["provenance"],
          operationId: `${opPrefix}CreateProvenance`,
          summary: "Record provenance for a version",
          body: createProvenanceBodySchema,
          response: {
            201: { type: "object", required: ["provenance"], properties: { provenance: assetProvenanceSchema } },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;
        const provenance = await persistence.createProvenance(
          { versionId: id, ...request.body },
          { correlationId: request.id }
        );
        return reply.status(201).send({ provenance });
      }
    );

    // GET /versions/:id/provenance — get provenance records for a version
    app.get<{
      Params: { id: string };
    }>(
      withPrefix(prefix, "/versions/:id/provenance"),
      {
        schema: {
          tags: ["provenance"],
          operationId: `${opPrefix}GetProvenance`,
          summary: "Get provenance records for a version",
          response: {
            200: provenanceResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;
        const provenance = await persistence.getProvenanceByVersion(id);
        return reply.send({ provenance });
      }
    );

    // GET /versions/:id/lineage — get ancestor or descendant lineage
    app.get<{
      Params: { id: string };
      Querystring: { direction?: "ancestors" | "descendants"; maxDepth?: string };
    }>(
      withPrefix(prefix, "/versions/:id/lineage"),
      {
        schema: {
          tags: ["provenance"],
          operationId: `${opPrefix}GetLineage`,
          summary: "Get version lineage (ancestors or descendants)",
          querystring: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["ancestors", "descendants"], default: "ancestors" },
              maxDepth: { type: "string", pattern: "^\\d+$" }
            }
          },
          response: {
            200: lineageResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;
        const direction = request.query.direction ?? "ancestors";
        const maxDepth = request.query.maxDepth ? parseInt(request.query.maxDepth, 10) : 10;
        const lineage = direction === "ancestors"
          ? await persistence.getAncestors(id, maxDepth)
          : await persistence.getDescendants(id, maxDepth);
        return reply.send({ lineage });
      }
    );

    // GET /shots/:id/version-tree — get full version lineage tree for a shot
    app.get<{
      Params: { id: string };
    }>(
      withPrefix(prefix, "/shots/:id/version-tree"),
      {
        schema: {
          tags: ["provenance"],
          operationId: `${opPrefix}GetVersionTree`,
          summary: "Get full version lineage tree for a shot",
          response: {
            200: versionTreeResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;
        const tree = await persistence.getVersionTree(id);
        return reply.send({ tree });
      }
    );
  }
}
