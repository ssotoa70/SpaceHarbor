import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { ApprovalAuditEntry, ReviewComment } from "../domain/models.js";
import {
  validateApprovalTransition,
  type ApprovalAction,
} from "../workflow/approval-state-machine.js";

async function getAssetStatus(persistence: PersistenceAdapter, assetId: string) {
  const rows = await persistence.listAssetQueueRows();
  const row = rows.find((r) => r.id === assetId);
  if (!row) return null;
  return { row, jobId: row.jobId };
}

function approvalActionSchema(action: ApprovalAction) {
  const summaryMap: Record<ApprovalAction, string> = {
    request_review: "Request QC review for an asset",
    approve: "Approve an asset after QC review",
    reject: "Reject an asset after QC review",
  };
  const operationIdMap: Record<ApprovalAction, string> = {
    request_review: "requestAssetReview",
    approve: "approveAsset",
    reject: "rejectAsset",
  };
  return {
    tags: ["review"],
    operationId: operationIdMap[action],
    summary: summaryMap[action],
    security: [{ BearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Asset ID" } },
    },
    body: {
      type: "object",
      properties: {
        performed_by: { type: "string", description: "User ID performing the action (overridden by bearer identity if present)" },
        note: { type: "string" },
        reason: { type: "string" },
        session_id: { type: "string" },
        version_id: { type: "string" },
      },
    },
    response: {
      200: {
        type: "object",
        properties: {
          asset: { type: "object" },
          audit: { type: "object" },
          rejection: {
            type: "object",
            properties: {
              reason: { type: "string" },
              rejectedBy: { type: "string" },
              comments: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
      400: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
          details: {},
        },
      },
      404: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
          details: {},
        },
      },
      409: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
          details: {},
        },
      },
    },
  };
}

