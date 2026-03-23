import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import {
  errorEnvelopeSchema,
  reviewSessionSchema,
  reviewSessionsResponseSchema,
  reviewSessionWithSubmissionsSchema,
  reviewSessionSubmissionSchema,
  createReviewSessionBodySchema,
  addSubmissionBodySchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { ReviewSessionStatus } from "../domain/models.js";

export async function registerReviewSessionRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /review-sessions — create a session
    app.post<{
      Body: {
        projectId: string;
        department?: string;
        sessionDate: string;
        sessionType: "dailies" | "client_review" | "final";
        supervisorId?: string;
      };
    }>(
      withPrefix(prefix, "/review-sessions"),
      {
        schema: {
          tags: ["review-sessions"],
          operationId: `${opPrefix}CreateReviewSession`,
          summary: "Create a review session",
          body: createReviewSessionBodySchema,
          response: {
            201: { type: "object", required: ["session"], properties: { session: reviewSessionSchema } },
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { projectId, department, sessionDate, sessionType, supervisorId } = request.body;
        const session = await persistence.createReviewSession(
          { projectId, department, sessionDate, sessionType, supervisorId },
          { correlationId: request.id }
        );
        return reply.status(201).send({ session });
      }
    );

    // GET /review-sessions — list sessions
    app.get<{
      Querystring: { projectId?: string; status?: string; department?: string };
    }>(
      withPrefix(prefix, "/review-sessions"),
      {
        schema: {
          tags: ["review-sessions"],
          operationId: `${opPrefix}ListReviewSessions`,
          summary: "List review sessions",
          querystring: {
            type: "object",
            properties: {
              projectId: { type: "string" },
              status: { type: "string" },
              department: { type: "string" }
            }
          },
          response: {
            200: reviewSessionsResponseSchema,
            401: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const filters: { projectId?: string; status?: ReviewSessionStatus; department?: string } = {};
        if (request.query.projectId) filters.projectId = request.query.projectId;
        if (request.query.status) filters.status = request.query.status as ReviewSessionStatus;
        if (request.query.department) filters.department = request.query.department;
        const sessions = await persistence.listReviewSessions(
          Object.keys(filters).length > 0 ? filters : undefined
        );
        return reply.status(200).send({ sessions });
      }
    );

    // GET /review-sessions/:id — get session with submissions
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/review-sessions/:id"),
      {
        schema: {
          tags: ["review-sessions"],
          operationId: `${opPrefix}GetReviewSession`,
          summary: "Get a review session with submissions",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          response: {
            200: reviewSessionWithSubmissionsSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const session = await persistence.getReviewSessionById(request.params.id);
        if (!session) {
          return sendError(request, reply, 404, "NOT_FOUND", "Review session not found");
        }
        const submissions = await persistence.listSubmissionsBySession(session.id);
        return reply.status(200).send({ session, submissions });
      }
    );

    // POST /review-sessions/:id/submissions — add asset to session
    app.post<{
      Params: { id: string };
      Body: { assetId: string; versionId?: string; submissionOrder?: number };
    }>(
      withPrefix(prefix, "/review-sessions/:id/submissions"),
      {
        schema: {
          tags: ["review-sessions"],
          operationId: `${opPrefix}AddSubmission`,
          summary: "Add an asset to a review session",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          body: addSubmissionBodySchema,
          response: {
            201: { type: "object", required: ["submission"], properties: { submission: reviewSessionSubmissionSchema } },
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const session = await persistence.getReviewSessionById(request.params.id);
        if (!session) {
          return sendError(request, reply, 404, "NOT_FOUND", "Review session not found");
        }
        if (session.status === "closed") {
          return sendError(request, reply, 409, "INVALID_STATE", "Cannot add submissions to a closed session");
        }
        const { assetId, versionId, submissionOrder } = request.body;
        const submission = await persistence.addSubmission(
          { sessionId: session.id, assetId, versionId, submissionOrder },
          { correlationId: request.id }
        );
        return reply.status(201).send({ submission });
      }
    );

    // POST /review-sessions/:id/close — close session
    app.post<{
      Params: { id: string };
      Body: { performed_by?: string };
    }>(
      withPrefix(prefix, "/review-sessions/:id/close"),
      {
        schema: {
          tags: ["review-sessions"],
          operationId: `${opPrefix}CloseReviewSession`,
          summary: "Close a review session",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          response: {
            200: { type: "object", required: ["session"], properties: { session: reviewSessionSchema } },
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const session = await persistence.getReviewSessionById(request.params.id);
        if (!session) {
          return sendError(request, reply, 404, "NOT_FOUND", "Review session not found");
        }
        if (session.status === "closed") {
          return sendError(request, reply, 409, "INVALID_STATE", "Session is already closed");
        }
        const updated = await persistence.updateReviewSessionStatus(
          session.id,
          session.status,
          "closed",
          { correlationId: request.id }
        );
        return reply.status(200).send({ session: updated });
      }
    );
  }
}
