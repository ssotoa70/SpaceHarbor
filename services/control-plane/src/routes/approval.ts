import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { ApprovalAuditEntry } from "../domain/models.js";
import {
  validateApprovalTransition,
  type ApprovalAction,
} from "../workflow/approval-state-machine.js";

// In-memory approval audit store (per adapter instance, reset with persistence)
const approvalAuditLog: ApprovalAuditEntry[] = [];

export function getApprovalAuditLog(): ApprovalAuditEntry[] {
  return [...approvalAuditLog];
}

export function resetApprovalAuditLog(): void {
  approvalAuditLog.length = 0;
}

function getAssetStatus(persistence: PersistenceAdapter, assetId: string) {
  const rows = persistence.listAssetQueueRows();
  const row = rows.find((r) => r.id === assetId);
  if (!row) return null;
  return { row, jobId: row.jobId };
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
    Body: { performed_by: string; note?: string; reason?: string };
  }>(withPrefix(prefix, path), async (request, reply) => {
    const { id } = request.params;
    const { performed_by, note, reason } = request.body ?? {};

    if (!performed_by || typeof performed_by !== "string") {
      return sendError(request, reply, 400, "VALIDATION_ERROR", "performed_by is required");
    }

    const assetInfo = getAssetStatus(persistence, id);
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
      const updated = persistence.updateJobStatus(
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

    // Record approval audit entry
    approvalAuditLog.push(result.auditEntry);

    // Refresh asset row after transition
    const updatedRow = getAssetStatus(persistence, id);

    return reply.status(200).send({
      asset: updatedRow?.row ?? assetInfo.row,
      audit: result.auditEntry,
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
    app.get(withPrefix(prefix, "/assets/approval-queue"), async () => {
      const rows = persistence.listAssetQueueRows();
      const inReview = rows.filter((r) => r.status === "qc_in_review");

      // Attach audit trail per asset
      const assetsWithAudit = inReview.map((row) => ({
        ...row,
        auditTrail: approvalAuditLog.filter((e) => e.assetId === row.id),
      }));

      return { assets: assetsWithAudit };
    });
  }
}
