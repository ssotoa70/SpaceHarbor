import type { MetricsSnapshot } from "./operator/types";
import type { AssetRow, RejectedAssetRow, SortField, SortDirection, PipelineStage } from "./types";
export type { AssetRow, RejectedAssetRow } from "./types";

/* ── Hierarchy types ── */

export interface HierarchyNode {
  id: string;
  label: string;
  type: "project" | "sequence" | "shot" | "task" | "version";
  status?: string;
  assignee?: string;
  frame_range?: { start: number; end: number };
  pipeline_stage?: PipelineStage;
  proxyUri?: string;
  resolution?: string;
  color_space?: string;
  children?: HierarchyNode[];
}

export interface HierarchyResponse {
  projects: HierarchyNode[];
}

/* ── Timeline types ── */

export interface TimelineClipData {
  id: string;
  name: string;
  source: string;
  sourceUri?: string;
  shotId?: string;
  versionId?: string;
  startFrame: number;
  endFrame: number;
  conformStatus: "matched" | "unmatched" | "conflict";
  matchedShotId?: string;
}

export interface TimelineTrackData {
  name: string;
  clips: TimelineClipData[];
}

export interface TimelineData {
  id: string;
  name: string;
  tracks: TimelineTrackData[];
  totalFrames: number;
}

/* ── Material types ── */

export interface TextureDep {
  path: string;
  vastUri?: string;
  type: "diffuse" | "normal" | "roughness" | "displacement" | "other";
}

export interface LookVariant {
  name: string;
  renderContext: string;
  previewColor: string;
}

export interface MaterialVersion {
  id: string;
  label: string;
  looks: LookVariant[];
  dependencies: TextureDep[];
}

export interface MaterialData {
  id: string;
  name: string;
  versions: MaterialVersion[];
  usedBy: { shotId: string; versionLabel: string }[];
}

/* ── DataEngine types ── */

export interface DataEngineFunction {
  id: string;
  name: string;
  description: string;
  category: string;
  runtime: string;
  triggerType: string;
}

export interface DataEnginePipelineStep {
  id: string;
  functionId: string;
  name: string;
  description: string;
  status: "done" | "running" | "queued" | "error";
  params: Record<string, string>;
  order: number;
}

export interface DataEnginePipeline {
  id: string;
  name: string;
  description: string;
  status: "active" | "draft" | "paused";
  triggerPath: string;
  triggerType: string;
  steps: DataEnginePipelineStep[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const API_KEY = import.meta.env.VITE_API_KEY;

/**
 * Rewrite a presigned S3 URL through the nginx /s3-proxy/ reverse proxy
 * when it's cross-origin. This avoids CSP/CORS issues in the browser.
 */
export function proxyS3Url(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== window.location.origin) {
      return `/s3-proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
    }
  } catch { /* keep original */ }
  return url;
}

/* ── Access token — sessionStorage so it survives page refresh ── */

const TOKEN_KEY = "ah_access_token";

let _accessToken: string | null = (() => {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* private browsing */ }
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `request failed: ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  if (_accessToken) {
    return {
      ...headers,
      Authorization: `Bearer ${_accessToken}`,
    };
  }

  if (API_KEY) {
    return {
      ...headers,
      "x-api-key": API_KEY,
    };
  }

  return headers;
}

/* ── Auth API functions ── */

export interface AuthLoginResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  mustChangePassword?: boolean;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
    permissions?: string[];
  };
}

export interface AuthMeResult {
  id?: string;
  userId?: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export interface AuthRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export async function authLogin(email: string, password: string): Promise<AuthLoginResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Authentication failed");
  }

  return (await response.json()) as AuthLoginResult;
}

export async function authRefresh(refreshToken: string): Promise<AuthRefreshResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Token refresh failed");
  }

  return (await response.json()) as AuthRefreshResult;
}

export async function authRevoke(refreshToken: string): Promise<void> {
  // Best-effort: fire and forget. Callers should not block logout on this.
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...withAuth() },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Token revocation failed");
  }
}

export async function fetchAuthMe(): Promise<AuthMeResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: withAuth(),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to fetch user info");
  }

  return (await response.json()) as AuthMeResult;
}

/* ── API Key management ── */

export interface ApiKeyData {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreateResult {
  key: ApiKeyData;
  plaintext: string;
}

export async function fetchApiKeys(): Promise<ApiKeyData[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/api-keys`, {
    headers: withAuth(),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { keys: ApiKeyData[] };
  return body.keys;
}

export async function createApiKey(label: string, expiresInDays?: number): Promise<ApiKeyCreateResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/api-keys`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ label, expiresInDays }),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to create API key");
  }

  return (await response.json()) as ApiKeyCreateResult;
}

export async function revokeApiKey(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: withAuth(),
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to revoke API key");
  }
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
  signal?: { type: string; code: string; severity: string } | null;
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

export type WorkflowEventType =
  | "asset.processing.replay_requested"
  | "asset.review.qc_pending"
  | "asset.review.in_review"
  | "asset.review.approved"
  | "asset.review.rejected";

export async function fetchAssets(): Promise<AssetRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets`, { headers: withAuth() });
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { assets: AssetRow[] };
  return body.assets;
}

export async function fetchAsset(id: string): Promise<AssetRow | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${encodeURIComponent(id)}`, {
    headers: withAuth(),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { asset: AssetRow };
  return body.asset;
}

export async function fetchAssetAudit(id: string): Promise<AuditRow[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${encodeURIComponent(id)}/audit`, {
    headers: withAuth(),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { events: AuditRow[] };
  return body.events;
}

export interface IngestResult {
  asset: AssetRow;
  job: { id: string; assetId: string; status: string; sourceUri: string };
}

export async function ingestAsset(input: { title: string; sourceUri: string; projectId?: string; fileSizeBytes?: number }): Promise<IngestResult> {
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
  return (await response.json()) as IngestResult;
}

// ---------------------------------------------------------------------------
// Storage processing trigger — S3 copy-in-place to re-fire DataEngine
// element triggers. Used by the Storage Browser Process/Reprocess buttons.
// ---------------------------------------------------------------------------

export interface ProcessingTriggerResult {
  triggered: boolean;
  sourceUri: string;
  bucket: string;
  key: string;
  fileKind: string;
  method: string;
  message: string;
}

export async function requestProcessing(
  sourceUri: string,
  endpointId?: string,
): Promise<ProcessingTriggerResult> {
  const body: Record<string, string> = { sourceUri };
  if (endpointId) body.endpointId = endpointId;
  const response = await fetch(`${API_BASE_URL}/api/v1/storage/process`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new ApiRequestError(
      response.status,
      typeof err.message === "string" ? err.message : `Processing trigger failed: ${response.status}`,
    );
  }
  return (await response.json()) as ProcessingTriggerResult;
}

// ---------------------------------------------------------------------------
// Asset context menu actions
// ---------------------------------------------------------------------------

export type ContextMenuStatus = "qc_pending" | "approved" | "rejected" | "on_hold";

export async function updateAssetStatus(
  assetId: string,
  status: ContextMenuStatus,
  reason?: string,
): Promise<{ asset: AssetRow; previousStatus: string; newStatus: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/status`,
    {
      method: "PATCH",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ status, reason }),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiRequestError(
      response.status,
      typeof err.message === "string" ? err.message : `Status update failed: ${response.status}`,
    );
  }
  return (await response.json()) as { asset: AssetRow; previousStatus: string; newStatus: string };
}

export interface AssetNote {
  id: string;
  assetId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export async function fetchAssetNotes(assetId: string): Promise<AssetNote[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/notes`,
    { headers: withAuth() },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { notes: AssetNote[] };
  return body.notes;
}

export async function addAssetNote(assetId: string, noteBody: string): Promise<AssetNote> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/notes`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ body: noteBody }),
    },
  );
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to add note");
  }
  const result = (await response.json()) as { note: AssetNote };
  return result.note;
}

export interface ArchiveResult {
  archived: boolean;
  assetId: string;
  dependencies: Array<{ id: string; targetEntityId: string; type: string }>;
  message: string;
}

export async function archiveAsset(assetId: string, force = false): Promise<ArchiveResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/archive`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ force }),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiRequestError(
      response.status,
      typeof err.message === "string" ? err.message : `Archive failed: ${response.status}`,
    );
  }
  return (await response.json()) as ArchiveResult;
}

export interface UploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export async function generateUploadUrl(filename: string, contentType?: string, prefix?: string, endpointId?: string): Promise<UploadUrlResult> {
  const body: Record<string, string> = {
    filename,
    contentType: contentType ?? "application/octet-stream",
    prefix: prefix ?? "uploads",
  };
  if (endpointId) body.endpointId = endpointId;

  const response = await fetch(`${API_BASE_URL}/api/v1/assets/upload-url`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`upload URL generation failed: ${response.status}`);
  }
  return (await response.json()) as UploadUrlResult;
}

export async function replayJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}/replay`, {
    method: "POST",
    headers: withAuth()
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, `replay failed: ${response.status}`);
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
  const response = await fetch(`${API_BASE_URL}/api/v1/audit`, { headers: withAuth() });
  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as { events: AuditRow[] };
  return body.events;
}

export async function fetchMetrics(): Promise<MetricsSnapshot | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/metrics`, { headers: withAuth() });
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MetricsSnapshot;
}

export async function fetchIncidentCoordination(): Promise<IncidentCoordination | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/incident/coordination`, { headers: withAuth() });
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

export async function fetchApprovalQueue(
  sortField: SortField,
  sortDir: SortDirection,
  page: number,
  pageSize: number
): Promise<{ assets: AssetRow[]; total: number }> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assets/approval-queue?sort=${sortField}&dir=${sortDir}&page=${page}&limit=${pageSize}`,
      { headers: withAuth() },
    );
    if (!response.ok) {
      return { assets: [], total: 0 };
    }
    const body = (await response.json()) as { assets: AssetRow[] };
    return { assets: body.assets, total: body.assets.length };
  } catch {
    return { assets: [], total: 0 };
  }
}

// ---------------------------------------------------------------------------
// Dev-mode helpers (only call when NODE_ENV !== 'production')
// ---------------------------------------------------------------------------

export interface DevAdvanceResult {
  asset: AssetRow;
  job: { id: string; assetId: string; status: string; sourceUri: string };
}

/**
 * [DEV ONLY] Advance an asset directly to qc_pending, bypassing the media
 * worker and VAST DataEngine. The endpoint returns 403 in production.
 */
export async function devAdvanceAsset(assetId: string): Promise<DevAdvanceResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/dev-advance`,
    { method: "POST", headers: withAuth() }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`dev-advance failed (${response.status}): ${text}`);
  }
  return (await response.json()) as DevAdvanceResult;
}

