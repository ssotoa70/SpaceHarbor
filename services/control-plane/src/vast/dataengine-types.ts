/**
 * TypeScript interfaces for VAST DataEngine REST API objects.
 *
 * These are derived from the VAST DataEngine Angular bundle and documentation.
 * Field names use snake_case to match the VAST API JSON format.
 *
 * NOTE: Some fields are estimated and may need adjustment after integration
 * testing against a live VAST cluster. Extra fields from the API are preserved
 * via the `[key: string]: unknown` escape hatch on select interfaces.
 */

// ── Functions ──────────────────────────────────────────────────────────────

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
  /** Preserve extra fields from the API. */
  [key: string]: unknown;
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
  [key: string]: unknown;
}

export interface CreateFunctionPayload {
  name: string;
  description?: string;
}

export interface CreateFunctionRevisionPayload {
  function_guid: string;
  alias?: string;
  description?: string;
  container_registry: string;
  artifact_source: string;
  image_tag: string;
  is_local?: boolean;
}

// ── Triggers ──────────────────────────────────────────────────────────────

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
  // Element trigger fields
  source_view?: string;
  event_type?: ElementEventType;
  source_type?: string; // "S3"
  target_event_broker_view?: string;
  topic?: string;
  prefix_filter?: string;
  suffix_filter?: string;
  // Schedule trigger fields
  schedule_expression?: string; // Quartz cron syntax
  kafka_view?: string;
  // Common
  custom_extensions: Record<string, string>;
  tags: Record<string, string>;
  created_at: string;
  vrn: string;
  [key: string]: unknown;
}

export interface CreateElementTriggerPayload {
  name: string;
  description?: string;
  type: "element";
  source_view: string;
  event_type: ElementEventType;
  target_event_broker_view: string;
  topic: string;
  prefix_filter?: string;
  suffix_filter?: string;
  custom_extensions?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface CreateScheduleTriggerPayload {
  name: string;
  description?: string;
  type: "schedule";
  kafka_view: string;
  topic: string;
  schedule_expression: string;
  custom_extensions?: Record<string, string>;
  tags?: Record<string, string>;
}

export type CreateTriggerPayload =
  | CreateElementTriggerPayload
  | CreateScheduleTriggerPayload;

// ── Pipelines ─────────────────────────────────────────────────────────────

export type PipelineStatus = "Draft" | "In progress" | "Running" | "Failure";

export interface PipelineManifestFunction {
  function_guid: string;
  function_vrn: string;
  config?: {
    concurrency?: number;
    timeout?: number;
  };
  resources?: {
    cpu_min?: string;
    cpu_max?: string;
    memory_min?: string;
    memory_max?: string;
  };
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
  [key: string]: unknown;
}

export interface VastPipelineRevision {
  id: number;
  pipeline_id: number;
  revision_number: number;
  manifest: PipelineManifest;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

export interface CreatePipelinePayload {
  name: string;
  description?: string;
  kubernetes_cluster?: string;
  namespace?: string;
  environment_variables?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface UpdatePipelinePayload {
  name?: string;
  description?: string;
  manifest?: PipelineManifest;
  environment_variables?: Record<string, string>;
  tags?: Record<string, string>;
}

// ── Supporting Resources ──────────────────────────────────────────────────

export interface VastContainerRegistry {
  guid: string;
  name: string;
  url: string;
  type: string;
  [key: string]: unknown;
}

export interface VastKubernetesCluster {
  guid: string;
  name: string;
  endpoint: string;
  status: string;
  [key: string]: unknown;
}

export interface VastTopic {
  name: string;
  partitions: number;
  replication_factor: number;
  [key: string]: unknown;
}

export interface CreateTopicPayload {
  name: string;
  partitions?: number;
  replication_factor?: number;
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  functions_count: number;
  triggers_count: number;
  pipelines_count: number;
  active_pipelines: number;
  [key: string]: unknown;
}

export interface DashboardEventsStats {
  labels: string[];
  events: number[];
  failures: number[];
  [key: string]: unknown;
}

export interface DashboardExecutionTime {
  labels: string[];
  avg_duration_ms: number[];
  [key: string]: unknown;
}

// ── Telemetry ─────────────────────────────────────────────────────────────

export type LogLevel =
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL";

export type LogScope = "user" | "vast-runtime";

export interface TelemetryTrace {
  trace_id: string;
  pipeline: string;
  status: string;
  duration_ms: number;
  start_time: string;
  [key: string]: unknown;
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
  level: LogLevel;
  scope: LogScope;
  pipeline: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}
