import type { AssetRow, AuditRow, SortDirection, SortField } from "./types";

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

function jsonHeaders(): Record<string, string> {
  return withAuth({ "content-type": "application/json" });
}

export type { AssetRow, AuditRow };

export async function fetchAssets(): Promise<AssetRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets`, {
    headers: withAuth()
  });
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { assets: AssetRow[] };
  return body.assets;
}

export async function fetchApprovalQueue(
  sort: SortField = "created_at",
  direction: SortDirection = "desc",
  page = 1,
  limit = 20
): Promise<{ assets: AssetRow[]; total: number }> {
  const params = new URLSearchParams({
    sort,
    direction,
    page: String(page),
    limit: String(limit)
  });
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/approval-queue?${params}`,
    { headers: withAuth() }
  );
  if (!response.ok) {
    return { assets: [], total: 0 };
  }

  return (await response.json()) as { assets: AssetRow[]; total: number };
}

export async function approveAsset(assetId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/approve`, {
    method: "POST",
    headers: jsonHeaders()
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((body as { error?: string }).error ?? `Approve failed: ${response.status}`);
  }
}

export async function rejectAsset(assetId: string, reason: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/reject`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ reason })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((body as { error?: string }).error ?? `Reject failed: ${response.status}`);
  }
}

export async function requestReview(assetId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/request-review`, {
    method: "POST",
    headers: jsonHeaders()
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((body as { error?: string }).error ?? `Request review failed: ${response.status}`);
  }
}

export async function ingestAsset(input: {
  title: string;
  sourceUri: string;
  projectId?: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/ingest`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((body as { error?: string }).error ?? `Ingest failed: ${response.status}`);
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
  const response = await fetch(`${API_BASE_URL}/api/v1/audit`, {
    headers: withAuth()
  });
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { events: AuditRow[] };
  return body.events;
}