export async function approveAsset(assetId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/approve`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ performed_by: "web-ui" })
  });

  if (!response.ok) {
    throw new Error(`approve failed: ${response.status}`);
  }
}

export async function rejectAsset(assetId: string, reason: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/reject`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ performed_by: "web-ui", reason })
  });

  if (!response.ok) {
    throw new Error(`reject failed: ${response.status}`);
  }
}

export async function requestReview(assetId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/request-review`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ performed_by: "web-ui" })
  });

  if (!response.ok) {
    throw new Error(`request-review failed: ${response.status}`);
  }
}

/* ── Rejected Feedback ── */

export async function fetchRejectedFeedback(assignee?: string): Promise<RejectedAssetRow[]> {
  try {
    const params = assignee ? `?assignee=${encodeURIComponent(assignee)}` : "";
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assets/rejected-feedback${params}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { assets: RejectedAssetRow[] };
    return body.assets;
  } catch {
    return [];
  }
}

export async function resubmitVersion(original: {
  title: string;
  sourceUri: string;
  shotId?: string;
  projectId?: string;
  versionLabel?: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/ingest`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(original),
  });
  if (!response.ok) {
    throw new Error(`resubmit failed: ${response.status}`);
  }
}

/* ── Hierarchy ── */

export async function fetchHierarchy(): Promise<HierarchyNode[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/hierarchy`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as HierarchyResponse;
    return body.projects;
  } catch {
    return [];
  }
}

export async function createProject(input: {
  name: string;
  code: string;
  type?: string;
  status?: string;
}): Promise<HierarchyNode> {
  const response = await fetch(`${API_BASE_URL}/api/v1/hierarchy/projects`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({
      name: input.name,
      code: input.code,
      type: input.type ?? "vfx_only",
      status: input.status ?? "active",
    }),
  });
  if (!response.ok) throw new Error(`createProject failed: ${response.status}`);
  const body = (await response.json()) as { project: HierarchyNode };
  return body.project;
}

export async function createSequence(input: {
  projectId: string;
  code: string;
  status?: string;
}): Promise<HierarchyNode> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/hierarchy/projects/${encodeURIComponent(input.projectId)}/sequences`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({
        code: input.code,
        status: input.status ?? "active",
      }),
    }
  );
  if (!response.ok) throw new Error(`createSequence failed: ${response.status}`);
  const body = (await response.json()) as { sequence: HierarchyNode };
  return body.sequence;
}

export async function createShot(input: {
  projectId: string;
  sequenceId: string;
  code: string;
  frameRangeStart?: number;
  frameRangeEnd?: number;
  status?: string;
}): Promise<HierarchyNode> {
  const start = input.frameRangeStart ?? 1001;
  const end = input.frameRangeEnd ?? 1100;
  const response = await fetch(
    `${API_BASE_URL}/api/v1/hierarchy/projects/${encodeURIComponent(input.projectId)}/sequences/${encodeURIComponent(input.sequenceId)}/shots`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({
        code: input.code,
        status: input.status ?? "active",
        frameRangeStart: start,
        frameRangeEnd: end,
        frameCount: end - start + 1,
      }),
    }
  );
  if (!response.ok) throw new Error(`createShot failed: ${response.status}`);
  const body = (await response.json()) as { shot: HierarchyNode };
  return body.shot;
}

/* ── Timelines ── */

export async function fetchTimelines(): Promise<TimelineData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/timelines`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { timelines: TimelineData[] };
    return body.timelines;
  } catch {
    return [];
  }
}

export async function fetchTimeline(id: string): Promise<TimelineData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/timelines/${encodeURIComponent(id)}`, {
      headers: withAuth(),
    });
    if (!response.ok) return null;
    return (await response.json()) as TimelineData;
  } catch {
    return null;
  }
}

/* ── Materials ── */

/* ── Review Comments ── */

export interface ReviewCommentData {
  id: string;
  sessionId: string | null;
  submissionId: string | null;
  versionId: string | null;
  parentCommentId: string | null;
  authorId: string;
  authorRole: string | null;
  body: string;
  frameNumber: number | null;
  timecode: string | null;
  annotationType: string | null;
  status: "open" | "resolved" | "archived";
  createdAt: string;
  updatedAt: string;
}

export async function createFrameComment(sessionId: string, payload: {
  authorId: string;
  body: string;
  submissionId?: string;
  versionId?: string;
  parentCommentId?: string;
  authorRole?: string;
  frameNumber?: number;
  timecode?: string;
  annotationType?: string;
}): Promise<ReviewCommentData> {
  const response = await fetch(`${API_BASE_URL}/api/v1/reviews/${encodeURIComponent(sessionId)}/comments`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiRequestError(response.status, `create comment failed: ${response.status}`);
  const body = (await response.json()) as { comment: ReviewCommentData };
  return body.comment;
}

export async function fetchFrameComments(sessionId: string): Promise<ReviewCommentData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/reviews/${encodeURIComponent(sessionId)}/comments`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { comments: ReviewCommentData[] };
    return body.comments;
  } catch {
    return [];
  }
}

export async function resolveFrameComment(commentId: string): Promise<ReviewCommentData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/comments/${encodeURIComponent(commentId)}/resolve`, {
      method: "PUT",
      headers: withAuth({ "content-type": "application/json" }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { comment: ReviewCommentData };
    return body.comment;
  } catch {
    return null;
  }
}

/* ── Collections ── */

export interface CollectionData {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  collectionType: "playlist" | "selection" | "deliverable";
  ownerId: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItemData {
  id: string;
  collectionId: string;
  entityType: "asset" | "version" | "shot" | "material";
  entityId: string;
  sortOrder: number;
  addedBy: string;
  addedAt: string;
  notes: string | null;
}

export async function fetchCollections(projectId: string): Promise<CollectionData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/projects/${encodeURIComponent(projectId)}/collections`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { collections: CollectionData[] };
    return body.collections;
  } catch {
    return [];
  }
}

export async function createCollection(projectId: string, payload: {
  name: string;
  collectionType: "playlist" | "selection" | "deliverable";
  ownerId: string;
  description?: string;
}): Promise<CollectionData> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/projects/${encodeURIComponent(projectId)}/collections`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new ApiRequestError(response.status, `create collection failed: ${response.status}`);
  const body = (await response.json()) as { collection: CollectionData };
  return body.collection;
}

export async function addCollectionItem(collectionId: string, payload: {
  entityType: "asset" | "version" | "shot" | "material";
  entityId: string;
  addedBy: string;
  sortOrder?: number;
  notes?: string;
}): Promise<CollectionItemData> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/collections/${encodeURIComponent(collectionId)}/items`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new ApiRequestError(response.status, `add item failed: ${response.status}`);
  const body = (await response.json()) as { item: CollectionItemData };
  return body.item;
}

export async function removeCollectionItem(collectionId: string, itemId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE", headers: withAuth() },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/* ── Playlists / Dailies ── */

export type PlaylistItemDecision = "approve" | "reject" | "hold";

export interface PlaylistData {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdBy: string;
  sessionDate: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemData {
  id: string;
  playlistId: string;
  shotId: string;
  versionId: string;
  sortOrder: number;
  notes: string | null;
  decision: PlaylistItemDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
  addedBy: string;
  addedAt: string;
}

export interface DailiesReportEntry {
  shotId: string;
  shotCode: string | null;
  versionId: string;
  versionLabel: string | null;
  decision: PlaylistItemDecision | null;
  decidedBy: string | null;
  notes: string | null;
  commentCount: number;
}

export async function fetchPlaylists(projectId: string): Promise<PlaylistData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/playlists?projectId=${encodeURIComponent(projectId)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { playlists: PlaylistData[] };
    return body.playlists;
  } catch {
    return [];
  }
}

export async function createPlaylist(projectId: string, payload: {
  name: string;
  createdBy: string;
  sessionDate: string;
  description?: string;
}): Promise<PlaylistData> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/playlists?projectId=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new ApiRequestError(response.status, `create playlist failed: ${response.status}`);
  const body = (await response.json()) as { playlist: PlaylistData };
  return body.playlist;
}

export async function fetchPlaylist(playlistId: string): Promise<{ playlist: PlaylistData; items: PlaylistItemData[] } | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/playlists/${encodeURIComponent(playlistId)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as { playlist: PlaylistData; items: PlaylistItemData[] };
  } catch {
    return null;
  }
}

export async function addPlaylistItem(playlistId: string, payload: {
  shotId: string;
  versionId: string;
  addedBy: string;
  sortOrder?: number;
  notes?: string;
}): Promise<PlaylistItemData> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/playlists/${encodeURIComponent(playlistId)}/items`,
    {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new ApiRequestError(response.status, `add playlist item failed: ${response.status}`);
  const body = (await response.json()) as { item: PlaylistItemData };
  return body.item;
}

export async function updatePlaylistItemDecision(
  playlistId: string,
  itemId: string,
  decision: PlaylistItemDecision,
  decidedBy: string,
): Promise<PlaylistItemData | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}/decision`,
      {
        method: "PUT",
        headers: withAuth({ "content-type": "application/json" }),
        body: JSON.stringify({ decision, decidedBy }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { item: PlaylistItemData };
    return body.item;
  } catch {
    return null;
  }
}

export async function fetchPlaylistReport(playlistId: string): Promise<DailiesReportEntry[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/playlists/${encodeURIComponent(playlistId)}/report`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { entries: DailiesReportEntry[] };
    return body.entries;
  } catch {
    return [];
  }
}

/* ── Asset Lineage ── */

export type LineageChangeType =
  | "new_frames"
  | "compression_change"
  | "color_space_change"
  | "full_re_render"
  | "alternate_take";

export type LineageEdgeType = "derives" | "depends";

export interface VersionNode {
  id: string;
  versionLabel: string;
  status: string;
  createdAt: string;
  createdBy: string;
  branchLabel?: string;
  colorSpace?: string;
  compressionType?: string;
  frameRangeStart?: number;
  frameRangeEnd?: number;
}

export interface VersionEdge {
  sourceId: string;
  targetId: string;
  changeType: LineageChangeType;
  edgeType: LineageEdgeType;
}

export interface LineageDAG {
  nodes: VersionNode[];
  edges: VersionEdge[];
}

