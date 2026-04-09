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

export function fetchDashboardStats(): Promise<DashboardStats> {
  return proxyGet("/dashboard/stats");
}

export function fetchDashboardEventsStats(): Promise<DashboardEventsStats> {
  return proxyGet("/dashboard/events-stats");
}

export function fetchDashboardExecutionTime(): Promise<DashboardExecutionTime> {
  return proxyGet("/dashboard/execution-time");
}

// ── Functions ──

export function fetchVastFunctions(): Promise<VastFunction[]> {
  return proxyGet("/functions");
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

export function fetchVastTriggers(): Promise<VastTrigger[]> {
  return proxyGet("/triggers");
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

export function fetchVastPipelines(): Promise<VastPipeline[]> {
  return proxyGet("/pipelines");
}

export function fetchVastPipeline(id: string | number): Promise<VastPipeline> {
  return proxyGet(`/pipelines/${encodeURIComponent(String(id))}`);
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

export function fetchTraces(
  query?: Record<string, string>,
): Promise<TelemetryTrace[]> {
  return proxyGet("/telemetries/traces", query);
}

export function fetchTraceTree(
  traceId: string,
): Promise<TraceSpan[]> {
  return proxyGet("/telemetries/trace-tree", { trace_id: traceId });
}

export function fetchLogs(
  query?: Record<string, string>,
): Promise<TelemetryLog[]> {
  return proxyGet("/telemetries/logs", query);
}

export function fetchSpanLogs(
  traceId: string,
  spanId: string,
): Promise<TelemetryLog[]> {
  return proxyGet("/telemetries/span-logs", { trace_id: traceId, span_id: spanId });
}
