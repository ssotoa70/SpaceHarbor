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
}

export interface AuditSignal {
  type: "fallback";
  code: "VAST_FALLBACK";
  severity: "warning" | "critical";
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
  signal: AuditSignal | null;
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

export async function fetchIncidentCoordination(): Promise<IncidentCoordination | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/incident/coordination`);
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as IncidentCoordination;
}

export async function updateIncidentGuidedActions(input: {
  acknowledged: boolean;
  owner: string;
  escalated: boolean;
  nextUpdateEta: string | null;
  expectedUpdatedAt: string | null;
}): Promise<IncidentGuidedActions> {
  const response = await fetch(`${API_BASE_URL}/api/v1/incident/coordination/actions`, {
    method: "PUT",
    headers: withAuth({
      "content-type": "application/json"
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`incident actions update failed: ${response.status}`);
  }

  const body = (await response.json()) as { guidedActions: IncidentGuidedActions };
  return body.guidedActions;
}

export async function createIncidentCoordinationNote(input: {
  message: string;
  correlationId: string;
  author: string;
}): Promise<IncidentNote> {
  const response = await fetch(`${API_BASE_URL}/api/v1/incident/coordination/notes`, {
    method: "POST",
    headers: withAuth({
      "content-type": "application/json"
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`incident note create failed: ${response.status}`);
  }

  const body = (await response.json()) as { note: IncidentNote };
  return body.note;
}

export async function updateIncidentHandoff(input: {
  state: IncidentHandoffState;
  fromOwner: string;
  toOwner: string;
  summary: string;
  expectedUpdatedAt: string | null;
}): Promise<IncidentHandoff> {
  const response = await fetch(`${API_BASE_URL}/api/v1/incident/coordination/handoff`, {
    method: "PUT",
    headers: withAuth({
      "content-type": "application/json"
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`incident handoff update failed: ${response.status}`);
  }

  const body = (await response.json()) as { handoff: IncidentHandoff };
  return body.handoff;
}