async function handleApprovalAction(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefix: string,
  action: ApprovalAction,
  path: string
) {
  app.post<{
    Params: { id: string };
    Body: { performed_by: string; note?: string; reason?: string; session_id?: string; version_id?: string };
  }>(withPrefix(prefix, path), { schema: approvalActionSchema(action) }, async (request, reply) => {
    const { id } = request.params;
    const { performed_by: bodyPerformedBy, note, reason, session_id, version_id } = request.body ?? {};

    // Prefer header identity over body field
    const performed_by = request.identity ?? bodyPerformedBy;

    if (!performed_by || typeof performed_by !== "string") {
      return sendError(request, reply, 400, "VALIDATION_ERROR", "performed_by is required");
    }

    const assetInfo = await getAssetStatus(persistence, id);
    if (!assetInfo) {
      return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${id}`);
    }

    const now = new Date();
    const actionNote = note ?? reason ?? null;
    const result = validateApprovalTransition(
      action,
      assetInfo.row.status,
      id,
      performed_by,
      actionNote,
      now
    );

    if (!result.ok) {
      return sendError(request, reply, 409, result.code, result.message, {
        currentStatus: result.currentStatus,
        requiredStatus: result.requiredStatus,
      });
    }

    // Transition the job status
    if (assetInfo.jobId) {
      const updated = await persistence.updateJobStatus(
        assetInfo.jobId,
        result.fromStatus,
        result.toStatus,
        { correlationId: request.id, now: now.toISOString() }
      );

      if (!updated) {
        return sendError(
          request,
          reply,
          409,
          "CAS_CONFLICT",
          "Concurrent modification detected; please retry"
        );
      }
    }

    // Attach optional version/session linkage to audit entry
    const auditEntry = { ...result.auditEntry };
    if (version_id) auditEntry.versionId = version_id;
    if (session_id) auditEntry.sessionId = session_id;

    // Record approval audit entry via persistence
    await persistence.appendApprovalAuditEntry(auditEntry);

    // Refresh asset row after transition
    const updatedRow = await getAssetStatus(persistence, id);

    // For rejections, gather linked frame comments for downstream consumers
    let rejectionComments: Array<{
      id: string;
      body: string;
      frameNumber: number | null;
      timecode: string | null;
      authorId: string;
    }> = [];
    if (action === "reject" && session_id) {
      const sessionComments = await persistence.listCommentsBySession(session_id);
      rejectionComments = sessionComments.map((c) => ({
        id: c.id,
        body: c.body,
        frameNumber: c.frameNumber,
        timecode: c.timecode,
        authorId: c.authorId,
      }));
    }

    return reply.status(200).send({
      asset: updatedRow?.row ?? assetInfo.row,
      audit: auditEntry,
      ...(action === "reject"
        ? {
            rejection: {
              reason: actionNote ?? undefined,
              rejectedBy: performed_by,
              comments: rejectionComments,
            },
          }
        : {}),
    });
  });
}

export async function registerApprovalRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // POST /assets/:id/request-review
    await handleApprovalAction(
      app,
      persistence,
      prefix,
      "request_review",
      "/assets/:id/request-review"
    );

    // POST /assets/:id/approve
    await handleApprovalAction(
      app,
      persistence,
      prefix,
      "approve",
      "/assets/:id/approve"
    );

    // POST /assets/:id/reject
    await handleApprovalAction(
      app,
      persistence,
      prefix,
      "reject",
      "/assets/:id/reject"
    );

    // GET /assets/approval-queue
    app.get(withPrefix(prefix, "/assets/approval-queue"), {
      schema: {
        tags: ["review"],
        operationId: "getApprovalQueue",
        summary: "List assets currently in QC review",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    auditTrail: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    }, async () => {
      const rows = await persistence.listAssetQueueRows();
      const inReview = rows.filter((r) => r.status === "qc_in_review");

      // Attach audit trail per asset via persistence
      const assetsWithAudit = await Promise.all(
        inReview.map(async (row) => ({
          ...row,
          auditTrail: await persistence.getApprovalAuditLogByAssetId(row.id),
        }))
      );

      return { assets: assetsWithAudit };
    });

    // GET /assets/rejected-feedback — rejected assets with rejection details and comments
    app.get<{
      Querystring: { assignee?: string };
    }>(withPrefix(prefix, "/assets/rejected-feedback"), {
      schema: {
        tags: ["review"],
        operationId: "getRejectedFeedback",
        summary: "List rejected assets with rejection details and linked comments",
        security: [{ BearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            assignee: { type: "string", description: "Filter by rejected-by or created-by user ID" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    rejectionReason: { type: "string", nullable: true },
                    rejectedBy: { type: "string", nullable: true },
                    rejectedAt: { type: "string", nullable: true },
                    comments: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    }, async (request) => {
      const rows = await persistence.listAssetQueueRows();
      const rejected = rows.filter((r) => r.status === "qc_rejected");

      const enriched = await Promise.all(
        rejected.map(async (row) => {
          const auditLog = await persistence.getApprovalAuditLogByAssetId(row.id);
          // Find the most recent rejection audit entry
          const rejectionEntry = auditLog
            .filter((e) => e.action === "reject")
            .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

          // Gather comments linked to the rejection session
          let comments: ReviewComment[] = [];
          if (rejectionEntry?.sessionId) {
            comments = await persistence.listCommentsBySession(rejectionEntry.sessionId);
          }

          return {
            ...row,
            rejectionReason: rejectionEntry?.note ?? null,
            rejectedBy: rejectionEntry?.performedBy ?? null,
            rejectedAt: rejectionEntry?.at ?? null,
            comments: comments.map((c) => ({
              id: c.id,
              body: c.body,
              frameNumber: c.frameNumber,
              timecode: c.timecode,
              authorId: c.authorId,
              status: c.status,
              createdAt: c.createdAt,
            })),
          };
        })
      );

      // Optional assignee filter (for "My Feedback" — filter by who the asset belongs to)
      const assignee = request.query?.assignee;
      const filtered = assignee
        ? enriched.filter((a) => a.rejectedBy === assignee || (a as Record<string, unknown>).createdBy === assignee)
        : enriched;

      return { assets: filtered };
    });
  }
}
