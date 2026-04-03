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

/* ── In-memory access token (XSS-safe — never in localStorage) ── */

let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
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

export async function ingestAsset(input: { title: string; sourceUri: string; projectId?: string }): Promise<IngestResult> {
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

export interface UploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export async function generateUploadUrl(filename: string, contentType?: string, prefix?: string): Promise<UploadUrlResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/upload-url`, {
    method: "POST",
    headers: withAuth({ "content-type": "application/json" }),
    body: JSON.stringify({ filename, contentType: contentType ?? "application/octet-stream", prefix: prefix ?? "uploads" }),
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
