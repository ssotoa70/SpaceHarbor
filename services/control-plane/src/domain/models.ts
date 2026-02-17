export type WorkflowStatus = "pending" | "processing" | "completed" | "failed" | "needs_replay";

export interface Asset {
  id: string;
  title: string;
  sourceUri: string;
  createdAt: string;
}

export interface WorkflowJob {
  id: string;
  assetId: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface IngestResult {
  asset: Asset;
  job: WorkflowJob;
}

export interface AssetQueueRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: WorkflowStatus;
}

export interface AuditEvent {
  id: string;
  message: string;
  at: string;
  signal?: AuditSignal;
}

export interface AuditSignal {
  type: "fallback";
  code: "VAST_FALLBACK";
  severity: "warning" | "critical";
}

export interface IncidentGuidedActions {
  acknowledged: boolean;
  owner: string;
  escalated: boolean;
  nextUpdateEta: string | null;
  updatedAt: string | null;
}

export type IncidentHandoffState = "none" | "handoff_requested" | "handoff_accepted";

export interface IncidentHandoff {
  state: IncidentHandoffState;
  fromOwner: string;
  toOwner: string;
  summary: string;
  updatedAt: string | null;
}

export interface IncidentNote {
  id: string;
  message: string;
  correlationId: string;
  author: string;
  at: string;
}

export interface IncidentCoordination {
  guidedActions: IncidentGuidedActions;
  handoff: IncidentHandoff;
  notes: IncidentNote[];
}

export interface OutboxItem {
  id: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  publishedAt: string | null;
}

export interface DlqItem {
  id: string;
  jobId: string;
  assetId: string;
  error: string;
  attemptCount: number;
  failedAt: string;
}
