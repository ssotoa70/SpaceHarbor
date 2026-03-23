/**
 * Function Registry — self-registration pattern for Data Engine functions.
 *
 * Functions register at startup. Duplicate IDs are rejected to prevent
 * silent shadowing. The registry is the single source of truth for
 * available functions and their schemas.
 */

import type { DataEngineFunction, DataEngineFunctionSummary, FunctionMetadata } from "./types.js";

export class FunctionRegistry {
  private functions: Map<string, DataEngineFunction> = new Map();
  private metadata: Map<string, FunctionMetadata> = new Map();

  register(func: DataEngineFunction): void {
    if (this.functions.has(func.id)) {
      throw new Error(`Data Engine function '${func.id}' is already registered`);
    }
    this.functions.set(func.id, func);
  }

  /**
   * Register catalogue-only metadata for a function that has no local
   * TypeScript execute() stub (e.g. Python functions run by VAST DataEngine).
   * Duplicate IDs are rejected to match the behaviour of register().
   */
  registerMetadata(meta: FunctionMetadata): void {
    if (this.metadata.has(meta.id)) {
      throw new Error(`Function metadata '${meta.id}' is already registered`);
    }
    this.metadata.set(meta.id, meta);
  }

  get(functionId: string): DataEngineFunction | undefined {
    return this.functions.get(functionId);
  }

  has(functionId: string): boolean {
    return this.functions.has(functionId);
  }

  list(): DataEngineFunctionSummary[] {
    return Array.from(this.functions.values()).map((f) => ({
      id: f.id,
      version: f.version,
      description: f.description,
      inputSchema: f.inputSchema,
      outputSchema: f.outputSchema,
    }));
  }

  /**
   * Return the full FunctionMetadata catalogue — merging entries from the
   * metadata store (catalogue-only) with entries derived from registered
   * executable functions.  Metadata-store entries take precedence when both
   * exist for the same id so that human-readable names/categories are used.
   */
  listFunctions(): FunctionMetadata[] {
    const result = new Map<string, FunctionMetadata>(this.metadata);

    // Fill in any executable functions that have no explicit metadata entry
    for (const func of this.functions.values()) {
      if (!result.has(func.id)) {
        result.set(func.id, {
          id: func.id,
          name: func.id,
          description: func.description,
          category: "Uncategorized",
          language: "TypeScript",
          trigger: "on:ingest",
          inputs: [],
          outputs: [],
          status: "active",
        });
      }
    }

    return Array.from(result.values());
  }

  getFunctionById(id: string): FunctionMetadata | undefined {
    return this.listFunctions().find((f) => f.id === id);
  }

  get size(): number {
    return this.functions.size;
  }
}
