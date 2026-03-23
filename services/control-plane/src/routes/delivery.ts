import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

interface DeliveryStatusQuery {
  projectId?: string;
}

interface ShotDeliveryItem {
  shotId: string;
  shotCode: string;
  status: string;
  hasApprovedVersion: boolean;
  latestVersionId: string | null;
  latestReviewStatus: string | null;
  deliveryReady: boolean;
}

export async function registerDeliveryRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /delivery/status — aggregated shot delivery readiness for a project
    app.get<{ Querystring: DeliveryStatusQuery }>(
      withPrefix(prefix, "/delivery/status"),
      {
        schema: {
          tags: ["production"],
          operationId: prefix === "/api/v1" ? "v1DeliveryStatus" : "legacyDeliveryStatus",
          summary: "Aggregated shot delivery readiness for a project",
          querystring: {
            type: "object",
            properties: {
              projectId: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                projectId: { type: "string" },
                totalShots: { type: "number" },
                readyCount: { type: "number" },
                notReadyCount: { type: "number" },
                readinessPercent: { type: "number" },
                shots: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
            400: { type: "object", additionalProperties: true },
            404: { type: "object", additionalProperties: true },
          },
        },
      },
      async (request, reply) => {
        const { projectId } = request.query;
        if (!projectId) {
          return sendError(request, reply, 400, "BAD_REQUEST", "projectId query parameter is required");
        }

        const project = await persistence.getProjectById(projectId);
        if (!project) {
          return sendError(request, reply, 404, "NOT_FOUND", `Project not found: ${projectId}`);
        }

        const sequences = await persistence.listSequencesByProject(projectId);
        const items: ShotDeliveryItem[] = [];

        for (const seq of sequences) {
          const shots = await persistence.listShotsBySequence(seq.id);
          for (const shot of shots) {
            const versions = await persistence.listVersionsByShot(shot.id);
            const hasApprovedVersion = versions.some((v) => v.reviewStatus === "approved");
            const latestVersion = versions.length > 0 ? versions[versions.length - 1] : null;
            const deliveryReady = shot.status === "delivered" || (shot.status === "locked" && hasApprovedVersion);

            items.push({
              shotId: shot.id,
              shotCode: shot.code,
              status: shot.status,
              hasApprovedVersion,
              latestVersionId: latestVersion?.id ?? null,
              latestReviewStatus: latestVersion?.reviewStatus ?? null,
              deliveryReady,
            });
          }
        }

        const totalShots = items.length;
        const readyCount = items.filter((i) => i.deliveryReady).length;
        const notReadyCount = totalShots - readyCount;

        return {
          projectId,
          totalShots,
          readyCount,
          notReadyCount,
          readinessPercent: totalShots > 0 ? Math.round((readyCount / totalShots) * 100) : 0,
          shots: items,
        };
      }
    );
  }
}
