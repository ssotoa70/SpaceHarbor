/**
 * Frontend TypeScript interfaces for VAST DataEngine objects.
 * Mirrors the control-plane types in services/control-plane/src/vast/dataengine-types.ts.
 */

// ── Functions ──

export interface VastFunction {
  guid: string;
  name: string;
  description: string;
  owner: string;
  created_at: string;
  modified_at: string;
  current_version: number;
  revision_count: number;
  tags: Record<string, string>;
  vrn: string;
}

export interface VastFunctionRevision {
  guid: string;
  function_guid: string;
  revision_number: number;
  alias: string;
  description: string;
  container_registry: string;
  artifact_source: string;
  image_tag: string;
  full_image_path: string;
  is_local: boolean;
  status: "draft" | "published";
  created_at: string;
}

// ── Triggers ──

export type TriggerType = "element" | "schedule";
export type ElementEventType =
  | "ElementCreated"
  | "ElementDeleted"
  | "ElementTagCreated"
  | "ElementTagDeleted";

export interface VastTrigger {
  guid: string;
  name: string;
  description: string;
  type: TriggerType;
  status: string;
  source_view?: string;
  event_type?: ElementEventType;
  source_type?: string;
  target_event_broker_view?: string;
  topic?: string;
  prefix_filter?: string;
  suffix_filter?: string;
  schedule_expression?: string;
  kafka_view?: string;
  custom_extensions: Record<string, string>;
  tags: Record<string, string>;
  created_at: string;
  vrn: string;
}

// ── Pipelines ──

export type PipelineStatus = "Draft" | "In progress" | "Running" | "Failure";

export interface PipelineManifestFunction {
  function_guid: string;
  function_vrn: string;
  config?: { concurrency?: number; timeout?: number };
  resources?: { cpu_min?: string; cpu_max?: string; memory_min?: string; memory_max?: string };
  environment_variables?: Record<string, string>;
  secret_keys?: Record<string, string>;
}

export interface PipelineManifest {
  triggers: Array<{ trigger_guid: string }>;
  functions: PipelineManifestFunction[];
}

export interface VastPipeline {
  id: number;
  name: string;
  description: string;
  status: PipelineStatus;
  kubernetes_cluster?: string;
  namespace?: string;
  environment_variables: Record<string, string>;
  tags: Record<string, string>;
  manifest: PipelineManifest | null;
  created_at: string;
  updated_at: string;
}

export interface VastPipelineRevision {
  id: number;
  pipeline_id: number;
  revision_number: number;
  manifest: PipelineManifest;
  status: string;
  created_at: string;
}

// ── Supporting ──

export interface VastContainerRegistry {
  guid: string;
  name: string;
  url: string;
  type: string;
}

export interface VastKubernetesCluster {
  guid: string;
  name: string;
  endpoint: string;
  status: string;
}

export interface VastTopic {
  name: string;
  partitions: number;
  replication_factor: number;
}

// ── Dashboard ──

export interface DashboardStats {
  functions_count: number;
  triggers_count: number;
  pipelines_count: number;
  active_pipelines: number;
}

export interface DashboardEventsStats {
  labels: string[];
  events: number[];
  failures: number[];
}

export interface DashboardExecutionTime {
  labels: string[];
  avg_duration_ms: number[];
}

// ── Telemetry ──

export interface TelemetryTrace {
  trace_id: string;
  pipeline: string;
  status: string;
  duration_ms: number;
  start_time: string;
}

export interface TraceSpan {
  span_id: string;
  parent_span_id: string | null;
  operation_name: string;
  service_name: string;
  status: string;
  duration_ms: number;
  started_at: string;
  attributes: Record<string, string>;
  children: TraceSpan[];
}

export interface TelemetryLog {
  timestamp: string;
  level: "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  scope: "user" | "vast-runtime";
  pipeline: string;
  message: string;
  trace_id?: string;
  span_id?: string;
}
