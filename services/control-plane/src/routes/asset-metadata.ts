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

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { inferFileKind } from "../storage/file-kinds.js";
import {
  parseSourceUri,
  InvalidSourceUriError,
} from "../storage/sidecar-resolver.js";
import { proxyToVastdbQuery } from "./exr-metadata.js";
import { getDataEnginePipelines } from "./platform-settings.js";
import {
  fetchSidecarForAsset,
  type SidecarFetchResult,
} from "./storage-metadata.js";

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

// ─────────────────────────────────────────────────────────────────────────
// Dependency injection interface — tests override via app.__assetMetadataDeps.
// ─────────────────────────────────────────────────────────────────────────

export interface AssetMetadataDeps {
  queryFetcher: (args: { path: string; schema: string; table: string })
    => Promise<{ ok: boolean; status: number; data: unknown }>;
  sidecarFetcher: (sourceUri: string) => Promise<SidecarFetchResult>;
}

function defaultQueryFetcher(args: { path: string; schema: string; table: string }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const q = new URLSearchParams({ path: args.path, schema: args.schema, table: args.table }).toString();
  return proxyToVastdbQuery(`/api/v1/metadata/lookup?${q}`);
}

const DEFAULT_DEPS: AssetMetadataDeps = {
  queryFetcher: defaultQueryFetcher,
  sidecarFetcher: fetchSidecarForAsset,
};

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function tryParseS3Uri(uri: string): { bucket: string; key: string } | null {
  try {
    const parsed = parseSourceUri(uri);
    if (parsed.bucket === null) return null; // bare-key form — not an s3:// URI
    return { bucket: parsed.bucket, key: parsed.key };
  } catch (e) {
    if (e instanceof InvalidSourceUriError) return null;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────

export async function registerAssetMetadataRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opId = prefix === "/api/v1" ? "v1AssetMetadata" : "legacyAssetMetadata";

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/metadata"),
      {
        schema: {
          tags: ["assets"],
          operationId: opId,
          summary: "Unified DB + sidecar metadata reader for an asset",
          response: {
            200: { type: "object", additionalProperties: true },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        // Read deps at request time so tests can override after buildApp().
        const deps: AssetMetadataDeps =
          (app as unknown as { __assetMetadataDeps?: AssetMetadataDeps }).__assetMetadataDeps
          ?? DEFAULT_DEPS;

        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "ASSET_NOT_FOUND",
            `Asset not found: ${request.params.id}`);
        }

        const sourceUri = asset.sourceUri ?? "";
        const fileKind = inferFileKind(sourceUri);
        const s3 = tryParseS3Uri(sourceUri);

        const pipelines = getDataEnginePipelines();
        const pipeline = pipelines.find(
          (p) => p.fileKind === fileKind && p.enabled !== false,
        ) ?? null;

        // DB + sidecar fetches run in parallel. Both promise branches handle
        // their own errors internally so Promise.all never rejects.
        // Pass the full `s3://bucket/key` URI. Extractors store rows keyed
        // by bucket-prefixed paths (verified live on 10.143.2.102), and
        // vastdb-query's /metadata/lookup strips only the `s3://` scheme
        // so `s3://bucket/key` canonically matches `bucket/key` rows.
        const dbPromise: Promise<DbResult> = (pipeline && s3)
          ? deps.queryFetcher({
              path: sourceUri,
              schema: pipeline.targetSchema,
              table: pipeline.targetTable,
            })
              .then((q): DbResult => {
                if (q.ok) {
                  const rows = (q.data as { rows?: Record<string, unknown>[] }).rows ?? [];
                  return { kind: "rows", rows };
                }
                const msg = (q.data as { detail?: string })?.detail ?? `HTTP ${q.status}`;
                return { kind: "error", message: msg };
              })
              .catch((e): DbResult => ({
                kind: "error",
                message: e instanceof Error ? e.message : String(e),
              }))
          : Promise.resolve<DbResult>({
              kind: "disabled",
              reason: !pipeline ? `no pipeline for file kind '${fileKind}'` : "non-s3 sourceUri",
            });

        const sidecarPromise: Promise<SidecarResult> = deps.sidecarFetcher(sourceUri)
          .then((sc): SidecarResult =>
            sc.ok
              ? { kind: "sidecar", data: sc.data as unknown as Record<string, unknown> }
              : { kind: "missing" },
          );

        const [dbResult, sidecarResult] = await Promise.all([dbPromise, sidecarPromise]);

        const sources = resolveSourcesStatus(dbResult, sidecarResult);

        return reply.send({
          assetId: asset.id,
          sourceUri,
          fileKind,
          pipeline: pipeline
            ? {
                functionName: pipeline.functionName,
                targetSchema: pipeline.targetSchema,
                targetTable: pipeline.targetTable,
                sidecarSchemaId: pipeline.sidecarSchemaId ?? null,
              }
            : null,
          sources,
          dbRows: dbResult.kind === "rows" ? dbResult.rows : [],
          sidecar: sidecarResult.kind === "sidecar" ? sidecarResult.data : null,
          ...(sources.dbError ? { dbError: sources.dbError } : {}),
        });
      },
    );
  }
}
