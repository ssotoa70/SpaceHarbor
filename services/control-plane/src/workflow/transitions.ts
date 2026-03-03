import type { WorkflowStatus } from "../domain/models";

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  pending: ["processing"],
  processing: ["completed", "failed"],
  completed: ["qc_pending"],
  failed: ["needs_replay"],
  needs_replay: ["pending"],
  qc_pending: ["qc_in_review"],
  qc_in_review: ["qc_approved", "qc_rejected"],
  qc_approved: [],
  qc_rejected: ["needs_replay"]
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}
