/**
 * function_configs typed store — caller-facing facade over the
 * function_configs table. 60s module-level cache per scope; read-after-
 * write consistency via synchronous cache invalidation inside setValue.
 *
 * Spec: docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md
 * Plan: docs/superpowers/plans/2026-04-19-phase-6.0-asset-integrity.md (Task A5)
 */

export type ValueType = "int" | "float" | "bool" | "string" | "duration_seconds";

export interface FunctionConfig {
  scope: string;
  key: string;
  value: unknown;
  valueType: ValueType;
  default: unknown;
  min?: number;
  max?: number;
  description: string;
  label: string;
  category: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
}

export interface DbRow {
  scope: string;
  key: string;
  value_type: ValueType;
  value_json: string;
  default_json: string;
  min_json: string | null;
  max_json: string | null;
  description: string;
  label: string;
  category: string;
  last_edited_by: string | null;
  last_edited_at: string | null;
}

export interface StoreDeps {
  queryScope: (scope: string) => Promise<DbRow[]>;
  upsertValue: (row: {
    scope: string;
    key: string;
    value_json: string;
    last_edited_by: string;
    last_edited_at: string;
  }) => Promise<void>;
}

export interface StoreOptions {
  cacheTtlMs?: number;
  clock?: { now: () => number };
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

export class NotFoundError extends Error {
  readonly code = "CONFIG_KEY_NOT_FOUND";
  constructor(scope: string, key: string) {
    super(`config key ${scope}/${key} not defined`); this.name = "NotFoundError";
  }
}

interface CacheEntry { data: FunctionConfig[]; expiresAt: number; }

export interface FunctionConfigsStore {
  getScope(scope: string): Promise<FunctionConfig[]>;
  getValue<T>(scope: string, key: string): Promise<T>;
  setValue(scope: string, key: string, value: unknown, actor: string): Promise<FunctionConfig>;
  resetToDefault(scope: string, key: string, actor: string): Promise<FunctionConfig>;
  invalidateScope(scope: string): void;
}

export function createFunctionConfigsStore(
  deps: StoreDeps,
  opts: StoreOptions = {},
): FunctionConfigsStore {
  const ttlMs = opts.cacheTtlMs ?? 60_000;
  const clock = opts.clock ?? { now: () => Date.now() };
  const cache = new Map<string, CacheEntry>();

  function decodeRow(r: DbRow): FunctionConfig {
    return {
      scope: r.scope,
      key: r.key,
      valueType: r.value_type,
      value: parseJsonForType(r.value_json, r.value_type),
      default: parseJsonForType(r.default_json, r.value_type),
      min: r.min_json !== null ? Number(r.min_json) : undefined,
      max: r.max_json !== null ? Number(r.max_json) : undefined,
      description: r.description,
      label: r.label,
      category: r.category,
      lastEditedBy: r.last_edited_by,
      lastEditedAt: r.last_edited_at,
    };
  }

  async function getScope(scope: string): Promise<FunctionConfig[]> {
    const now = clock.now();
    const cached = cache.get(scope);
    if (cached && cached.expiresAt > now) return cached.data;
    const rows = await deps.queryScope(scope);
    const data = rows.map(decodeRow);
    cache.set(scope, { data, expiresAt: now + ttlMs });
    return data;
  }

  async function getValue<T>(scope: string, key: string): Promise<T> {
    const rows = await getScope(scope);
    const row = rows.find((r) => r.key === key);
    if (!row) throw new NotFoundError(scope, key);
    return row.value as T;
  }

  function validate(row: FunctionConfig, value: unknown): string {
    validateType(row.valueType, value);
    if ((row.valueType === "int" || row.valueType === "float" || row.valueType === "duration_seconds")
        && typeof value === "number") {
      if (row.min !== undefined && value < row.min) {
        throw new ValidationError(`value must be >= ${row.min}`);
      }
      if (row.max !== undefined && value > row.max) {
        throw new ValidationError(`value must be <= ${row.max}`);
      }
    }
    return encodeValue(row.valueType, value);
  }

  async function setValue(scope: string, key: string, value: unknown, actor: string): Promise<FunctionConfig> {
    const rows = await getScope(scope);
    const row = rows.find((r) => r.key === key);
    if (!row) throw new NotFoundError(scope, key);
    const valueJson = validate(row, value);
    const now = new Date().toISOString();
    await deps.upsertValue({ scope, key, value_json: valueJson, last_edited_by: actor, last_edited_at: now });
    cache.delete(scope);
    const refreshed = await getScope(scope);
    return refreshed.find((r) => r.key === key)!;
  }

  async function resetToDefault(scope: string, key: string, actor: string): Promise<FunctionConfig> {
    const rows = await getScope(scope);
    const row = rows.find((r) => r.key === key);
    if (!row) throw new NotFoundError(scope, key);
    return setValue(scope, key, row.default, actor);
  }

  function invalidateScope(scope: string): void { cache.delete(scope); }

  return { getScope, getValue, setValue, resetToDefault, invalidateScope };
}

function validateType(t: ValueType, v: unknown): void {
  switch (t) {
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) throw new ValidationError("value must be integer");
      return;
    case "float":
    case "duration_seconds":
      if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError("value must be number");
      return;
    case "bool":
      if (typeof v !== "boolean") throw new ValidationError("value must be boolean");
      return;
    case "string":
      if (typeof v !== "string") throw new ValidationError("value must be string");
      return;
  }
}

function encodeValue(_t: ValueType, v: unknown): string {
  return JSON.stringify(v);
}

function parseJsonForType(raw: string, t: ValueType): unknown {
  const parsed = JSON.parse(raw) as unknown;
  validateType(t, parsed);
  return parsed;
}
