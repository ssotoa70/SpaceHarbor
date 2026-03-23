import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  errorEnvelopeSchema,
  reviewCommentSchema,
  reviewCommentsResponseSchema,
  createReviewCommentBodySchema,
  resolveCommentResponseSchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerCommentRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /reviews/:sessionId/comments — create a comment on a review session
    app.post<{
      Params: { sessionId: string };
      Body: {
        authorId: string;
        body: string;
        submissionId?: string;
        versionId?: string;
        parentCommentId?: string;
        authorRole?: string;
        frameNumber?: number;
        timecode?: string;
        annotationType?: "text" | "drawing" | "arrow" | "rect" | "circle";
      };
    }>(
      withPrefix(prefix, "/reviews/:sessionId/comments"),
      {
        schema: {
          tags: ["comments"],
          operationId: `${opPrefix}CreateReviewComment`,
          summary: "Create a timecoded review comment",
          body: createReviewCommentBodySchema,
          response: {
            201: { type: "object", required: ["comment"], properties: { comment: reviewCommentSchema } },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { sessionId } = request.params;
        const { authorId, body, submissionId, versionId, parentCommentId, authorRole, frameNumber, timecode, annotationType } = request.body;
        const comment = await persistence.createReviewComment(
          { sessionId, submissionId, versionId, parentCommentId, authorId, authorRole, body, frameNumber, timecode, annotationType },
          { correlationId: request.id }
        );
        return reply.status(201).send({ comment });
      }
    );

    // GET /reviews/:sessionId/comments — list comments for a session
    app.get<{
      Params: { sessionId: string };
    }>(
      withPrefix(prefix, "/reviews/:sessionId/comments"),
      {
        schema: {
          tags: ["comments"],
          operationId: `${opPrefix}ListReviewComments`,
          summary: "List comments for a review session",
          response: {
            200: reviewCommentsResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { sessionId } = request.params;
        const comments = await persistence.listCommentsBySession(sessionId);
        return reply.send({ comments });
      }
    );

    // PUT /comments/:id/resolve — resolve a comment
    app.put<{
      Params: { id: string };
    }>(
      withPrefix(prefix, "/comments/:id/resolve"),
      {
        schema: {
          tags: ["comments"],
          operationId: `${opPrefix}ResolveComment`,
          summary: "Mark a review comment as resolved",
          response: {
            200: resolveCommentResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;
        const comment = await persistence.resolveComment(id, { correlationId: request.id });
        if (!comment) {
          return reply.status(404).send({ error: "comment not found" });
        }
        return reply.send({ comment });
      }
    );
  }
}
