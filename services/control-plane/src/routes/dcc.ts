import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import { errorEnvelopeSchema, workflowStatusEnum } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { DccAuditEntry } from "../types/dcc.js";

const SUPPORTED_FORMATS = ["exr", "mov", "dpx"] as const;

async function recordDccAudit(persistence: PersistenceAdapter, action: string, assetId: string | null, format: string | null): Promise<DccAuditEntry> {
  const entry: DccAuditEntry = {
    id: randomUUID(),
    action,
    asset_id: assetId,
    format,
    timestamp: new Date().toISOString(),
  };
  await persistence.appendDccAuditEntry(entry);
  return entry;
}

const mayaExportBodySchema = {
  type: "object",
  required: ["asset_id", "shot_id", "version_label", "export_format"],
  additionalProperties: false,
  properties: {
    asset_id: { type: "string", minLength: 1 },
    shot_id: { type: "string", minLength: 1 },
    version_label: { type: "string", minLength: 1 },
    export_format: { type: "string", minLength: 1 },
  },
} as const;

const mayaExportResponseSchema = {
  type: "object",
  required: ["job_id", "status", "manager_uri"],
  properties: {
    job_id: { type: "string" },
    status: { type: "string", enum: ["queued"] },
    manager_uri: { type: "string" },
  },
} as const;

const nukeImportBodySchema = {
  type: "object",
  required: ["asset_id", "nuke_project_path"],
  additionalProperties: false,
  properties: {
    asset_id: { type: "string", minLength: 1 },
    nuke_project_path: { type: "string", minLength: 1 },
  },
} as const;

const nukeImportResponseSchema = {
  type: "object",
  required: ["asset_id", "metadata_imported"],
  properties: {
    asset_id: { type: "string" },
    metadata_imported: { type: "boolean" },
  },
} as const;

const supportedFormatsResponseSchema = {
  type: "object",
  required: ["formats"],
  properties: {
    formats: { type: "array", items: { type: "string" } },
  },
} as const;

const jobStatusResponseSchema = {
  type: "object",
  required: ["job_id", "status"],
  properties: {
    job_id: { type: "string" },
    status: { type: "string", enum: [...workflowStatusEnum] },
  },
} as const;

export async function registerDccRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    // POST /dcc/maya/export-asset
    app.post<{ Body: { asset_id: string; shot_id: string; version_label: string; export_format: string } }>(
      withPrefix(prefix, "/dcc/maya/export-asset"),
      {
        schema: {
          tags: ["dcc"],
          deprecated: true,
          operationId: "v1DccMayaExport",
          summary: "Request asset export via Maya (stub)",
          security: [{ ApiKeyAuth: [] as string[] }],
          body: mayaExportBodySchema,
          response: {
            200: mayaExportResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { asset_id, export_format } = request.body;

        await recordDccAudit(persistence, "DCC export requested via Maya", asset_id, export_format);

        const managerBase = process.env.OPENASSETIO_MANAGER_URL ?? "http://openassetio-manager:8001";
        return reply.status(200).send({
          job_id: `dcc-job-${randomUUID()}`,
          status: "queued" as const,
          manager_uri: `${managerBase}/resolve`,
        });
      },
    );

    // POST /dcc/nuke/import-metadata
    app.post<{ Body: { asset_id: string; nuke_project_path: string } }>(
      withPrefix(prefix, "/dcc/nuke/import-metadata"),
      {
        schema: {
          tags: ["dcc"],
          deprecated: true,
          operationId: "v1DccNukeImport",
          summary: "Import metadata from Nuke project (stub)",
          security: [{ ApiKeyAuth: [] as string[] }],
          body: nukeImportBodySchema,
          response: {
            200: nukeImportResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { asset_id } = request.body;

        await recordDccAudit(persistence, "Metadata imported from Nuke", asset_id, null);

        return reply.status(200).send({
          asset_id,
          metadata_imported: true,
        });
      },
    );

    // GET /dcc/supported-formats
    app.get(
      withPrefix(prefix, "/dcc/supported-formats"),
      {
        schema: {
          tags: ["dcc"],
          deprecated: true,
          operationId: "v1DccSupportedFormats",
          summary: "List supported DCC export formats",
          response: {
            200: supportedFormatsResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (_request, reply) => {
        return reply.status(200).send({
          formats: [...SUPPORTED_FORMATS],
        });
      },
    );

    // GET /dcc/status/:job_id
    app.get<{ Params: { job_id: string } }>(
      withPrefix(prefix, "/dcc/status/:job_id"),
      {
        schema: {
          tags: ["dcc"],
          deprecated: true,
          operationId: "v1DccJobStatus",
          summary: "Check DCC job status (stub)",
          params: {
            type: "object",
            required: ["job_id"],
            properties: {
              job_id: { type: "string" },
            },
          },
          response: {
            200: jobStatusResponseSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const job = await persistence.getJobById(request.params.job_id);
        if (!job) {
          return sendError(request, reply, 404, "NOT_FOUND", "Job not found", {
            job_id: request.params.job_id,
          });
        }
        return reply.status(200).send({
          job_id: job.id,
          status: job.status,
        });
      },
    );
  }
}