export async function fetchAssetLineage(assetId: string): Promise<LineageDAG | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/assets/${encodeURIComponent(assetId)}/lineage`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as LineageDAG;
  } catch {
    return null;
  }
}

/* ── Dependency Intelligence ── */

export type DependencyType =
  | "uses_material"
  | "references_texture"
  | "in_shot"
  | "derived_from_plate"
  | "uses_simulation"
  | "conform_source";

export type DependencyStrength = "hard" | "soft" | "optional";

export type UsageType =
  | "comp_input"
  | "lighting_ref"
  | "plate"
  | "matchmove_data"
  | "fx_cache"
  | "roto_mask";

export interface AssetDependencyData {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  dependencyType: DependencyType;
  dependencyStrength: DependencyStrength;
  discoveredBy: string | null;
  discoveredAt: string;
}

export interface ShotAssetUsageData {
  id: string;
  shotId: string;
  versionId: string;
  usageType: UsageType;
  layerName: string | null;
  isActive: boolean;
  addedAt: string;
  removedAt: string | null;
}

export interface ImpactAnalysisData {
  versionId: string;
  reverseDependencies: AssetDependencyData[];
  shotUsage: ShotAssetUsageData[];
  affectedShotCount: number;
}

export async function fetchVersionDependencies(versionId: string): Promise<AssetDependencyData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/versions/${encodeURIComponent(versionId)}/dependencies`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { dependencies: AssetDependencyData[] };
    return body.dependencies;
  } catch {
    return [];
  }
}

export async function fetchMaterialDependencyGraph(materialId: string): Promise<AssetDependencyData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/materials/${encodeURIComponent(materialId)}/dependency-graph`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { materialId: string; dependencies: AssetDependencyData[] };
    return body.dependencies;
  } catch {
    return [];
  }
}

export async function fetchShotAssetUsage(shotId: string): Promise<ShotAssetUsageData[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/shots/${encodeURIComponent(shotId)}/asset-usage`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { shotId: string; usage: ShotAssetUsageData[] };
    return body.usage;
  } catch {
    return [];
  }
}

export async function fetchVersionImpactAnalysis(versionId: string): Promise<ImpactAnalysisData | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/versions/${encodeURIComponent(versionId)}/impact-analysis`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as ImpactAnalysisData;
  } catch {
    return null;
  }
}

/* ── Materials ── */

/* ── Capacity Planning ── */

export interface RenderCostBreakdown {
  group: string;
  coreHours: number;
  renderTimeSeconds: number;
  jobCount: number;
  frameCount: number;
}

export interface RenderCostReport {
  projectId: string;
  groupBy: "department" | "sequence" | "show";
  from: string | null;
  to: string | null;
  totalJobs: number;
  totalCoreHours: number;
  breakdown: RenderCostBreakdown[];
}

export interface CapacityForecast {
  projectId: string;
  currentStorageBytes: number;
  currentFileCount: number;
  totalCoreHours: number;
  avgRenderTimeSeconds: number;
  renderJobCount: number;
  measuredAt: string;
}

export interface StorageMetricSummary {
  id: string;
  entityType: string;
  entityId: string;
  totalBytes: number;
  fileCount: number;
  proxyBytes: number;
  thumbnailBytes: number;
  storageTier: string;
  measuredAt: string;
}

export interface RenderFarmMetric {
  id: string;
  projectId: string;
  shotId: string | null;
  versionId: string | null;
  renderEngine: string | null;
  renderTimeSeconds: number | null;
  coreHours: number | null;
  peakMemoryGb: number | null;
  frameCount: number | null;
  submittedAt: string | null;
  completedAt: string | null;
}

export async function fetchRenderCostReport(
  projectId: string,
  groupBy: "department" | "sequence" | "show" = "department",
  from?: string,
  to?: string,
): Promise<RenderCostReport | null> {
  try {
    const params = new URLSearchParams({ projectId, groupBy });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const response = await fetch(
      `${API_BASE_URL}/api/v1/reports/render-cost?${params.toString()}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { report: RenderCostReport };
    return body.report;
  } catch {
    return null;
  }
}

export async function fetchCapacityForecast(projectId: string): Promise<CapacityForecast | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/projects/${encodeURIComponent(projectId)}/capacity-forecast`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { forecast: CapacityForecast };
    return body.forecast;
  } catch {
    return null;
  }
}

export async function fetchStorageSummary(projectId: string): Promise<StorageMetricSummary[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/projects/${encodeURIComponent(projectId)}/storage-summary`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { metrics: StorageMetricSummary[] };
    return body.metrics;
  } catch {
    return [];
  }
}

export async function fetchShotRenderMetrics(shotId: string): Promise<RenderFarmMetric[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/shots/${encodeURIComponent(shotId)}/render-metrics`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { metrics: RenderFarmMetric[] };
    return body.metrics;
  } catch {
    return [];
  }
}

/* ── Materials ── */

export async function fetchMaterials(): Promise<MaterialData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/materials`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { materials: MaterialData[] };
    return body.materials;
  } catch {
    return [];
  }
}


/* ── Platform Settings ── */

export interface PlatformSettings {
  vastDatabase: {
    configured: boolean;
    endpoint: string | null;
    status: "connected" | "disconnected" | "error";
    tablesDeployed: boolean;
    /** Operational: VAST Management Server VIP address */
    vmsVip: string | null;
    /** Operational: comma-separated CNode data endpoint VIPs */
    cnodeVips: string | null;
    /** Operational: VAST S3/Trino access key ID (non-secret) */
    accessKeyId: string | null;
    /** True if secret access key is stored. Value is never returned. */
    hasSecretKey: boolean;
    /** S3 bucket with DATABASE protocol enabled (e.g. "sergio-db") */
    bucket: string | null;
    /** Schema name within the bucket (e.g. "spaceharbor") */
    schema: string | null;
  };
  vastEventBroker: {
    configured: boolean;
    brokerUrl: string | null;
    topic: string | null;
    status: "connected" | "disconnected" | "not_configured";
  };
  vastDataEngine: {
    configured: boolean;
    url: string | null;
    status: "connected" | "disconnected" | "not_configured";
    /** Operational: VAST tenant name used for DataEngine function calls */
    tenant: string | null;
    /** VMS username for DataEngine management API */
    username: string | null;
    /** True if VMS password is stored. Password value is never returned. */
    hasPassword: boolean;
  };
  authentication: {
    mode: "local" | "oidc";
    oidcIssuer: string | null;
    jwksUri: string | null;
    iamEnabled: boolean;
    shadowMode: boolean;
    rolloutRing: string;
  };
  storage: {
    s3Endpoint: string | null;
    s3Bucket: string | null;
    configured: boolean;
    endpoints: S3EndpointConfig[];
    nfsConnectors: NfsConnectorConfig[];
    smbConnectors: SmbConnectorConfig[];
  };
  scim: {
    configured: boolean;
    enabled: boolean;
  };
  ldap?: {
    configured: boolean;
    enabled: boolean;
    host?: string;
    port?: number;
    baseDn?: string;
    bindDn?: string;
    useTls?: boolean;
    userSearchFilter?: string;
    groupSearchBase?: string;
    groupSearchFilter?: string;
    syncIntervalMinutes?: number;
  };
}

export interface S3EndpointConfig {
  id: string;
  label: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  /**
   * Write-only. Never returned by GET /platform/settings.
   * On the frontend, treat an empty string as "unchanged" — the backend
   * will retain the previously stored value when this field is absent or empty.
   */
  secretAccessKey?: string;
  region: string;
  useSsl: boolean;
  pathStyle: boolean;
}

export interface NfsConnectorConfig {
  id: string;
  label: string;
  exportPath: string;
  mountPoint: string;
  version: "3" | "4" | "4.1";
  options: string;
}

export interface SmbConnectorConfig {
  id: string;
  label: string;
  sharePath: string;
  mountPoint: string;
  domain: string;
  username: string;
  password?: string; // write-only
}

export interface IamSettings {
  flags: {
    iamEnabled: boolean;
    shadowMode: boolean;
    enforceReadScope: boolean;
    enforceWriteScope: boolean;
    enforceApprovalSod: boolean;
    enableScimSync: boolean;
    rolloutRing: string;
  };
  overrides: Record<string, unknown>;
}

export interface RbacMatrix {
  roles: string[];
  permissions: string[];
  matrix: Record<string, string[]>;
}

export interface ConnectionTestResult {
  service: string;
  status: "ok" | "error";
  message: string;
}

export interface SchemaDeployResult {
  status: "ok" | "error";
  migrationsApplied: number;
  message: string;
}

export interface SchemaStatus {
  currentVersion: number;
  availableMigrations: number;
  upToDate: boolean;
  pending: { version: number; description: string }[];
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/settings`, {
    headers: withAuth(),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to fetch platform settings");
  }
  return (await response.json()) as PlatformSettings;
}

export async function savePlatformSettings(settings: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/settings`, {
    method: "PUT",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to save platform settings");
  }
  return (await response.json()) as PlatformSettings;
}

export async function testServiceConnection(service: string): Promise<ConnectionTestResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/settings/test-connection`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ service }),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Connection test failed");
  }
  return (await response.json()) as ConnectionTestResult;
}

export async function deploySchema(): Promise<SchemaDeployResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/settings/deploy-schema`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: "{}",
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Schema deployment failed");
  }
  return (await response.json()) as SchemaDeployResult;
}

export async function fetchSchemaStatus(): Promise<SchemaStatus> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/settings/schema-status`, {
    headers: withAuth(),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to fetch schema status");
  }
  return (await response.json()) as SchemaStatus;
}

/* ── IAM Settings ── */

export async function fetchIamSettings(): Promise<IamSettings> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/iam`, { headers: withAuth() });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to fetch IAM settings");
  return (await r.json()) as IamSettings;
}

export async function saveIamSettings(overrides: Record<string, unknown>): Promise<{ status: string; flags: IamSettings["flags"] }> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/iam`, {
    method: "PUT", headers: withAuth({ "content-type": "application/json" }), body: JSON.stringify(overrides),
  });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to save IAM settings");
  return (await r.json()) as { status: string; flags: IamSettings["flags"] };
}

/* ── RBAC Matrix ── */

export async function fetchRbacMatrix(): Promise<RbacMatrix> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/rbac-matrix`, { headers: withAuth() });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to fetch RBAC matrix");
  return (await r.json()) as RbacMatrix;
}

/* ── LDAP Settings ── */

export async function fetchLdapSettings(): Promise<Record<string, unknown>> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/ldap`, { headers: withAuth() });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to fetch LDAP settings");
  return (await r.json()) as Record<string, unknown>;
}

export async function saveLdapSettings(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/ldap`, {
    method: "PUT", headers: withAuth({ "content-type": "application/json" }), body: JSON.stringify(config),
  });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to save LDAP settings");
  return (await r.json()) as Record<string, unknown>;
}

