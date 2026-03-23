import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

interface WorkQueueQuery {
  assignee?: string;
  status?: string;
}

interface WorkAssignmentsQuery {
  user?: string;
}

export async function registerWorkRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /work/queue — tasks filtered by assignee and optional status
    app.get<{ Querystring: WorkQueueQuery }>(
      withPrefix(prefix, "/work/queue"),
      {
        schema: {
          tags: ["work"],
          operationId: prefix === "/api/v1" ? "v1WorkQueue" : "legacyWorkQueue",
          summary: "Tasks filtered by assignee and optional status",
          querystring: {
            type: "object",
            properties: {
              assignee: { type: "string" },
              status: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                tasks: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
            400: { type: "object", additionalProperties: true },
          },
        },
      },
      async (request, reply) => {
        const { assignee, status } = request.query;
        if (!assignee) {
          return sendError(request, reply, 400, "BAD_REQUEST", "assignee query parameter is required");
        }
        const tasks = await persistence.listTasksByAssignee(assignee, status);
        return { tasks };
      }
    );

    // GET /work/assignments — shots by lead + versions by createdBy
    app.get<{ Querystring: WorkAssignmentsQuery }>(
      withPrefix(prefix, "/work/assignments"),
      {
        schema: {
          tags: ["work"],
          operationId: prefix === "/api/v1" ? "v1WorkAssignments" : "legacyWorkAssignments",
          summary: "Shots by lead and versions by creator for a user",
          querystring: {
            type: "object",
            properties: {
              user: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                shots: { type: "array", items: { type: "object", additionalProperties: true } },
                versions: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
            400: { type: "object", additionalProperties: true },
          },
        },
      },
      async (request, reply) => {
        const { user } = request.query;
        if (!user) {
          return sendError(request, reply, 400, "BAD_REQUEST", "user query parameter is required");
        }

        // Collect shots where the user is the lead
        const projects = await persistence.listProjects();
        const shotsByLead: any[] = [];
        const versionsByCreator: any[] = [];

        for (const project of projects) {
          const sequences = await persistence.listSequencesByProject(project.id);
          for (const seq of sequences) {
            const shots = await persistence.listShotsBySequence(seq.id);
            for (const shot of shots) {
              if (shot.lead === user) {
                shotsByLead.push(shot);
              }
              const versions = await persistence.listVersionsByShot(shot.id);
              for (const version of versions) {
                if (version.createdBy === user) {
                  versionsByCreator.push(version);
                }
              }
            }
          }
        }

        return { shots: shotsByLead, versions: versionsByCreator };
      }
    );
  }
}
