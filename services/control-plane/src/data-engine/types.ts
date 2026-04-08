/**
 * Data Engine type definitions.
 *
 * Pluggable functions declare input/output schemas (JSON Schema subset)
 * and a single `execute` method. The pipeline validates schemas at the
 * boundary and records audit trails automatically.
 */

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string; enum?: unknown[]; items?: JsonSchema; example?: unknown[] }>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
}

export interface DataEngineFunction {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface DataEngineFunctionSummary {
  id: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface ExecutionContext {
  jobId: string;
  assetId: string;
}

/**
 * FunctionMetadata — catalogue entry for a DataEngine function.
 *
 * Decoupled from the execution-time DataEngineFunction interface so that
 * functions registered only as catalogue entries (no local execute() stub)
 * can still appear in the API. The registry merges both sets into one list.
 */
export interface FunctionMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  language: string;
  trigger: string;
  inputs: string[];
  outputs: string[];
  status: "active" | "inactive";
  config?: Record<string, string>;
  /** VAST Database schema owned by this function (e.g. "exr_metadata"). */
  dbSchema?: string;
  /** Query bridge endpoint for this function's data (e.g. "vastdb-query:8070"). */
  queryBridge?: string;
}