export async function testLdapConnection(): Promise<{ status: string; message: string }> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/ldap/test`, {
    method: "POST", headers: withAuth({ "content-type": "application/json" }), body: "{}",
  });
  if (!r.ok) throw new ApiRequestError(r.status, "LDAP test failed");
  return (await r.json()) as { status: string; message: string };
}

/* ── SCIM Settings ── */

export async function fetchScimSettings(): Promise<Record<string, unknown>> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/scim`, { headers: withAuth() });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to fetch SCIM settings");
  return (await r.json()) as Record<string, unknown>;
}

export async function saveScimSettings(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/scim`, {
    method: "PUT", headers: withAuth({ "content-type": "application/json" }), body: JSON.stringify(config),
  });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to save SCIM settings");
  return (await r.json()) as Record<string, unknown>;
}

export async function generateScimToken(): Promise<{ token: string; message: string }> {
  const r = await fetch(`${API_BASE_URL}/api/v1/platform/settings/scim/generate-token`, {
    method: "POST", headers: withAuth({ "content-type": "application/json" }), body: "{}",
  });
  if (!r.ok) throw new ApiRequestError(r.status, "Failed to generate SCIM token");
  return (await r.json()) as { token: string; message: string };
}

/* -- VAST Catalog Integration (C.10) -- */

export interface UnregisteredFile {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  inferredMediaType: string;
  elementHandle: string;
}

export interface OrphanFile {
  path: string;
  sizeBytes: number;
  ahAssetId: string;
  ahVersionId: string | null;
  elementHandle: string;
  modifiedAt: string;
}

export interface CatalogStorageBreakdownEntry {
  mediaType: string;
  totalBytes: number;
  fileCount: number;
}

export interface CatalogStorageBreakdown {
  projectId: string;
  totalBytes: number;
  totalFileCount: number;
  byMediaType: CatalogStorageBreakdownEntry[];
}

export interface ResolvedElement {
  elementHandle: string;
  currentPath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export async function fetchCatalogUnregistered(pathPrefix: string = "/"): Promise<UnregisteredFile[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/catalog/unregistered?pathPrefix=${encodeURIComponent(pathPrefix)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { files: UnregisteredFile[] };
    return body.files;
  } catch {
    return [];
  }
}

export async function fetchCatalogOrphans(): Promise<OrphanFile[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/catalog/orphans`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { orphans: OrphanFile[] };
    return body.orphans;
  } catch {
    return [];
  }
}

export async function fetchCatalogStorageSummary(projectId: string): Promise<CatalogStorageBreakdown | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/catalog/storage-summary/${encodeURIComponent(projectId)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as CatalogStorageBreakdown;
  } catch {
    return null;
  }
}

export async function fetchCatalogResolveElement(elementHandle: string): Promise<ResolvedElement | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/catalog/resolve/${encodeURIComponent(elementHandle)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as ResolvedElement;
  } catch {
    return null;
  }
}

/* ── Version Detail (Asset Detail Panel) ── */

export interface VersionDetailInfo {
  version: {
    id: string;
    shotId: string;
    projectId: string;
    sequenceId: string;
    versionLabel: string;
    versionNumber: number;
    status: string;
    mediaType: string;
    codec: string | null;
    resolutionW: number | null;
    resolutionH: number | null;
    frameRate: number | null;
    frameRangeStart: number | null;
    frameRangeEnd: number | null;
    headHandle: number | null;
    tailHandle: number | null;
    compressionType: string | null;
    colorSpace: string | null;
    bitDepth: number | null;
    channelCount: number | null;
    fileSizeBytes: number | null;
    elementPath: string | null;
    vastPath: string | null;
    vastElementHandle: string | null;
    createdBy: string;
    createdAt: string;
    publishedAt: string | null;
    notes: string | null;
    reviewStatus: string;
  };
  provenance: Array<{
    id: string;
    versionId: string;
    creator: string | null;
    softwareUsed: string | null;
    softwareVersion: string | null;
    pipelineStage: string | null;
    createdAt: string;
  }>;
  protocols: Record<string, string | null>;
}

export interface VersionDetailHistoryEvent {
  eventType: string;
  actor: string | null;
  at: string;
  detail: string | null;
}

export interface VersionDetailResponse {
  info?: VersionDetailInfo | null;
  aovs?: null;
  vast?: null;
  history?: VersionDetailHistoryEvent[] | null;
}

export async function fetchVersionDetail(
  versionId: string,
  tabs: string[] = ["info"],
): Promise<VersionDetailResponse | null> {
  try {
    const tabsParam = tabs.join(",");
    const response = await fetch(
      `${API_BASE_URL}/api/v1/versions/${encodeURIComponent(versionId)}/detail?tabs=${encodeURIComponent(tabsParam)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as VersionDetailResponse;
  } catch {
    return null;
  }
}

/* ── Analytics types ── */

export interface AnalyticsAssetsData {
  totalAssets: number;
  byStatus: { status: string; count: number }[];
  byMediaType: { mediaType: string; count: number }[];
  topAccessed: { assetId: string; name: string; accessCount: number }[];
  range: string;
  cachedAt: string;
}

export interface AnalyticsPipelineData {
  completionRate: number;
  throughputPerHour: number;
  dlqSize: number;
  retrySuccessRate: number;
  jobsByStatus: { status: string; count: number }[];
  range: string;
  cachedAt: string;
}

export interface AnalyticsStorageData {
  totalBytes: number;
  byMediaType: { mediaType: string; bytes: number }[];
  proxyCoverage: number;
  thumbnailCoverage: number;
  growthTrend: number[];
  range: string;
  cachedAt: string;
}

export interface AnalyticsRenderData {
  totalCoreHours: number;
  avgRenderTimeSeconds: number;
  peakMemoryTrend: number[];
  jobsByEngine: { engine: string; count: number }[];
  range: string;
  cachedAt: string;
}

export async function fetchAnalyticsAssets(range: string = "7d"): Promise<AnalyticsAssetsData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/assets?range=${encodeURIComponent(range)}`, { headers: withAuth() });
    if (!response.ok) return null;
    return (await response.json()) as AnalyticsAssetsData;
  } catch { return null; }
}

export async function fetchAnalyticsPipeline(range: string = "7d"): Promise<AnalyticsPipelineData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/pipeline?range=${encodeURIComponent(range)}`, { headers: withAuth() });
    if (!response.ok) return null;
    return (await response.json()) as AnalyticsPipelineData;
  } catch { return null; }
}

export async function fetchAnalyticsStorage(range: string = "7d"): Promise<AnalyticsStorageData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/storage?range=${encodeURIComponent(range)}`, { headers: withAuth() });
    if (!response.ok) return null;
    return (await response.json()) as AnalyticsStorageData;
  } catch { return null; }
}

export async function fetchAnalyticsRender(range: string = "7d"): Promise<AnalyticsRenderData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/analytics/render?range=${encodeURIComponent(range)}`, { headers: withAuth() });
    if (!response.ok) return null;
    return (await response.json()) as AnalyticsRenderData;
  } catch { return null; }
}

/* ── Query Console types ── */

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  queryId: string;
}

export interface QueryHistoryEntry {
  id: string;
  userId: string;
  sqlText: string;
  sqlHash: string;
  rowCount: number | null;
  durationMs: number | null;
  status: "success" | "error" | "denied";
  errorMessage: string | null;
  createdAt: string;
}

export async function executeQuery(sql: string, signal?: AbortSignal): Promise<QueryResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/query/execute`, {
    method: "POST",
    headers: { ...withAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
    signal,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "Query failed" }));
    throw new ApiRequestError(response.status, err.message ?? `Query failed: ${response.status}`);
  }
  return (await response.json()) as QueryResult;
}

export async function fetchQueryHistory(): Promise<QueryHistoryEntry[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/query/history`, { headers: withAuth() });
    if (!response.ok) return [];
    const data = (await response.json()) as { history: QueryHistoryEntry[] };
    return data.history;
  } catch { return []; }
}

export async function cancelQuery(queryId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/v1/query/${encodeURIComponent(queryId)}`, {
    method: "DELETE",
    headers: withAuth(),
  });
}

/* ── Review Sessions ── */

export interface ReviewSessionData {
  id: string;
  name: string;
  projectId: string;
  createdBy: string;
  status: "active" | "completed" | "archived";
  itemCount: number;
  createdAt: string;
  completedAt: string | null;
}

export async function fetchReviewSessions(): Promise<ReviewSessionData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/review-sessions`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { sessions: ReviewSessionData[] };
    return body.sessions;
  } catch {
    return [];
  }
}

export async function createReviewSession(input: {
  projectId: string;
  sessionDate: string;
  sessionType: "dailies" | "client_review" | "final";
  department?: string;
  supervisorId?: string;
}): Promise<ReviewSessionData> {
  const response = await fetch(`${API_BASE_URL}/api/v1/review-sessions`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`createReviewSession failed: ${response.status}`);
  const body = (await response.json()) as { session: ReviewSessionData };
  return body.session;
}

export async function closeReviewSession(id: string): Promise<ReviewSessionData> {
  const response = await fetch(`${API_BASE_URL}/api/v1/review-sessions/${encodeURIComponent(id)}/close`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`closeReviewSession failed: ${response.status}`);
  const body = (await response.json()) as { session: ReviewSessionData };
  return body.session;
}

/* ── Pipeline Queue & DLQ ── */

export interface QueueItemData {
  id: string;
  jobId: string;
  assetId: string;
  assetTitle: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  priority: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface DlqItemData {
  id: string;
  jobId: string;
  assetId: string;
  assetTitle: string;
  stage: string;
  errorMessage: string;
  retryCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

export async function fetchQueueItems(): Promise<QueueItemData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/pending`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { jobs: QueueItemData[] };
    return body.jobs;
  } catch {
    return [];
  }
}

export async function fetchDlqItems(): Promise<DlqItemData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/dlq`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { items: DlqItemData[] };
    return body.items;
  } catch {
    return [];
  }
}

/* ── IAM Users ── */

export interface IamUserData {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  enabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export async function fetchIamUsers(): Promise<IamUserData[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
      headers: withAuth(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { users: IamUserData[] };
    return body.users;
  } catch {
    return [];
  }
}

export async function updateUserRole(userId: string, roles: string[]): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/roles`, {
    method: "PUT",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ roles }),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to update user roles");
  }
}

