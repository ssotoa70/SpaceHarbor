import type { IngestResult, WorkflowJob } from "../../domain/models.js";

import type { FailureResult, IngestInput, WriteContext } from "../types.js";

export interface VastWorkflowClient {
  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult;
  setJobStatus(jobId: string, status: WorkflowJob["status"], lastError: string | null | undefined, context: WriteContext): WorkflowJob | null;
  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult;
  getJobById(jobId: string): WorkflowJob | null;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  replayJob(jobId: string, context: WriteContext): WorkflowJob | null;
  hasProcessedEvent(eventId: string): boolean;
  markProcessedEvent(eventId: string): void;
}
