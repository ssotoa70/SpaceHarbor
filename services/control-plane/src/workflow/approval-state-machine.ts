import type { WorkflowStatus, ApprovalAuditEntry } from "../domain/models.js";
import { canTransition } from "./transitions.js";
import { randomUUID } from "node:crypto";

export type ApprovalAction = "request_review" | "approve" | "reject";

const ACTION_TARGET_STATUS: Record<ApprovalAction, WorkflowStatus> = {
  request_review: "qc_in_review",
  approve: "qc_approved",
  reject: "qc_rejected",
};

const ACTION_REQUIRED_STATUS: Record<ApprovalAction, WorkflowStatus> = {
  request_review: "qc_pending",
  approve: "qc_in_review",
  reject: "qc_in_review",
};

export interface TransitionResult {
  ok: true;
  fromStatus: WorkflowStatus;
  toStatus: WorkflowStatus;
  auditEntry: ApprovalAuditEntry;
}

export interface TransitionError {
  ok: false;
  code: "INVALID_TRANSITION" | "WRONG_STATUS";
  message: string;
  currentStatus: WorkflowStatus;
  requiredStatus: WorkflowStatus;
}

export function validateApprovalTransition(
  action: ApprovalAction,
  currentStatus: WorkflowStatus,
  assetId: string,
  performedBy: string,
  note: string | null,
  now: Date
): TransitionResult | TransitionError {
  const requiredStatus = ACTION_REQUIRED_STATUS[action];
  const targetStatus = ACTION_TARGET_STATUS[action];

  if (currentStatus !== requiredStatus) {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `Cannot ${action}: asset status is '${currentStatus}', expected '${requiredStatus}'`,
      currentStatus,
      requiredStatus,
    };
  }

  if (!canTransition(currentStatus, targetStatus)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Transition from '${currentStatus}' to '${targetStatus}' is not allowed`,
      currentStatus,
      requiredStatus,
    };
  }

  const auditEntry: ApprovalAuditEntry = {
    id: randomUUID(),
    assetId,
    action,
    performedBy,
    note,
    at: now.toISOString(),
  };

  return {
    ok: true,
    fromStatus: currentStatus,
    toStatus: targetStatus,
    auditEntry,
  };
}