export async function updateUserStatus(
  userId: string,
  status: "active" | "disabled" | "locked",
): Promise<IamUserData> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/status`, {
    method: "PUT",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to update user status");
  }
  const body = (await response.json()) as IamUserData;
  return body;
}

export async function createIamUser(payload: {
  email: string;
  displayName: string;
  roles: string[];
  password?: string;
}): Promise<IamUserData> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "Failed to create user");
  }
  const body = (await response.json()) as { user: IamUserData };
  return body.user;
}

/* ── Audit Decisions ── */

export interface AuditDecisionRow {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  decision: "allow" | "deny" | "shadow_deny";
  reason: string | null;
  timestamp: string;
}

/* ── Work Queue & Assignments ── */

export type WorkTaskStatus = "pending" | "in_progress" | "blocked" | "done";

export interface WorkQueueItem {
  id: string;
  taskName: string;
  shotCode: string;
  sequenceName: string;
  status: WorkTaskStatus;
  priority: "low" | "normal" | "high" | "urgent";
  assignee: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkQueueResponse {
  tasks: WorkQueueItem[];
  total: number;
}

export async function fetchWorkQueue(
  projectId?: string,
  status?: WorkTaskStatus,
): Promise<WorkQueueItem[]> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (status) params.set("status", status);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/work/queue${qs ? `?${qs}` : ""}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as WorkQueueResponse;
    return body.tasks;
  } catch {
    return [];
  }
}

export interface WorkAssignment {
  id: string;
  entityType: "shot" | "version";
  entityId: string;
  label: string;
  shotCode: string;
  sequenceName: string;
  status: string;
  frameRange: { start: number; end: number } | null;
  assignee: string;
  updatedAt: string;
}

export interface WorkAssignmentsResponse {
  assignments: WorkAssignment[];
  total: number;
}

export async function fetchWorkAssignments(
  projectId?: string,
): Promise<WorkAssignment[]> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/work/assignments${qs ? `?${qs}` : ""}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as WorkAssignmentsResponse;
    return body.assignments;
  } catch {
    return [];
  }
}

/* ── Shot Board ── */

export type ShotStatus =
  | "not_started"
  | "in_progress"
  | "review"
  | "approved"
  | "final"
  | "on_hold";

export interface ShotBoardCard {
  id: string;
  code: string;
  sequenceName: string;
  status: ShotStatus;
  assignee: string | null;
  frameRange: { start: number; end: number } | null;
  latestVersionLabel: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  updatedAt: string;
}

export interface ShotBoardResponse {
  columns: { status: ShotStatus; shots: ShotBoardCard[] }[];
}

export async function fetchShotBoard(
  projectId?: string,
): Promise<ShotBoardResponse> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/shots/board${qs ? `?${qs}` : ""}`,
      { headers: withAuth() },
    );
    if (!response.ok) return { columns: [] };
    return (await response.json()) as ShotBoardResponse;
  } catch {
    return { columns: [] };
  }
}

/* ── Delivery Tracker ── */

export type DeliveryStatus =
  | "not_ready"
  | "in_progress"
  | "ready"
  | "delivered"
  | "rejected";

export interface DeliveryItem {
  id: string;
  shotCode: string;
  sequenceName: string;
  status: DeliveryStatus;
  deliverableType: string;
  targetDate: string | null;
  deliveredAt: string | null;
  assignee: string | null;
  notes: string | null;
}

export interface DeliveryStatusResponse {
  items: DeliveryItem[];
  total: number;
}

export async function fetchDeliveryStatus(
  projectId?: string,
): Promise<DeliveryItem[]> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/delivery/status${qs ? `?${qs}` : ""}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as DeliveryStatusResponse;
    return body.items;
  } catch {
    return [];
  }
}

export async function fetchAuditDecisions(filters?: {
  userId?: string;
  decision?: string;
  from?: string;
  to?: string;
}): Promise<AuditDecisionRow[]> {
  try {
    const params = new URLSearchParams();
    if (filters?.userId) params.set("actor", filters.userId);
    if (filters?.decision) params.set("permission", filters.decision);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/audit/auth-decisions${qs ? `?${qs}` : ""}`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { decisions: AuditDecisionRow[] };
    return body.decisions;
  } catch {
    return [];
  }
}

/* ── DataEngine API ── */

export async function fetchDataEngineFunctions(): Promise<DataEngineFunction[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/dataengine/functions`,
    { headers: withAuth() },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch DataEngine functions: ${response.status}`);
  }
  const body = (await response.json()) as { functions: DataEngineFunction[] } | DataEngineFunction[];
  return Array.isArray(body) ? body : body.functions;
}

export async function fetchDataEnginePipelines(): Promise<DataEnginePipeline[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/dataengine/pipelines`,
    { headers: withAuth() },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch DataEngine pipelines: ${response.status}`);
  }
  const body = (await response.json()) as { pipelines: DataEnginePipeline[] } | DataEnginePipeline[];
  return Array.isArray(body) ? body : body.pipelines;
}

export async function fetchDataEnginePipelineRuns(
  pipelineId: string,
): Promise<DataEnginePipelineStep[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/dataengine/pipelines/${encodeURIComponent(pipelineId)}/runs`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    return (await response.json()) as DataEnginePipelineStep[];
  } catch {
    return [];
  }
}

/* ── Storage Browse ── */

export interface StorageEndpoint {
  id: string;
  label: string;
  endpoint: string;
  bucket: string;
  region: string;
}

export interface StorageBrowseFile {
  key: string;
  sizeBytes: number;
  lastModified: string;
  inferredMediaType: string;
  sourceUri: string;
}

export interface StorageBrowseFolder {
  prefix: string;
}

export interface StorageBrowseResult {
  endpointId: string;
  bucket: string;
  prefix: string;
  files: StorageBrowseFile[];
  folders: StorageBrowseFolder[];
  truncated: boolean;
  continuationToken?: string;
}

export async function fetchStorageEndpoints(): Promise<StorageEndpoint[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/storage/endpoints`,
      { headers: withAuth() },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { endpoints: StorageEndpoint[] };
    return body.endpoints;
  } catch {
    return [];
  }
}

export async function fetchStorageBrowse(options: {
  endpointId?: string;
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<StorageBrowseResult | null> {
  try {
    const params = new URLSearchParams();
    if (options.endpointId) params.set("endpointId", options.endpointId);
    if (options.prefix) params.set("prefix", options.prefix);
    if (options.maxKeys) params.set("maxKeys", String(options.maxKeys));
    if (options.continuationToken) params.set("continuationToken", options.continuationToken);

    const response = await fetch(
      `${API_BASE_URL}/api/v1/storage/browse?${params.toString()}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    return (await response.json()) as StorageBrowseResult;
  } catch {
    return null;
  }
}

/* ── EXR Metadata ── */

export interface ExrFileMetadata {
  file_id: string;
  file_path: string;
  size_bytes: number;
  multipart_count: number;
  is_deep: boolean;
  frame_number: number | null;
  inspection_timestamp: string;
  inspection_count: number;
  [key: string]: unknown;
}

export interface ExrPartMetadata {
  part_index: number;
  width: number;
  height: number;
  compression: string;
  color_space: string;
  is_deep: boolean;
  pixel_aspect_ratio: number;
  display_width?: number;
  display_height?: number;
  data_x_offset?: number;
  data_y_offset?: number;
  display_window?: string;
  data_window?: string;
  line_order?: string;
  render_software?: string;
  is_tiled?: boolean;
  tile_width?: number;
  tile_height?: number;
  tile_depth?: string;
  multi_view?: boolean;
  [key: string]: unknown;
}

export interface ExrChannelMetadata {
  channel_name: string;
  layer_name: string;
  component_name: string;
  channel_type: string;
  part_index: number;
  [key: string]: unknown;
}

export interface ExrAttributeMetadata {
  file_id: string;
  part_index: number;
  attr_name: string;
  attr_type: string;
  value_text?: string | null;
  value_int?: number | null;
  value_float?: number | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Storage metadata lookup — reads the _metadata.json sidecar from S3 via the
// control-plane route. Schema-agnostic: the response envelope exposes the
// raw sidecar object under `data`, and the dynamic metadata renderer on the
// component side decides how to display each field.
//
// 404 (sidecar not yet written) and 415 (file kind has no extractor) are
// NOT exceptional — they return `null` so callers can render an empty state
// without try/catch boilerplate. 5xx and network errors throw ApiRequestError.
// ---------------------------------------------------------------------------

export type StorageSidecarFileKind = "image" | "video" | "raw_camera";

export interface StorageMetadataResponse {
  schema_version: string | number | null;
  file_kind: StorageSidecarFileKind;
  source_uri: string;
  sidecar_key: string;
  bucket: string;
  bytes: number;
  data: Record<string, unknown>;
}

export interface FetchStorageMetadataOptions {
  signal?: AbortSignal;
}

export async function fetchStorageMetadata(
  sourceUri: string,
  options: FetchStorageMetadataOptions = {},
): Promise<StorageMetadataResponse | null> {
  if (!sourceUri) return null;
  const url = `${API_BASE_URL}/api/v1/storage/metadata?sourceUri=${encodeURIComponent(sourceUri)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: withAuth(),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, `network error: ${String(err)}`);
  }
  if (response.status === 404 || response.status === 415 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status);
  }
  return (await response.json()) as StorageMetadataResponse;
}

// ---------------------------------------------------------------------------
// DataEngine pipelines — live discovery via /dataengine/pipelines/active.
// Authoritative source for "which DataEngine metadata function processes
// which file kind, which DB schema/table it writes to, and what sidecar
// schema id identifies its payload envelope".
//
// Shape mirrors the control-plane's DiscoveredPipeline interface. The
// web-ui treats `live` as optional enrichment — `config` is always
// present and is enough to render labels. When VAST is unreachable or
// the function name doesn't exist, the entry is still returned with a
// `status` flag and the UI degrades gracefully.
// ---------------------------------------------------------------------------

export type PipelineFileKind = "image" | "video" | "raw_camera";

export interface DataEnginePipelineConfig {
  fileKind: PipelineFileKind;
  functionName: string;
  extensions: string[];
  targetSchema: string;
  targetTable: string;
  sidecarSchemaId: string;
  displayLabel?: string;
}

export interface LiveFunctionRecord {
  guid: string;
  name: string;
  description: string;
  owner: { id?: string; name?: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  vrn: string | null;
  lastRevisionNumber: number | null;
}

export type DiscoveredPipelineStatus =
  | "ok"
  | "function-not-found"
  | "vast-unreachable"
  | "target-not-found"
  | "target-unreachable";

export interface DiscoveredPipeline {
  config: DataEnginePipelineConfig;
  live: LiveFunctionRecord | null;
  status: DiscoveredPipelineStatus;
  statusDetail?: string;
}

export interface DataEnginePipelinesResponse {
  pipelines: DiscoveredPipeline[];
}

export async function fetchActiveDataEnginePipelines(
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<DataEnginePipelinesResponse> {
  const query = options.force ? "?force=true" : "";
  const url = `${API_BASE_URL}/api/v1/dataengine/pipelines/active${query}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: withAuth(), signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, `network error: ${String(err)}`);
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status);
  }
  return (await response.json()) as DataEnginePipelinesResponse;
}

