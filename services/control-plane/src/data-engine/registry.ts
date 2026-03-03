/**
 * Function Registry — self-registration pattern for Data Engine functions.
 *
 * Functions register at startup. Duplicate IDs are rejected to prevent
 * silent shadowing. The registry is the single source of truth for
 * available functions and their schemas.
 */

import type { DataEngineFunction, DataEngineFunctionSummary } from "./types.js";

export class FunctionRegistry {
  private functions: Map<string, DataEngineFunction> = new Map();

  register(func: DataEngineFunction): void {
    if (this.functions.has(func.id)) {
      throw new Error(`Data Engine function '${func.id}' is already registered`);
    }
    this.functions.set(func.id, func);
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

  get size(): number {
    return this.functions.size;
  }
}
