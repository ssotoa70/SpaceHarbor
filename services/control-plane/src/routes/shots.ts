import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { Shot, ShotStatus } from "../domain/models.js";

interface ShotBoardQuery {
  projectId?: string;
}

const SHOT_STATUS_COLUMNS: ShotStatus[] = ["active", "omit", "locked", "delivered"];

export async function registerShotRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /shots/board — shots grouped by status columns for a project
    app.get<{ Querystring: ShotBoardQuery }>(
      withPrefix(prefix, "/shots/board"),
      {
        schema: {
          tags: ["production"],
          operationId: prefix === "/api/v1" ? "v1ShotBoard" : "legacyShotBoard",
          summary: "Shots grouped by status columns for a project",
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
                columns: { type: "object", additionalProperties: true },
                totalShots: { type: "number" },
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

        // Gather all shots for this project via sequences
        const sequences = await persistence.listSequencesByProject(projectId);
        const allShots: Shot[] = [];
        for (const seq of sequences) {
          const shots = await persistence.listShotsBySequence(seq.id);
          allShots.push(...shots);
        }

        // Group by status
        const columns: Record<string, Shot[]> = {};
        for (const status of SHOT_STATUS_COLUMNS) {
          columns[status] = [];
        }
        for (const shot of allShots) {
          if (columns[shot.status]) {
            columns[shot.status].push(shot);
          } else {
            columns[shot.status] = [shot];
          }
        }

        return {
          projectId,
          columns,
          totalShots: allShots.length,
        };
      }
    );
  }
}