export interface DataEnginePipelineDefaultsResponse {
  pipelines: DataEnginePipelineConfig[];
}

export async function fetchMetadataPipelineDefaults(
  options: { signal?: AbortSignal } = {},
): Promise<DataEnginePipelineConfig[]> {
  const url = `${API_BASE_URL}/api/v1/dataengine/pipelines/defaults`;
  let response: Response;
  try {
    response = await fetch(url, { headers: withAuth(), signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, `network error: ${String(err)}`);
  }
  if (!response.ok) {
    let msg = `${response.status}`;
    try {
      const body = await response.json();
      msg = (body as { message?: string }).message ?? msg;
    } catch { /* fallthrough — keep status as the message */ }
    throw new ApiRequestError(response.status, msg);
  }
  const data = (await response.json()) as DataEnginePipelineDefaultsResponse;
  return data.pipelines;
}

export async function saveMetadataPipelines(
  pipelines: DataEnginePipelineConfig[],
): Promise<void> {
  const url = `${API_BASE_URL}/api/v1/platform/settings`;
  const response = await fetch(url, {
    method: "PUT",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ dataEnginePipelines: pipelines }),
  });
  if (!response.ok) {
    let msg = `${response.status}`;
    try {
      const body = await response.json();
      msg = (body as { message?: string }).message ?? msg;
    } catch { /* keep status */ }
    throw new ApiRequestError(response.status, msg);
  }
}

export interface MetadataLookupResult {
  rows: Record<string, unknown>[];
  count: number;
  matched_by?: string;
}

export async function testMetadataLookup(args: {
  path: string;
  schema: string;
  table: string;
  signal?: AbortSignal;
}): Promise<MetadataLookupResult> {
  const q = new URLSearchParams({ path: args.path, schema: args.schema, table: args.table }).toString();
  const url = `${API_BASE_URL}/api/v1/metadata/lookup?${q}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: withAuth(), signal: args.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, `network error: ${String(err)}`);
  }
  if (!response.ok) {
    let msg = `${response.status}`;
    try {
      const body = await response.json();
      msg = (body as { message?: string; detail?: string }).message
         ?? (body as { detail?: string }).detail
         ?? msg;
    } catch { /* keep status */ }
    throw new ApiRequestError(response.status, msg);
  }
  return (await response.json()) as MetadataLookupResult;
}

// ---------------------------------------------------------------------------
// S3 Presigned URL — for media preview in browser
// ---------------------------------------------------------------------------

export async function fetchPresignedUrl(sourceUri: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/storage/presign?sourceUri=${encodeURIComponent(sourceUri)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { url: string };
    return proxyS3Url(data.url);
  } catch {
    return null;
  }
}

export interface MediaUrls {
  source: string | null;
  thumbnail: string | null;
  preview: string | null;
  proxy: string | null;
}

/** Fetch presigned URLs for source, thumbnail, full-res preview, and proxy.
 *  URLs are automatically rewritten through the nginx S3 proxy for cross-origin access. */
export async function fetchMediaUrls(sourceUri: string): Promise<MediaUrls> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/storage/media-urls?sourceUri=${encodeURIComponent(sourceUri)}`,
      { headers: withAuth() },
    );
    if (!response.ok) return { source: null, thumbnail: null, preview: null, proxy: null };
    const raw = (await response.json()) as MediaUrls;
    return {
      source: proxyS3Url(raw.source),
      thumbnail: proxyS3Url(raw.thumbnail),
      preview: proxyS3Url(raw.preview),
      proxy: proxyS3Url(raw.proxy),
    };
  } catch {
    return { source: null, thumbnail: null, preview: null, proxy: null };
  }
}

// ---------------------------------------------------------------------------
// Storage processing status — per-object "is it processed?" state for the
// Storage Browser row-level status icon. Batched to avoid N HTTP calls.
//
// The backend endpoint (/storage/processing-status) branches on file kind
// so it HEAD-checks the right artifact naming convention per format family:
//   - image      → oiio: _thumb.jpg, _proxy.jpg, _preview.jpg  (underscore)
//   - video      → video-*: -proxy.mp4, -sprites.{jpg,vtt}     (hyphen)
//                  + _metadata.json sidecar                      (underscore)
//   - raw_camera → _metadata.json sidecar only (no proxy by design)
//   - other      → no processing expected
// See project_dataengine_function_coverage.md for the authoritative contract.
// ---------------------------------------------------------------------------

export type FileKind = "image" | "video" | "raw_camera" | "other";

export interface ProcessingStatusEntry {
  sourceUri: string;
  file_kind: FileKind;
  /** image only — oiio _thumb.jpg presence */
  thumb_ready: boolean;
  /** image only — _preview.jpg ?? _proxy.jpg presence */
  preview_ready: boolean;
  /** image: _proxy.jpg present / video: -proxy.mp4 present */
  proxy_ready: boolean;
  /** video only — both -sprites.jpg AND -sprites.vtt present */
  sprites_ready: boolean;
  /** image: atomic with thumb / video: _metadata.json / raw: _metadata.json */
  metadata_ready: boolean;
  in_flight_job_id: string | null;
  last_status: string | null;
  last_error: string | null;
}

/** Derive a coarse display state from the raw per-file-kind flags. */
export type ProcessingDisplayState =
  | "not_processed"     // no artifacts, no metadata, no in-flight job
  | "partial"           // some but not all expected artifacts present (transient error state)
  | "ready"             // all expected artifacts for this file kind are present
  | "processing"        // in-flight job (transient)
  | "metadata_only"     // raw camera (.r3d/.braw) with metadata — PERMANENT final state
  | "failed"            // last attempt failed
  | "not_applicable";   // file_kind === "other" (pipeline doesn't process this format)

/**
 * Collapse the raw backend flags into the display state machine.
 * CRITICAL: the semantics differ by file_kind. Don't treat a mid-flight MP4
 * as "metadata_only" — that state is reserved for formats that will never
 * have a proxy (raw camera), not for files currently being processed.
 */
export function deriveDisplayState(entry: ProcessingStatusEntry): ProcessingDisplayState {
  // Transient states apply regardless of file_kind
  if (entry.in_flight_job_id) return "processing";
  if (entry.last_status === "failed") return "failed";

  switch (entry.file_kind) {
    case "image": {
      // oiio writes _thumb.jpg + metadata atomically; presence of thumb is
      // the whole signal. _preview / _proxy are nice-to-haves that cascade
      // for the Frame.io viewer but don't change readiness.
      if (entry.thumb_ready) return "ready";
      return "not_processed";
    }

    case "video": {
      // Need all three artifacts: playable proxy, sprite track, metadata.
      const allReady = entry.proxy_ready && entry.sprites_ready && entry.metadata_ready;
      if (allReady) return "ready";
      const anyReady = entry.proxy_ready || entry.sprites_ready || entry.metadata_ready;
      if (anyReady) return "partial";
      return "not_processed";
    }

    case "raw_camera": {
      // R3D/BRAW: metadata IS the final state — no proxy will ever be
      // produced. Don't render this as "partial" (that implies retry).
      if (entry.metadata_ready) return "metadata_only";
      return "not_processed";
    }

    case "other":
    default:
      return "not_applicable";
  }
}

/** Batch-fetch processing status for up to 200 sourceUris at once. */
export async function fetchProcessingStatus(sourceUris: string[]): Promise<ProcessingStatusEntry[]> {
  if (sourceUris.length === 0) return [];
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/storage/processing-status`, {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ sourceUris }),
    });
    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.warn(
          `[fetchProcessingStatus] server returned ${response.status} ${response.statusText}; returning []`,
        );
      }
      return [];
    }
    const data = (await response.json()) as { results: ProcessingStatusEntry[] };
    return data.results ?? [];
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[fetchProcessingStatus] network error; returning []:`, err);
    }
    return [];
  }
}

// ============================================================================
// Admin APIs — custom fields, triggers, webhooks, workflows, dispatches,
// circuit breakers, atomic check-in.
// Every one of these endpoints has a matching admin page under /admin/*.
// ============================================================================

