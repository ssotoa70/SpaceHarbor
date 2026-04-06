/**
 * EXR metadata routes.
 *
 * Queries external VAST Database tables created by the exr-inspector
 * DataEngine function. Tables live in a configurable bucket/schema
 * (default: sergio-db/exr_metadata_2) and contain rich EXR file metadata:
 * parts, channels (AOVs), and header attributes.
 *
 * All queries are read-only and go through the existing TrinoClient.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { TrinoClient } from "../db/trino-client.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configurable via EXR_METADATA_SCHEMA env var. Format: "bucket/schema" */
function getExrSchema(): string {
  return process.env.EXR_METADATA_SCHEMA ?? "sergio-db/exr_metadata_2";
}

function table(name: string): string {
  return `vast."${getExrSchema()}".${name}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(value: string): string {
  return value.replace(/'/g, "''");
}

/** Convert Trino row arrays to objects using column names */
function rowsToObjects(columns: { name: string }[], data: unknown[][]): Record<string, unknown>[] {
  return data.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerExrMetadataRoutes(
  app: FastifyInstance,
  trino: TrinoClient | null,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {

    // --- GET /exr-metadata/files --- List EXR files with metadata
    app.get<{
      Querystring: {
        pathPrefix?: string;
        limit?: number;
        offset?: number;
      };
    }>(
      withPrefix(prefix, "/exr-metadata/files"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataFiles" : "legacyExrMetadataFiles",
          summary: "List EXR files with metadata from exr-inspector tables",
          querystring: {
            type: "object",
            properties: {
              pathPrefix: { type: "string", description: "Filter by file path prefix" },
              limit: { type: "number", minimum: 1, maximum: 500, default: 50 },
              offset: { type: "number", minimum: 0, default: 0 },
            },
          },
          response: {
            200: {
              type: "object",
              required: ["files", "total"],
              properties: {
                files: { type: "array", items: { type: "object", additionalProperties: true } },
                total: { type: "number" },
                schema: { type: "string" },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "TRINO_UNAVAILABLE",
            "Trino is not configured. Set VAST_DATABASE_URL to enable EXR metadata queries.");
        }

        const { pathPrefix, limit = 50, offset = 0 } = request.query;
        const whereClause = pathPrefix
          ? `WHERE file_path LIKE '${sanitize(pathPrefix)}%'`
          : "";

        try {
          // Get total count
          const countResult = await trino.query(
            `SELECT COUNT(*) AS cnt FROM ${table("files")} ${whereClause}`
          );
          const total = Number(countResult.data[0]?.[0] ?? 0);

          // Get files with pagination
          const result = await trino.query(`
            SELECT
              file_id,
              file_path,
              size_bytes,
              multipart_count,
              is_deep,
              frame_number,
              inspection_timestamp,
              inspection_count
            FROM ${table("files")}
            ${whereClause}
            ORDER BY file_path
            LIMIT ${limit}
            OFFSET ${offset}
          `);

          return reply.send({
            files: rowsToObjects(result.columns, result.data),
            total,
            schema: getExrSchema(),
          });
        } catch (err) {
          return sendError(request, reply, 503, "EXR_QUERY_FAILED",
            err instanceof Error ? err.message : "EXR metadata query failed");
        }
      },
    );

    // --- GET /exr-metadata/files/:fileId --- Get full detail for one EXR file
    app.get<{
      Params: { fileId: string };
    }>(
      withPrefix(prefix, "/exr-metadata/files/:fileId"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataFileDetail" : "legacyExrMetadataFileDetail",
          summary: "Get detailed EXR metadata: file info, parts, channels, and attributes",
          response: {
            200: {
              type: "object",
              required: ["file", "parts", "channels", "attributes"],
              properties: {
                file: { type: "object", additionalProperties: true },
                parts: { type: "array", items: { type: "object", additionalProperties: true } },
                channels: { type: "array", items: { type: "object", additionalProperties: true } },
                attributes: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "TRINO_UNAVAILABLE",
            "Trino is not configured.");
        }

        const { fileId } = request.params;
        const safeId = sanitize(fileId);

        try {
          // Fetch file, parts, channels, attributes in parallel
          const [fileResult, partsResult, channelsResult, attrsResult] = await Promise.all([
            trino.query(`
              SELECT * FROM ${table("files")}
              WHERE file_id = '${safeId}'
              LIMIT 1
            `),
            trino.query(`
              SELECT
                part_index, width, height,
                display_width, display_height,
                compression, color_space,
                render_software, is_tiled,
                tile_width, tile_height,
                part_name, view_name, is_deep,
                pixel_aspect_ratio, line_order
              FROM ${table("parts")}
              WHERE file_id = '${safeId}'
              ORDER BY part_index
            `),
            trino.query(`
              SELECT
                part_index, channel_name,
                layer_name, component_name,
                channel_type, x_sampling, y_sampling
              FROM ${table("channels")}
              WHERE file_id = '${safeId}'
              ORDER BY part_index, channel_name
            `),
            trino.query(`
              SELECT
                part_index, attr_name,
                attr_type, value_text,
                value_int, value_float
              FROM ${table("attributes")}
              WHERE file_id = '${safeId}'
              ORDER BY part_index, attr_name
            `),
          ]);

          if (fileResult.rowCount === 0) {
            return sendError(request, reply, 404, "NOT_FOUND",
              `EXR file not found: ${fileId}`);
          }

          return reply.send({
            file: rowsToObjects(fileResult.columns, fileResult.data)[0],
            parts: rowsToObjects(partsResult.columns, partsResult.data),
            channels: rowsToObjects(channelsResult.columns, channelsResult.data),
            attributes: rowsToObjects(attrsResult.columns, attrsResult.data),
          });
        } catch (err) {
          return sendError(request, reply, 503, "EXR_QUERY_FAILED",
            err instanceof Error ? err.message : "EXR metadata query failed");
        }
      },
    );

    // --- GET /exr-metadata/lookup --- Find EXR metadata by file path
    // This is the key endpoint for correlating SpaceHarbor assets (sourceUri)
    // with exr-inspector metadata.
    app.get<{
      Querystring: { path: string };
    }>(
      withPrefix(prefix, "/exr-metadata/lookup"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataLookup" : "legacyExrMetadataLookup",
          summary: "Look up EXR metadata by file path (correlate with SpaceHarbor assets)",
          querystring: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", description: "S3 key or file path to look up" },
            },
          },
          response: {
            200: {
              type: "object",
              required: ["found"],
              properties: {
                found: { type: "boolean" },
                file: { type: "object", additionalProperties: true },
                parts: { type: "array", items: { type: "object", additionalProperties: true } },
                channels: { type: "array", items: { type: "object", additionalProperties: true } },
                summary: {
                  type: "object",
                  properties: {
                    resolution: { type: "string" },
                    compression: { type: "string" },
                    colorSpace: { type: "string" },
                    channelCount: { type: "number" },
                    isDeep: { type: "boolean" },
                    frameNumber: { type: "number" },
                  },
                },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "TRINO_UNAVAILABLE",
            "Trino is not configured.");
        }

        const { path } = request.query;
        // Normalize: strip s3://bucket/ prefix to match exr-inspector's file_path
        const normalizedPath = path
          .replace(/^s3:\/\/[^/]+\//, "/")
          .replace(/^vast:\/\/[^/]+\//, "/");
        const safePath = sanitize(normalizedPath);
        // Also try the original path for exact matches
        const safeOriginal = sanitize(path);

        try {
          // Try both normalized and original path
          const fileResult = await trino.query(`
            SELECT * FROM ${table("files")}
            WHERE file_path = '${safePath}'
               OR file_path = '${safeOriginal}'
               OR file_path_normalized = '${safePath}'
            LIMIT 1
          `);

          if (fileResult.rowCount === 0) {
            return reply.send({ found: false });
          }

          const file = rowsToObjects(fileResult.columns, fileResult.data)[0];
          const fileId = String(file.file_id);

          // Fetch parts and channels for summary
          const [partsResult, channelsResult] = await Promise.all([
            trino.query(`
              SELECT part_index, width, height, compression, color_space,
                     is_deep, pixel_aspect_ratio
              FROM ${table("parts")}
              WHERE file_id = '${sanitize(fileId)}'
              ORDER BY part_index
            `),
            trino.query(`
              SELECT channel_name, layer_name, channel_type
              FROM ${table("channels")}
              WHERE file_id = '${sanitize(fileId)}'
              ORDER BY part_index, channel_name
            `),
          ]);

          const parts = rowsToObjects(partsResult.columns, partsResult.data);
          const channels = rowsToObjects(channelsResult.columns, channelsResult.data);

          // Build summary from first part
          const firstPart = parts[0] ?? {};
          const summary = {
            resolution: firstPart.width && firstPart.height
              ? `${firstPart.width}x${firstPart.height}`
              : "unknown",
            compression: String(firstPart.compression ?? "unknown"),
            colorSpace: String(firstPart.color_space ?? "unknown"),
            channelCount: channels.length,
            isDeep: Boolean(file.is_deep),
            frameNumber: file.frame_number != null ? Number(file.frame_number) : null,
          };

          return reply.send({ found: true, file, parts, channels, summary });
        } catch (err) {
          return sendError(request, reply, 503, "EXR_QUERY_FAILED",
            err instanceof Error ? err.message : "EXR metadata query failed");
        }
      },
    );

    // --- GET /exr-metadata/stats --- Summary statistics from exr-inspector tables
    app.get(
      withPrefix(prefix, "/exr-metadata/stats"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataStats" : "legacyExrMetadataStats",
          summary: "Get summary statistics from exr-inspector tables",
          response: {
            200: {
              type: "object",
              properties: {
                totalFiles: { type: "number" },
                totalParts: { type: "number" },
                totalChannels: { type: "number" },
                totalAttributes: { type: "number" },
                schema: { type: "string" },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!trino) {
          return sendError(request, reply, 503, "TRINO_UNAVAILABLE",
            "Trino is not configured.");
        }

        try {
          const result = await trino.query(`
            SELECT
              (SELECT COUNT(*) FROM ${table("files")}) AS total_files,
              (SELECT COUNT(*) FROM ${table("parts")}) AS total_parts,
              (SELECT COUNT(*) FROM ${table("channels")}) AS total_channels,
              (SELECT COUNT(*) FROM ${table("attributes")}) AS total_attributes
          `);

          const row = result.data[0] ?? [0, 0, 0, 0];
          return reply.send({
            totalFiles: Number(row[0]),
            totalParts: Number(row[1]),
            totalChannels: Number(row[2]),
            totalAttributes: Number(row[3]),
            schema: getExrSchema(),
          });
        } catch (err) {
          return sendError(request, reply, 503, "EXR_QUERY_FAILED",
            err instanceof Error ? err.message : "EXR metadata query failed");
        }
      },
    );
  }
}
