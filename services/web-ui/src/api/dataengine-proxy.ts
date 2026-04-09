/**
 * API client for the VAST DataEngine proxy endpoints.
 *
 * All requests go through the SpaceHarbor control-plane proxy at
 * /api/v1/dataengine-proxy/*, which forwards to the real VAST DataEngine API.
 */

import type {
  VastFunction,
  VastFunctionRevision,
  VastTrigger,
  TriggerType,
  ElementEventType,
  VastPipeline,
  VastPipelineRevision,
  VastContainerRegistry,
  VastKubernetesCluster,
  VastTopic,
  DashboardStats,
  DashboardEventsStats,
  DashboardExecutionTime,
  TelemetryTrace,
  TraceSpan,
  TelemetryLog,
} from "../types/dataengine";
import { getAccessToken } from "../api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const PROXY_PREFIX = `${API_BASE_URL}/api/v1/dataengine-proxy`;

/** Build auth headers from the current in-memory access token. */
function _getAuth(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** @deprecated kept for backwards compat; tokens are now read directly via getAccessToken() */
export function setAuthProvider(_fn: () => Record<string, string>): void {
  /* no-op */
}

async function proxyGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${PROXY_PREFIX}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const response = await fetch(url.toString(), { headers: _getAuth() });
  if (!response.ok) {
    throw new Error(`DataEngine proxy error: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function proxyMutate<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${PROXY_PREFIX}${path}`, {
    method,
    headers: {
      ..._getAuth(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `DataEngine proxy error: ${response.status}`);
  }
  // DELETE may return empty body
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return undefined as unknown as T;
}

// ── Dashboard ──

// ── VMS raw response shapes ──
// VMS returns nested objects with `total`/`running`/etc. and interval arrays;
// the UI wants a flat, chart-friendly shape. Normalize here so components
// stay VMS-agnostic.

interface VmsStatsRaw {
  pipelines?: { total?: number; running?: number; failed?: number; in_progress?: number };
  functions?: { total?: number };
  triggers?: { total?: number };
}

interface VmsIntervalRaw {
  timestamp: string;
  total?: number;
  failed?: number;
  average_time?: number;
}

interface VmsIntervalsResponse {
  intervals?: VmsIntervalRaw[];
}

/** Format an ISO timestamp as HH:MM for chart axis labels. */
function formatHhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const raw = await proxyGet<VmsStatsRaw>("/dashboard/stats");
  return {
    functions_count: raw.functions?.total ?? 0,
    triggers_count: raw.triggers?.total ?? 0,
    pipelines_count: raw.pipelines?.total ?? 0,
    active_pipelines: raw.pipelines?.running ?? 0,
  };
}

export async function fetchDashboardEventsStats(): Promise<DashboardEventsStats> {
  const raw = await proxyGet<VmsIntervalsResponse>("/dashboard/events-stats");
  const intervals = raw.intervals ?? [];
  return {
    labels: intervals.map((i) => formatHhmm(i.timestamp)),
    events: intervals.map((i) => i.total ?? 0),
    failures: intervals.map((i) => i.failed ?? 0),
  };
}

export async function fetchDashboardExecutionTime(): Promise<DashboardExecutionTime> {
  const raw = await proxyGet<VmsIntervalsResponse>("/dashboard/execution-time");
  const intervals = raw.intervals ?? [];
  return {
    labels: intervals.map((i) => formatHhmm(i.timestamp)),
    avg_duration_ms: intervals.map((i) => i.average_time ?? 0),
  };
}

// ── VMS list envelope ──
// All list endpoints return { pagination, data: [...] } — components expect a
// bare array, so we always unwrap .data here. We also absorb the shape drift
// between VMS raw objects and the UI's typed shape via per-entity transforms.

interface VmsListEnvelope<T> {
  pagination?: { next_cursor?: string; previous_cursor?: string };
  data?: T[];
}

function unwrapList<T>(raw: VmsListEnvelope<T> | T[] | null | undefined): T[] {
  if (Array.isArray(raw)) return raw;
  return raw?.data ?? [];
}

// ── Function transform ──

interface VmsFunctionRaw {
  guid: string;
  name: string;
  description?: string | null;
  owner?: { id?: string; name?: string } | null;
  created_at?: string;
  updated_at?: string;
  last_revision_number?: number | null;
  default_revision_number?: number | null;
  tags?: Record<string, string> | null;
  vrn?: string;
}

function normalizeFunction(raw: VmsFunctionRaw): VastFunction {
  return {
    guid: raw.guid,
    name: raw.name,
    description: raw.description ?? "",
    owner: raw.owner?.name ?? "",
    created_at: raw.created_at ?? "",
    modified_at: raw.updated_at ?? raw.created_at ?? "",
    current_version: raw.default_revision_number ?? raw.last_revision_number ?? 0,
    revision_count: raw.last_revision_number ?? 0,
    tags: raw.tags ?? {},
    vrn: raw.vrn ?? "",
  };
}

// ── Trigger transform ──

interface VmsTriggerRaw {
  guid: string;
  name: string;
  description?: string | null;
  tags?: Record<string, string> | null;
  type?: string; // "Element" | "Schedule" | …
  events?: string[] | null;
  topic_name?: string | null;
  source_bucket_name?: string | null;
  config?: {
    tag_filters?: { prefixes?: string[]; suffixes?: string[] };
    name_filters?: { prefixes?: string[]; suffixes?: string[] };
    schedule_expression?: string;
  } | null;
  custom_extensions?: Record<string, string> | null;
  broker?: { type?: string; name?: string } | null;
  created_at?: string;
  vrn?: string;
  status?: string;
}

/** Map a VMS S3-style event to our friendlier element event type. */
function mapTriggerEvent(events: string[] | null | undefined): ElementEventType | undefined {
  const first = events?.[0] ?? "";
  if (first.startsWith("ObjectCreated")) return "ElementCreated";
  if (first.startsWith("ObjectRemoved") || first.startsWith("ObjectDeleted")) return "ElementDeleted";
  if (first.includes("TagCreated")) return "ElementTagCreated";
  if (first.includes("TagDeleted") || first.includes("TagRemoved")) return "ElementTagDeleted";
  return undefined;
}

function normalizeTrigger(raw: VmsTriggerRaw): VastTrigger {
  const rawType = (raw.type ?? "").toLowerCase();
  const type: TriggerType = rawType === "schedule" ? "schedule" : "element";
  return {
    guid: raw.guid,
    name: raw.name,
    description: raw.description ?? "",
    type,
    status: raw.status ?? "",
    source_view: raw.source_bucket_name ?? undefined,
    event_type: mapTriggerEvent(raw.events),
    source_type: raw.broker?.type ?? undefined,
    target_event_broker_view: raw.broker?.name ?? undefined,
    topic: raw.topic_name ?? undefined,
    prefix_filter: raw.config?.name_filters?.prefixes?.[0],
    suffix_filter: raw.config?.name_filters?.suffixes?.[0],
    schedule_expression: raw.config?.schedule_expression,
    kafka_view: undefined,
    custom_extensions: raw.custom_extensions ?? {},
    tags: raw.tags ?? {},
    created_at: raw.created_at ?? "",
    vrn: raw.vrn ?? "",
  };
}

// ── Pipeline transform ──

interface VmsPipelineRaw {
  guid: string;
  id?: number; // 64-bit; don't use — overflows JS Number
  name: string;
  description?: string | null;
  tags?: Record<string, string> | null;
  status?: string;
  reason?: string;
  kubernetes_cluster_vrn?: string;
  namespace?: string;
  created_at?: string;
  updated_at?: string;
  last_revision_number?: number | null;
  environment_variables?: Record<string, string> | null;
  manifest?: unknown;
}

/** Extract a human-readable cluster name from `vast:dataengine:kubernetes-clusters:<name>`. */
function clusterNameFromVrn(vrn: string | undefined): string | undefined {
  if (!vrn) return undefined;
  const colonIdx = vrn.lastIndexOf(":");
  return colonIdx >= 0 ? vrn.slice(colonIdx + 1) : vrn;
}

function normalizePipeline(raw: VmsPipelineRaw): VastPipeline {
  return {
    // Use GUID as the stable id — the numeric id overflows JS Number precision.
    id: raw.guid,
    name: raw.name,
    description: raw.description ?? "",
    status: raw.status ?? "Draft",
    kubernetes_cluster: clusterNameFromVrn(raw.kubernetes_cluster_vrn),
    namespace: raw.namespace,
    environment_variables: raw.environment_variables ?? {},
    tags: raw.tags ?? {},
    manifest: (raw.manifest as VastPipeline["manifest"]) ?? null,
    created_at: raw.created_at ?? "",
    updated_at: raw.updated_at ?? raw.created_at ?? "",
  };
}

// ── Telemetry transforms ──

interface VmsTraceRaw {
  trace_id: string;
  start_time?: number; // epoch microseconds
  end_time?: number;   // epoch microseconds
  status?: string;
  resource?: { pipeline_name?: string; pipeline_id?: string };
}

interface VmsLogRaw {
  guid?: string;
  trace_id?: string;
  span_id?: string;
  timestamp?: number; // epoch microseconds
  severity?: string;
  scope?: string;
  message?: string;
  resource?: { pipeline_name?: string };
}

/** Convert epoch microseconds to an ISO string (or empty if missing). */
function microsToIso(micros: number | undefined): string {
  if (typeof micros !== "number" || !Number.isFinite(micros)) return "";
  return new Date(micros / 1000).toISOString();
}

function normalizeTrace(raw: VmsTraceRaw): TelemetryTrace {
  const duration =
    typeof raw.end_time === "number" && typeof raw.start_time === "number"
      ? (raw.end_time - raw.start_time) / 1000 // μs → ms
      : 0;
  return {
    trace_id: raw.trace_id,
    pipeline: raw.resource?.pipeline_name ?? "",
    status: raw.status ?? "",
    duration_ms: duration,
    start_time: microsToIso(raw.start_time),
  };
}

function normalizeLog(raw: VmsLogRaw): TelemetryLog {
  const sev = (raw.severity ?? "INFO").toUpperCase();
  const level: TelemetryLog["level"] =
    sev === "TRACE" || sev === "DEBUG" || sev === "INFO" || sev === "WARN" || sev === "ERROR" || sev === "FATAL"
      ? (sev as TelemetryLog["level"])
      : "INFO";
  return {
    timestamp: microsToIso(raw.timestamp),
    level,
    scope: (raw.scope as TelemetryLog["scope"]) ?? "user",
    pipeline: raw.resource?.pipeline_name ?? "",
    message: raw.message ?? "",
    trace_id: raw.trace_id || undefined,
    span_id: raw.span_id || undefined,
  };
}

// ── Functions ──

export async function fetchVastFunctions(): Promise<VastFunction[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsFunctionRaw>>("/functions");
  return unwrapList(raw).map(normalizeFunction);
}

export function createVastFunction(payload: {
  name: string;
  description?: string;
}): Promise<VastFunction> {
  return proxyMutate("POST", "/functions", payload);
}

export function updateVastFunction(
  guid: string,
  payload: Partial<{ name: string; description: string }>,
): Promise<VastFunction> {
  return proxyMutate("PUT", `/functions/${encodeURIComponent(guid)}`, payload);
}

export function deleteVastFunction(guid: string): Promise<void> {
  return proxyMutate("DELETE", `/functions/${encodeURIComponent(guid)}`);
}

// ── Function Revisions ──

export function fetchFunctionRevisions(
  query?: { guid?: string },
): Promise<VastFunctionRevision[]> {
  return proxyGet("/function-revisions", query);
}

export function createFunctionRevision(payload: {
  function_guid: string;
  alias?: string;
  description?: string;
  container_registry: string;
  artifact_source: string;
  image_tag: string;
  is_local?: boolean;
}): Promise<VastFunctionRevision> {
  return proxyMutate("POST", "/function-revisions", payload);
}

export function publishFunctionRevision(guid: string): Promise<void> {
  return proxyMutate("POST", `/function-revisions/${encodeURIComponent(guid)}/publish`);
}

// ── Triggers ──

export async function fetchVastTriggers(): Promise<VastTrigger[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsTriggerRaw>>("/triggers");
  return unwrapList(raw).map(normalizeTrigger);
}

export function createVastTrigger(
  payload: Record<string, unknown>,
): Promise<VastTrigger> {
  return proxyMutate("POST", "/triggers", payload);
}

export function updateVastTrigger(
  guid: string,
  payload: Record<string, unknown>,
): Promise<VastTrigger> {
  return proxyMutate("PUT", `/triggers/${encodeURIComponent(guid)}`, payload);
}

export function deleteVastTrigger(guid: string): Promise<void> {
  return proxyMutate("DELETE", `/triggers/${encodeURIComponent(guid)}`);
}

// ── Pipelines ──

export async function fetchVastPipelines(): Promise<VastPipeline[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsPipelineRaw>>("/pipelines");
  return unwrapList(raw).map(normalizePipeline);
}

export async function fetchVastPipeline(id: string | number): Promise<VastPipeline> {
  const raw = await proxyGet<VmsPipelineRaw>(`/pipelines/${encodeURIComponent(String(id))}`);
  return normalizePipeline(raw);
}

export function createVastPipeline(payload: {
  name: string;
  description?: string;
  kubernetes_cluster?: string;
  namespace?: string;
}): Promise<VastPipeline> {
  return proxyMutate("POST", "/pipelines", payload);
}

export function updateVastPipeline(
  id: string | number,
  payload: Record<string, unknown>,
): Promise<VastPipeline> {
  return proxyMutate("PUT", `/pipelines/${encodeURIComponent(String(id))}`, payload);
}

export function deleteVastPipeline(id: string | number): Promise<void> {
  return proxyMutate("DELETE", `/pipelines/${encodeURIComponent(String(id))}`);
}

export function deployVastPipeline(id: string | number): Promise<void> {
  return proxyMutate("POST", `/pipelines/${encodeURIComponent(String(id))}/deploy`);
}

// ── Pipeline Revisions ──

export function fetchPipelineRevisions(): Promise<VastPipelineRevision[]> {
  return proxyGet("/pipeline-revisions");
}

// ── Supporting Resources ──

export function fetchContainerRegistries(): Promise<VastContainerRegistry[]> {
  return proxyGet("/container-registries");
}

export function fetchKubernetesClusters(): Promise<VastKubernetesCluster[]> {
  return proxyGet("/kubernetes-clusters");
}

export function fetchTopics(): Promise<VastTopic[]> {
  return proxyGet("/topics");
}

export function createTopic(payload: {
  name: string;
  partitions?: number;
  replication_factor?: number;
}): Promise<VastTopic> {
  return proxyMutate("POST", "/topics", payload);
}

// ── Telemetry ──

export async function fetchTraces(
  query?: Record<string, string>,
): Promise<TelemetryTrace[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsTraceRaw>>("/telemetries/traces", query);
  return unwrapList(raw).map(normalizeTrace);
}

export async function fetchTraceTree(
  traceId: string,
): Promise<TraceSpan[]> {
  // Trace tree shape is uncertain without a real sample — VMS may return either
  // a bare array, a { data } envelope, or a nested tree. Defensively unwrap;
  // if the shape doesn't match, return an empty array so the component falls
  // back to its "no spans" state instead of crashing.
  const raw = await proxyGet<VmsListEnvelope<TraceSpan> | TraceSpan[]>(
    "/telemetries/trace-tree",
    { trace_id: traceId },
  );
  return unwrapList(raw as VmsListEnvelope<TraceSpan>);
}

export async function fetchLogs(
  query?: Record<string, string>,
): Promise<TelemetryLog[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsLogRaw>>("/telemetries/logs", query);
  return unwrapList(raw).map(normalizeLog);
}

export async function fetchSpanLogs(
  traceId: string,
  spanId: string,
): Promise<TelemetryLog[]> {
  const raw = await proxyGet<VmsListEnvelope<VmsLogRaw>>(
    "/telemetries/span-logs",
    { trace_id: traceId, span_id: spanId },
  );
  return unwrapList(raw).map(normalizeLog);
}
