import type { IngestResult, WorkflowJob } from "../../domain/models.js";

import type { IngestInput, WriteContext } from "../types.js";

export interface VastWorkflowClient {
  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult | null;
  getJobById(jobId: string): WorkflowJob | null;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  replayJob(jobId: string, context: WriteContext): WorkflowJob | null;
}
