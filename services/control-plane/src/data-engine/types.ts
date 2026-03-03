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
