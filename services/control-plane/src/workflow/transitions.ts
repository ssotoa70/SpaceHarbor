import type { WorkflowStatus } from "../domain/models.js";

const ALLOWED_TRANSITIONS: Record<WorkflowStatus, Set<WorkflowStatus>> = {
  pending: new Set(["pending", "processing", "completed", "failed", "needs_replay"]),
  processing: new Set(["processing", "pending", "failed", "completed", "needs_replay"]),
  failed: new Set(["failed", "pending", "needs_replay"]),
  needs_replay: new Set(["needs_replay", "pending", "processing", "completed", "failed"]),
  completed: new Set(["completed", "qc_pending"]),
  qc_pending: new Set(["qc_pending", "qc_in_review"]),
  qc_in_review: new Set(["qc_in_review", "qc_approved", "qc_rejected"]),
  qc_approved: new Set(["qc_approved"]),
  qc_rejected: new Set(["qc_rejected", "needs_replay"])
};

export function canTransitionWorkflowStatus(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
