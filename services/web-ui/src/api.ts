import type { MetricsSnapshot } from "./operator/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const API_KEY = import.meta.env.VITE_API_KEY;

function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  if (!API_KEY) {
    return headers;
  }

  return {
    ...headers,
    "x-api-key": API_KEY
  };
}

export interface AssetRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: string;
  thumbnail: {
    uri: string;
    width: number;
    height: number;
    generatedAt: string;
  } | null;
  proxy: {
    uri: string;
    durationSeconds: number;
    codec: string;
    generatedAt: string;
  } | null;
  annotationHook: {
    enabled: boolean;
    provider: string | null;
    contextId: string | null;
  };
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
}

export type WorkflowEventType =
  | "asset.processing.replay_requested"
  | "asset.review.qc_pending"
  | "asset.review.in_review"
  | "asset.review.approved"
  | "asset.review.rejected";

export async function fetchAssets(): Promise<AssetRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets`);
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { assets: AssetRow[] };
  return body.assets;
}

export async function ingestAsset(input: { title: string; sourceUri: string }): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/ingest`, {
    method: "POST",
    headers: withAuth({
      "content-type": "application/json"
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`ingest failed: ${response.status}`);
  }
}

export async function replayJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}/replay`, {
    method: "POST",
    headers: withAuth()
  });

  if (!response.ok) {
    throw new Error(`replay failed: ${response.status}`);
  }
}

export async function submitWorkflowEvent(input: {
  assetId: string;
  jobId: string;
  eventType: WorkflowEventType;
  producer: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/events`, {
    method: "POST",
    headers: withAuth({
      "content-type": "application/json"
    }),
    body: JSON.stringify({
      eventId: `web-ui-${input.eventType}-${input.jobId}-${Date.now()}`,
      eventType: input.eventType,
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: `web-ui-${input.jobId}`,
      producer: input.producer,
      data: {
        assetId: input.assetId,
        jobId: input.jobId
      }
    })
  });

  if (!response.ok) {
    throw new Error(`event submit failed: ${response.status}`);
  }
}

export async function fetchAudit(): Promise<AuditRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/audit`);
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { events: AuditRow[] };
  return body.events;
}

export async function fetchMetrics(): Promise<MetricsSnapshot | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/metrics`);
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MetricsSnapshot;
}
