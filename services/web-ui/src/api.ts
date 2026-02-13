const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export interface AssetRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: string;
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
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
  await fetch(`${API_BASE_URL}/api/v1/assets/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function replayJob(jobId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}/replay`, {
    method: "POST"
  });
}

export async function fetchAudit(): Promise<AuditRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/audit`);
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { events: AuditRow[] };
  return body.events;
}
