/**
 * GET /api/v1/assets/:id/metadata — unified DB + sidecar reader.
 *
 * Queries the VAST DB table declared by the asset's pipeline config (via
 * vastdb-query sidecar) and the S3 `_metadata.json` sidecar in parallel,
 * returns a merged payload with per-source status. Schema/table come
 * from `dataEnginePipelines` platform setting — NO env-bound schema
 * coupling.
 *
 * Spec: docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md
 */

import type { FastifyInstance } from "fastify";

// ─────────────────────────────────────────────────────────────────────────
// Pure helper types — exported for unit testing.
// ─────────────────────────────────────────────────────────────────────────

export type DbSourceStatus = "ok" | "empty" | "unreachable" | "disabled";
export type SidecarSourceStatus = "ok" | "missing";

export interface DbResult_Rows { kind: "rows"; rows: Record<string, unknown>[] }
export interface DbResult_Error { kind: "error"; message: string }
export interface DbResult_Disabled { kind: "disabled"; reason: string }
export type DbResult = DbResult_Rows | DbResult_Error | DbResult_Disabled;

export interface SidecarResult_Hit { kind: "sidecar"; data: Record<string, unknown> }
export interface SidecarResult_Miss { kind: "missing" }
export type SidecarResult = SidecarResult_Hit | SidecarResult_Miss;

export interface SourcesStatus {
  db: DbSourceStatus;
  sidecar: SidecarSourceStatus;
  dbError?: string;
}

export function resolveSourcesStatus(
  db: DbResult,
  sidecar: SidecarResult,
): SourcesStatus {
  let dbStatus: DbSourceStatus;
  let dbError: string | undefined;
  switch (db.kind) {
    case "rows":     dbStatus = db.rows.length > 0 ? "ok" : "empty"; break;
    case "error":    dbStatus = "unreachable"; dbError = db.message; break;
    case "disabled": dbStatus = "disabled";    break;
  }
  const sidecarStatus: SidecarSourceStatus = sidecar.kind === "sidecar" ? "ok" : "missing";
  return { db: dbStatus, sidecar: sidecarStatus, dbError };
}

// The route handler is added in Task 4 — intentionally skeletal here so
// Task 3's tests can import the helper without touching Fastify.
export async function registerAssetMetadataRoute(
  _app: FastifyInstance,
  // Additional params added in Task 4.
): Promise<void> {
  // Registered in Task 4.
}