function apiUrl(path: string): string {
  return `${API_BASE_URL}/api/v1${path}`;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: withAuth({
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    }),
  });
  if (!response.ok) {
    let msg = `${response.status}`;
    try {
      const body = await response.json();
      msg = (body as { message?: string }).message ?? msg;
      throw new ApiRequestError(response.status, msg);
    } catch (err) {
      if (err instanceof ApiRequestError) throw err;
      throw new ApiRequestError(response.status, msg);
    }
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Custom Fields ── */

export type CustomFieldEntityType = "asset" | "version" | "shot" | "sequence" | "project" | "material";
export type CustomFieldDataType = "string" | "number" | "boolean" | "date" | "enum" | "ref";

export interface CustomFieldValidation {
  allowed_values?: string[];
  max_length?: number;
  min?: number;
  max?: number;
  ref_entity_type?: CustomFieldEntityType;
  pattern?: string;
}

export interface CustomFieldDefinition {
  id: string;
  entityType: CustomFieldEntityType;
  name: string;
  displayLabel: string;
  dataType: CustomFieldDataType;
  required: boolean;
  validation: CustomFieldValidation | null;
  displayConfig: Record<string, unknown> | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCustomFieldInput {
  entityType: CustomFieldEntityType;
  name: string;
  displayLabel: string;
  dataType: CustomFieldDataType;
  required?: boolean;
  validation?: CustomFieldValidation | null;
  displayConfig?: Record<string, unknown> | null;
  description?: string | null;
}

export async function listCustomFieldDefinitions(filter?: {
  entity?: CustomFieldEntityType;
  includeDeleted?: boolean;
}): Promise<CustomFieldDefinition[]> {
  const params = new URLSearchParams();
  if (filter?.entity) params.set("entity", filter.entity);
  if (filter?.includeDeleted) params.set("include_deleted", "true");
  const q = params.toString();
  const data = await apiFetch<{ definitions: CustomFieldDefinition[] }>(
    `/custom-fields/definitions${q ? `?${q}` : ""}`,
  );
  return data.definitions;
}

export async function createCustomFieldDefinition(
  input: CreateCustomFieldInput,
): Promise<CustomFieldDefinition> {
  const data = await apiFetch<{ definition: CustomFieldDefinition }>(
    `/custom-fields/definitions`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.definition;
}

export async function updateCustomFieldDefinition(
  id: string,
  input: Partial<Pick<CreateCustomFieldInput, "displayLabel" | "required" | "validation" | "displayConfig" | "description">>,
): Promise<CustomFieldDefinition> {
  const data = await apiFetch<{ definition: CustomFieldDefinition }>(
    `/custom-fields/definitions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data.definition;
}

export async function deleteCustomFieldDefinition(id: string): Promise<void> {
  await apiFetch<void>(`/custom-fields/definitions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string,
): Promise<{ fields: Record<string, unknown> }> {
  return apiFetch<{ fields: Record<string, unknown> }>(
    `/custom-fields/values/${entityType}/${encodeURIComponent(entityId)}`,
  );
}

export async function setCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string,
  fields: Record<string, unknown>,
): Promise<{ fields: Record<string, unknown> }> {
  return apiFetch<{ fields: Record<string, unknown> }>(
    `/custom-fields/values/${entityType}/${encodeURIComponent(entityId)}`,
    { method: "PUT", body: JSON.stringify({ fields }) },
  );
}

/* ── Triggers ── */

export type TriggerActionKind = "http_call" | "enqueue_job" | "run_workflow" | "run_script" | "post_event";

export interface Trigger {
  id: string;
  name: string;
  description: string | null;
  eventSelector: string;
  conditionJson: string | null;
  actionKind: TriggerActionKind;
  actionConfigJson: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
  fireCount: number;
}

export interface CreateTriggerInput {
  name: string;
  description?: string;
  eventSelector: string;
  conditionJson?: string;
  actionKind: TriggerActionKind;
  actionConfig: Record<string, unknown>;
  enabled?: boolean;
}

export async function listTriggers(filter?: {
  enabled?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<{ triggers: Trigger[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filter?.enabled !== undefined) params.set("enabled", String(filter.enabled));
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const q = params.toString();
  return apiFetch(`/triggers${q ? `?${q}` : ""}`);
}

export async function getTrigger(id: string): Promise<Trigger> {
  const d = await apiFetch<{ trigger: Trigger }>(`/triggers/${encodeURIComponent(id)}`);
  return d.trigger;
}

export async function createTrigger(input: CreateTriggerInput): Promise<Trigger> {
  const d = await apiFetch<{ trigger: Trigger }>(`/triggers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return d.trigger;
}

export async function updateTrigger(id: string, input: Partial<CreateTriggerInput>): Promise<Trigger> {
  const d = await apiFetch<{ trigger: Trigger }>(`/triggers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return d.trigger;
}

export async function deleteTrigger(id: string): Promise<void> {
  await apiFetch<void>(`/triggers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── Webhooks ── */

export type WebhookDirection = "inbound" | "outbound";
export type WebhookDeliveryStatus = "pending" | "in_flight" | "succeeded" | "failed" | "abandoned";

export interface WebhookEndpoint {
  id: string;
  name: string;
  direction: WebhookDirection;
  url: string | null;
  secretPrefix: string;
  signingAlgorithm: string;
  allowedEventTypes: string[] | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookSecret {
  plaintext: string;
  prefix: string;
  warning: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  triggerId: string | null;
  eventType: string;
  eventPayload: string | null;
  requestUrl: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  status: WebhookDeliveryStatus;
  attemptNumber: number;
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateWebhookEndpointInput {
  name: string;
  direction: WebhookDirection;
  url?: string;
  allowedEventTypes?: string[];
  description?: string;
}

export async function listWebhookEndpoints(filter?: {
  direction?: WebhookDirection;
  includeRevoked?: boolean;
}): Promise<WebhookEndpoint[]> {
  const params = new URLSearchParams();
  if (filter?.direction) params.set("direction", filter.direction);
  if (filter?.includeRevoked) params.set("include_revoked", "true");
  const q = params.toString();
  const d = await apiFetch<{ endpoints: WebhookEndpoint[] }>(`/webhook-endpoints${q ? `?${q}` : ""}`);
  return d.endpoints;
}

export async function createWebhookEndpoint(
  input: CreateWebhookEndpointInput,
): Promise<{ endpoint: WebhookEndpoint; secret: WebhookSecret }> {
  return apiFetch<{ endpoint: WebhookEndpoint; secret: WebhookSecret }>(`/webhook-endpoints`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeWebhookEndpoint(id: string): Promise<void> {
  await apiFetch<void>(`/webhook-endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listWebhookDeliveries(filter?: {
  webhookId?: string;
  status?: WebhookDeliveryStatus;
  cursor?: string;
  limit?: number;
}): Promise<{ deliveries: WebhookDelivery[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filter?.webhookId) params.set("webhookId", filter.webhookId);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const q = params.toString();
  return apiFetch(`/webhook-deliveries${q ? `?${q}` : ""}`);
}

/* ── Workflows ── */

export type WorkflowNodeKind = "start" | "end" | "approval" | "http" | "script" | "branch" | "wait_for_event" | "enqueue_job";
export type WorkflowInstanceState = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: Record<string, unknown>;
}

export interface WorkflowDsl {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string | null;
  dslJson: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionVersion: number;
  currentNodeId: string;
  state: WorkflowInstanceState;
  contextJson: string;
  startedBy: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  parentEntityType: string | null;
  parentEntityId: string | null;
}

export interface WorkflowTransition {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  eventType: string | null;
  actor: string | null;
  at: string;
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const d = await apiFetch<{ definitions: WorkflowDefinition[] }>(`/workflows`);
  return d.definitions;
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  dsl: WorkflowDsl;
  enabled?: boolean;
}): Promise<WorkflowDefinition> {
  const d = await apiFetch<{ definition: WorkflowDefinition }>(`/workflows`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return d.definition;
}

export async function updateWorkflow(id: string, input: { description?: string; dsl?: WorkflowDsl; enabled?: boolean }): Promise<WorkflowDefinition> {
  const d = await apiFetch<{ definition: WorkflowDefinition }>(`/workflows/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return d.definition;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await apiFetch<void>(`/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function startWorkflow(
  name: string,
  body: { context?: Record<string, unknown>; parentEntityType?: string; parentEntityId?: string } = {},
): Promise<WorkflowInstance> {
  const d = await apiFetch<{ instance: WorkflowInstance }>(`/workflows/${encodeURIComponent(name)}/start`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return d.instance;
}

export async function listWorkflowInstances(filter?: {
  definitionId?: string;
  state?: WorkflowInstanceState;
  parentEntityType?: string;
  parentEntityId?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ instances: WorkflowInstance[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filter?.definitionId) params.set("definitionId", filter.definitionId);
  if (filter?.state) params.set("state", filter.state);
  if (filter?.parentEntityType) params.set("parentEntityType", filter.parentEntityType);
  if (filter?.parentEntityId) params.set("parentEntityId", filter.parentEntityId);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const q = params.toString();
  return apiFetch(`/workflow-instances${q ? `?${q}` : ""}`);
}

export async function getWorkflowInstance(id: string): Promise<{ instance: WorkflowInstance; transitions: WorkflowTransition[] }> {
  return apiFetch(`/workflow-instances/${encodeURIComponent(id)}`);
}

export async function transitionWorkflowInstance(
  id: string,
  body: { nextNodeId?: string; eventType?: string; payload?: Record<string, unknown> } = {},
): Promise<WorkflowInstance> {
  const d = await apiFetch<{ instance: WorkflowInstance }>(`/workflow-instances/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return d.instance;
}

export async function cancelWorkflowInstance(id: string): Promise<WorkflowInstance> {
  const d = await apiFetch<{ instance: WorkflowInstance }>(`/workflow-instances/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  return d.instance;
}

/* ── Dispatches (DataEngine auto-trigger observability) ── */

export type DispatchStatus = "pending" | "completed" | "failed" | "abandoned";

export interface DataEngineDispatch {
  id: string;
  checkinId: string | null;
  versionId: string;
  fileRole: string;
  fileKind: string;
  sourceS3Bucket: string;
  sourceS3Key: string;
  expectedFunction: string;
  status: DispatchStatus;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  metadataTargetSchema: string | null;
  metadataTargetTable: string | null;
  metadataRowId: string | null;
  lastError: string | null;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  pollAttempts: number;
  lastPolledAt: string | null;
}

export async function listDispatches(filter?: {
  versionId?: string;
  checkinId?: string;
  status?: DispatchStatus;
  cursor?: string;
  limit?: number;
}): Promise<{ dispatches: DataEngineDispatch[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filter?.versionId) params.set("versionId", filter.versionId);
  if (filter?.checkinId) params.set("checkinId", filter.checkinId);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const q = params.toString();
  return apiFetch(`/dispatches${q ? `?${q}` : ""}`);
}

export async function listVersionDispatches(versionId: string): Promise<DataEngineDispatch[]> {
  const d = await apiFetch<{ dispatches: DataEngineDispatch[] }>(
    `/versions/${encodeURIComponent(versionId)}/dispatches`,
  );
  return d.dispatches;
}

export async function sweepDispatches(): Promise<{ polled: number; completed: number; abandoned: number }> {
  return apiFetch(`/admin/dispatches/sweep`, { method: "POST" });
}

/* ── Circuit Breakers ── */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  nextAttemptAt: string | null;
}

export async function listBreakers(): Promise<CircuitBreakerStats[]> {
  const d = await apiFetch<{ breakers: CircuitBreakerStats[] }>(`/admin/breakers`);
  return d.breakers;
}

export async function resetBreaker(name: string): Promise<void> {
  await apiFetch(`/admin/breakers/${encodeURIComponent(name)}/reset`, { method: "POST" });
}

/* ── Atomic check-in ── */

export type CheckinFileRole = "primary" | "sidecar" | "proxy" | "frame_range" | "audio" | "reference";

export interface CheckinFileSpec {
  filename: string;
  role?: CheckinFileRole;
  contentType?: string;
  fileSizeBytes: number;
  preferredPartSizeBytes?: number;
  frameRangeStart?: number;
  frameRangeEnd?: number;
  framePadding?: number;
}

export interface CheckinReservation {
  checkinId: string;
  versionId: string;
  versionNumber: number;
  context: string;
  deadline: string;
  files: Array<{
    role: CheckinFileRole;
    filename: string;
    s3: {
      bucket: string;
      key: string;
      uploadId: string;
      parts: Array<{ partNumber: number; presignedUrl: string; sizeBytes: number }>;
    };
  }>;
}

export interface CheckinCommitResult {
  checkinId: string;
  versionId: string;
  committedAt: string;
  sentinel: { name: string; versionId: string } | null;
  files: Array<{ id: string; role: string; filename: string; s3Key: string }>;
}

export async function reserveCheckin(input: {
  shotId: string;
  projectId: string;
  sequenceId: string;
  versionLabel: string;
  context?: string;
  notes?: string;
  endpointId?: string;
  files: CheckinFileSpec[];
}): Promise<CheckinReservation> {
  return apiFetch<CheckinReservation>(`/assets/checkin`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function commitCheckin(
  checkinId: string,
  body: { files: Array<{ role: string; filename?: string; parts: Array<{ partNumber: number; eTag: string }> }> },
): Promise<CheckinCommitResult> {
  return apiFetch<CheckinCommitResult>(`/assets/checkin/${encodeURIComponent(checkinId)}/commit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function abortCheckin(checkinId: string): Promise<void> {
  await apiFetch<void>(`/assets/checkin/${encodeURIComponent(checkinId)}/abort`, { method: "POST" });
}

export interface CheckinState {
  checkinId: string;
  versionId: string;
  state: "reserved" | "committed" | "compensating" | "aborted";
  s3: { bucket: string; key: string };
  files: Array<{ role: string; filename: string; s3Bucket: string; s3Key: string; partCount: number; fileSizeBytes: number }>;
  deadline: string;
  createdAt: string;
  committedAt: string | null;
  abortedAt: string | null;
  lastError: string | null;
}

export async function getCheckinState(checkinId: string): Promise<CheckinState> {
  return apiFetch<CheckinState>(`/assets/checkin/${encodeURIComponent(checkinId)}`);
}

/* ── Naming Templates (Phase 5.1) ── */

export type NamingTemplateScope =
  | "asset_filename"
  | "version_label"
  | "export_filename"
  | "shot_name";

export const NAMING_TEMPLATE_SCOPES: readonly NamingTemplateScope[] = [
  "asset_filename",
  "version_label",
  "export_filename",
  "shot_name",
];

export interface NamingTemplate {
  id: string;
  name: string;
  description: string | null;
  scope: NamingTemplateScope;
  template: string;
  sampleContext: Record<string, unknown> | null;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tokens: string[];
}

export interface CreateNamingTemplateInput {
  name: string;
  scope: NamingTemplateScope;
  template: string;
  description?: string | null;
  sampleContext?: Record<string, unknown> | null;
  enabled?: boolean;
}

export interface UpdateNamingTemplateInput {
  description?: string | null;
  template?: string;
  sampleContext?: Record<string, unknown> | null;
  enabled?: boolean;
}

export interface NamingTemplatePreview {
  rendered: string;
  tokens: string[];
  errors: Array<{ token: string; message: string }>;
  validation: { ok: boolean; errors: string[] };
}

export async function listNamingTemplates(filter?: {
  scope?: NamingTemplateScope;
  enabled?: boolean;
  includeDeleted?: boolean;
}): Promise<NamingTemplate[]> {
  const params = new URLSearchParams();
  if (filter?.scope) params.set("scope", filter.scope);
  if (filter?.enabled !== undefined) params.set("enabled", String(filter.enabled));
  if (filter?.includeDeleted) params.set("include_deleted", "true");
  const q = params.toString();
  const data = await apiFetch<{ templates: NamingTemplate[] }>(
    `/naming-templates${q ? `?${q}` : ""}`,
  );
  return data.templates;
}

export async function createNamingTemplate(
  input: CreateNamingTemplateInput,
): Promise<NamingTemplate> {
  const data = await apiFetch<{ template: NamingTemplate }>(
    `/naming-templates`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.template;
}

export async function updateNamingTemplate(
  id: string,
  input: UpdateNamingTemplateInput,
): Promise<NamingTemplate> {
  const data = await apiFetch<{ template: NamingTemplate }>(
    `/naming-templates/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data.template;
}

export async function deleteNamingTemplate(id: string): Promise<void> {
  await apiFetch<void>(`/naming-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function previewNamingTemplate(
  template: string,
  context: Record<string, unknown>,
): Promise<NamingTemplatePreview> {
  return apiFetch<NamingTemplatePreview>(`/naming-templates/preview`, {
    method: "POST",
    body: JSON.stringify({ template, context }),
  });
}

/* ── Plugins (Phase 5.3) ── */

export type PluginResourceType =
  | "namingTemplates"
  | "customFields"
  | "triggers"
  | "workflows"
  | "webhooks";

export const PLUGIN_RESOURCE_TYPES: readonly PluginResourceType[] = [
  "namingTemplates",
  "customFields",
  "triggers",
  "workflows",
  "webhooks",
];

export type PluginConflictStrategy = "skip" | "rename";

export interface PluginBundle {
  schemaVersion: 1;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  exportedAt: string;
  exportedFrom?: { system: string; version?: string };
  resources: Partial<Record<PluginResourceType, unknown[]>>;
}

export type PluginImportOutcome = "created" | "skipped" | "renamed" | "failed";

export interface PluginImportRecord {
  resourceType: PluginResourceType;
  key: string;
  outcome: PluginImportOutcome;
  finalName?: string;
  originalName?: string;
  message?: string;
  generatedSecret?: { name: string; secret: string; prefix: string };
}

export interface PluginImportReport {
  dryRun: boolean;
  strategy: PluginConflictStrategy;
  schemaVersion: number;
  bundleName: string;
  bundleVersion: string;
  totals: { created: number; skipped: number; renamed: number; failed: number };
  records: PluginImportRecord[];
}

export async function exportPlugin(opts: {
  include?: PluginResourceType[];
  name?: string;
  version?: string;
  description?: string;
  author?: string;
}): Promise<PluginBundle> {
  const params = new URLSearchParams();
  if (opts.include && opts.include.length > 0) params.set("include", opts.include.join(","));
  if (opts.name) params.set("name", opts.name);
  if (opts.version) params.set("version", opts.version);
  if (opts.description) params.set("description", opts.description);
  if (opts.author) params.set("author", opts.author);
  const q = params.toString();
  const data = await apiFetch<{ bundle: PluginBundle }>(`/plugins/export${q ? `?${q}` : ""}`);
  return data.bundle;
}

export async function previewPluginImport(
  bundle: PluginBundle,
  strategy: PluginConflictStrategy = "skip",
): Promise<PluginImportReport> {
  const data = await apiFetch<{ report: PluginImportReport }>(`/plugins/preview`, {
    method: "POST",
    body: JSON.stringify({ bundle, strategy }),
  });
  return data.report;
}

export async function importPlugin(
  bundle: PluginBundle,
  strategy: PluginConflictStrategy = "skip",
): Promise<PluginImportReport> {
  const data = await apiFetch<{ report: PluginImportReport }>(`/plugins/import`, {
    method: "POST",
    body: JSON.stringify({ bundle, strategy }),
  });
  return data.report;
}

/* ── Asset metadata (Phase 5.4 — unified DB + sidecar reader) ── */

export interface AssetMetadataPipeline {
  functionName: string;
  targetSchema: string;
  targetTable: string;
  sidecarSchemaId: string | null;
}

export interface AssetMetadataSources {
  db: "ok" | "empty" | "unreachable" | "disabled";
  sidecar: "ok" | "missing";
}

export interface AssetMetadataResponse {
  assetId: string;
  sourceUri: string;
  fileKind: string;
  pipeline: AssetMetadataPipeline | null;
  sources: AssetMetadataSources;
  dbRows: Record<string, unknown>[];
  sidecar: Record<string, unknown> | null;
  dbError?: string;
}

export async function fetchAssetMetadata(assetId: string): Promise<AssetMetadataResponse> {
  return apiFetch<AssetMetadataResponse>(`/assets/${encodeURIComponent(assetId)}/metadata`);
}

// ─────────────────────────────────────────────────────────────────────
// Phase 6.0 — asset stats + integrity + function configs
// ─────────────────────────────────────────────────────────────────────

export interface AssetStatsResponse {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  integrity: { hashed: number; with_keyframes: number };
}

export async function fetchAssetStats(): Promise<AssetStatsResponse> {
  const response = await fetch("/api/v1/assets/stats", { credentials: "include" });
  if (!response.ok) throw new ApiRequestError(response.status, `asset stats: ${response.status}`);
  return (await response.json()) as AssetStatsResponse;
}

export interface AssetIntegrityHashes {
  sha256: string;
  perceptual_hash: string | null;
  algorithm_version: string;
  bytes_hashed: number;
  hashed_at: string;
}
export interface AssetIntegrityKeyframes {
  keyframe_count: number;
  keyframe_prefix: string;
  thumbnail_key: string;
  extracted_at: string;
}
export interface AssetIntegrityResponse {
  assetId: string;
  sources: { hashes: "ok" | "empty"; keyframes: "ok" | "empty" };
  hashes: AssetIntegrityHashes | null;
  keyframes: AssetIntegrityKeyframes | null;
}

export async function fetchAssetIntegrity(assetId: string): Promise<AssetIntegrityResponse> {
  const response = await fetch(`/api/v1/assets/${encodeURIComponent(assetId)}/integrity`, { credentials: "include" });
  if (!response.ok) throw new ApiRequestError(response.status, `asset integrity: ${response.status}`);
  return (await response.json()) as AssetIntegrityResponse;
}

export type FunctionConfigValueType = "int" | "float" | "bool" | "string" | "duration_seconds";

export interface FunctionConfigDTO {
  scope: string;
  key: string;
  valueType: FunctionConfigValueType;
  value: unknown;
  default: unknown;
  min: number | null;
  max: number | null;
  description: string;
  label: string;
  category: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
}

export async function fetchFunctionConfigs(scope: string): Promise<FunctionConfigDTO[]> {
  const response = await fetch(`/api/v1/function-configs/${encodeURIComponent(scope)}`, { credentials: "include" });
  if (!response.ok) throw new ApiRequestError(response.status, `function-configs list: ${response.status}`);
  const body = (await response.json()) as { configs: FunctionConfigDTO[] };
  return body.configs;
}

export async function saveFunctionConfig(
  scope: string, key: string, value: unknown,
): Promise<FunctionConfigDTO> {
  const response = await fetch(
    `/api/v1/function-configs/${encodeURIComponent(scope)}/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!response.ok) {
    let msg = `function-configs save: ${response.status}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) msg = body.message;
    } catch { /* no-op */ }
    throw new ApiRequestError(response.status, msg);
  }
  const body = (await response.json()) as { config: FunctionConfigDTO };
  return body.config;
}
