import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerNavBadgeRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /nav/badges — badge counts for navigation items
    app.get(
      withPrefix(prefix, "/nav/badges"),
      {
        schema: {
          tags: ["navigation"],
          operationId: prefix === "/api/v1" ? "v1NavBadges" : "legacyNavBadges",
          summary: "Badge counts for navigation items",
          response: {
            200: {
              type: "object",
              required: ["queue", "assignments", "approvals", "feedback", "dlq"],
              properties: {
                queue: { type: "number" },
                assignments: { type: "number" },
                approvals: { type: "number" },
                feedback: { type: "number" },
                dlq: { type: "number" },
              },
            },
            500: errorEnvelopeSchema,
          },
        },
      },
      async () => {
        // Queue: pending tasks (not_started or in_progress)
        const stats = await persistence.getWorkflowStats();

        // Approvals: versions pending internal or client review
        const projects = await persistence.listProjects();
        let approvals = 0;
        let feedback = 0;
        for (const project of projects) {
          const sequences = await persistence.listSequencesByProject(project.id);
          for (const seq of sequences) {
            const shots = await persistence.listShotsBySequence(seq.id);
            for (const shot of shots) {
              const versions = await persistence.listVersionsByShot(shot.id);
              for (const version of versions) {
                if (version.reviewStatus === "internal_review" || version.reviewStatus === "client_review") {
                  approvals++;
                }
                if (version.reviewStatus === "wip") {
                  feedback++;
                }
              }
            }
          }
        }

        return {
          queue: stats.queue.pending,
          assignments: stats.jobs.processing,
          approvals,
          feedback,
          dlq: stats.dlq.total,
        };
      }
    );
  }
}
