/**
 * VAST Catalog API routes.
 *
 * Provides read-only endpoints that query the VAST Catalog for storage truth:
 * unregistered files, orphan detection, storage breakdown, and element handle
 * resolution. All queries delegate to CatalogService which talks to VAST Catalog
 * virtual tables via Trino.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { CatalogService } from "../integrations/vast-catalog.js";
import type { TrinoClient } from "../db/trino-client.js";

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

const unregisteredFileSchema = {
  type: "object",
  required: ["path", "sizeBytes", "modifiedAt", "inferredMediaType", "elementHandle"],
  properties: {
    path: { type: "string" },
    sizeBytes: { type: "number" },
    modifiedAt: { type: "string" },
    inferredMediaType: { type: "string" },
    elementHandle: { type: "string" },
  },
} as const;

const orphanFileSchema = {
  type: "object",
  required: ["path", "sizeBytes", "ahAssetId", "elementHandle", "modifiedAt"],
  properties: {
    path: { type: "string" },
    sizeBytes: { type: "number" },
    ahAssetId: { type: "string" },
    ahVersionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    elementHandle: { type: "string" },
    modifiedAt: { type: "string" },
  },
} as const;

const storageBreakdownEntrySchema = {
  type: "object",
  required: ["mediaType", "totalBytes", "fileCount"],
  properties: {
    mediaType: { type: "string" },
    totalBytes: { type: "number" },
    fileCount: { type: "number" },
  },
} as const;

const storageBreakdownResponseSchema = {
  type: "object",
  required: ["projectId", "totalBytes", "totalFileCount", "byMediaType"],
  properties: {
    projectId: { type: "string" },
    totalBytes: { type: "number" },
    totalFileCount: { type: "number" },
    byMediaType: { type: "array", items: storageBreakdownEntrySchema },
  },
} as const;

const resolvedElementSchema = {
  type: "object",
  required: ["elementHandle", "currentPath", "sizeBytes", "modifiedAt"],
  properties: {
    elementHandle: { type: "string" },
    currentPath: { type: "string" },
    sizeBytes: { type: "number" },
    modifiedAt: { type: "string" },
  },
} as const;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerCatalogRoutes(
  app: FastifyInstance,
  trino: TrinoClient | null,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    // --- GET /catalog/unregistered ---
    app.get<{ Querystring: { pathPrefix?: string } }>(
      withPrefix(prefix, "/catalog/unregistered"),
      {
        schema: {
          tags: ["catalog"],
          operationId: prefix === "/api/v1" ? "v1CatalogUnregistered" : "legacyCatalogUnregistered",
          summary: "Find files on VAST not registered in SpaceHarbor",
          querystring: {
            type: "object",
            properties: {
              pathPrefix: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              required: ["files"],
              properties: {
                files: { type: "array", items: unregisteredFileSchema },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "CATALOG_UNAVAILABLE", "VAST Catalog is not configured. Set VAST_DATABASE_URL.");
        }

        const pathPrefix = (request.query as { pathPrefix?: string }).pathPrefix ?? "/";
        const catalog = new CatalogService(trino);

        try {
          const files = await catalog.findUnregisteredAssets(pathPrefix);
          return reply.send({ files });
        } catch (err) {
          return sendError(request, reply, 503, "CATALOG_QUERY_FAILED", err instanceof Error ? err.message : "Catalog query failed");
        }
      },
    );

    // --- GET /catalog/orphans ---
    app.get(
      withPrefix(prefix, "/catalog/orphans"),
      {
        schema: {
          tags: ["catalog"],
          operationId: prefix === "/api/v1" ? "v1CatalogOrphans" : "legacyCatalogOrphans",
          summary: "Detect orphaned files tagged with SpaceHarbor IDs but missing from the DB",
          response: {
            200: {
              type: "object",
              required: ["orphans"],
              properties: {
                orphans: { type: "array", items: orphanFileSchema },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "CATALOG_UNAVAILABLE", "VAST Catalog is not configured. Set VAST_DATABASE_URL.");
        }

        const catalog = new CatalogService(trino);

        try {
          const orphans = await catalog.detectOrphans();
          return reply.send({ orphans });
        } catch (err) {
          return sendError(request, reply, 503, "CATALOG_QUERY_FAILED", err instanceof Error ? err.message : "Catalog query failed");
        }
      },
    );

    // --- GET /catalog/storage-summary/:projectId ---
    app.get<{ Params: { projectId: string } }>(
      withPrefix(prefix, "/catalog/storage-summary/:projectId"),
      {
        schema: {
          tags: ["catalog"],
          operationId: prefix === "/api/v1" ? "v1CatalogStorageSummary" : "legacyCatalogStorageSummary",
          summary: "Per-project storage breakdown by media type from VAST Catalog",
          params: {
            type: "object",
            required: ["projectId"],
            properties: {
              projectId: { type: "string" },
            },
          },
          response: {
            200: storageBreakdownResponseSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "CATALOG_UNAVAILABLE", "VAST Catalog is not configured. Set VAST_DATABASE_URL.");
        }

        const { projectId } = request.params as { projectId: string };
        const catalog = new CatalogService(trino);

        try {
          const breakdown = await catalog.getStorageBreakdown(projectId);
          return reply.send(breakdown);
        } catch (err) {
          return sendError(request, reply, 503, "CATALOG_QUERY_FAILED", err instanceof Error ? err.message : "Catalog query failed");
        }
      },
    );

    // --- GET /catalog/resolve/:elementHandle ---
    app.get<{ Params: { elementHandle: string } }>(
      withPrefix(prefix, "/catalog/resolve/:elementHandle"),
      {
        schema: {
          tags: ["catalog"],
          operationId: prefix === "/api/v1" ? "v1CatalogResolve" : "legacyCatalogResolve",
          summary: "Resolve a VAST element handle to its current storage path",
          params: {
            type: "object",
            required: ["elementHandle"],
            properties: {
              elementHandle: { type: "string" },
            },
          },
          response: {
            200: resolvedElementSchema,
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "CATALOG_UNAVAILABLE", "VAST Catalog is not configured. Set VAST_DATABASE_URL.");
        }

        const { elementHandle } = request.params as { elementHandle: string };
        const catalog = new CatalogService(trino);

        try {
          const resolved = await catalog.resolveElementHandle(elementHandle);
          if (!resolved) {
            return sendError(request, reply, 404, "NOT_FOUND", `Element handle not found: ${elementHandle}`);
          }
          return reply.send(resolved);
        } catch (err) {
          return sendError(request, reply, 503, "CATALOG_QUERY_FAILED", err instanceof Error ? err.message : "Catalog query failed");
        }
      },
    );
  }
}
