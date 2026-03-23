/**
 * Data Engine Pipeline — orchestrates function execution with schema
 * validation, audit recording, and error handling.
 */

import { FunctionRegistry } from "./registry.js";
import { validateJsonSchema, SchemaValidationError } from "./schema-validator.js";
import type { DataEngineFunctionSummary, ExecutionContext } from "./types.js";

export interface PipelineAuditSink {
  recordAudit(entry: {
    action: string;
    assetId: string;
    jobId: string;
    details: Record<string, unknown>;
    createdAt: string;
  }): Promise<void>;
}

export interface ExecutionResult {
  functionId: string;
  success: boolean;
  durationMs: number;
  output?: Record<string, unknown>;
  error?: string;
}

export class DataEnginePipeline {
  readonly registry: FunctionRegistry;

  constructor(registry?: FunctionRegistry) {
    this.registry = registry ?? new FunctionRegistry();
  }

  async execute(
    functionId: string,
    input: Record<string, unknown>,
    context: ExecutionContext,
    auditSink?: PipelineAuditSink,
  ): Promise<ExecutionResult> {
    const func = this.registry.get(functionId);
    if (!func) {
      throw new Error(`Function '${functionId}' not found in registry`);
    }

    // Validate input schema
    validateJsonSchema(input, func.inputSchema);

    const startMs = Date.now();
    try {
      const output = await func.execute(input);

      // Validate output schema
      validateJsonSchema(output, func.outputSchema);

      const durationMs = Date.now() - startMs;

      if (auditSink) {
        await auditSink.recordAudit({
          action: "data_engine_execute",
          assetId: context.assetId,
          jobId: context.jobId,
          details: { function_id: functionId, duration_ms: durationMs, success: true },
          createdAt: new Date().toISOString(),
        });
      }

      return { functionId, success: true, durationMs, output };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      if (auditSink) {
        await auditSink.recordAudit({
          action: "data_engine_execute",
          assetId: context.assetId,
          jobId: context.jobId,
          details: { function_id: functionId, duration_ms: durationMs, error: message },
          createdAt: new Date().toISOString(),
        });
      }

      // Re-throw schema validation errors as-is; wrap others
      if (err instanceof SchemaValidationError) {
        throw err;
      }
      return { functionId, success: false, durationMs, error: message };
    }
  }

  /**
   * Execute multiple functions in sequence (pipeline ordering).
   * Stops on first failure and returns all results collected so far.
   */
  async executeSequence(
    functionIds: string[],
    input: Record<string, unknown>,
    context: ExecutionContext,
    auditSink?: PipelineAuditSink,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    let currentInput = { ...input };

    for (const functionId of functionIds) {
      const result = await this.execute(functionId, currentInput, context, auditSink);
      results.push(result);

      if (!result.success) {
        break;
      }

      // Merge output into input for next function in chain
      if (result.output) {
        currentInput = { ...currentInput, ...result.output };
      }
    }

    return results;
  }

  listAvailable(): DataEngineFunctionSummary[] {
    return this.registry.list();
  }

  getSchema(functionId: string) {
    return this.registry.get(functionId);
  }
}
