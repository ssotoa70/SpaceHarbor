import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { WorkflowStatus } from "../domain/models.js";
import { canTransitionWorkflowStatus } from "../workflow/transitions.js";
import { eventBus } from "../events/bus.js";

const CONTEXT_MENU_STATUSES: Record<string, WorkflowStatus> = {
  qc_pending: "qc_pending",
  approved: "qc_approved",
  rejected: "qc_rejected",
  on_hold: "revision_required",
};

export async function registerAssetActionRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {

    // ── PATCH /assets/:id/status ──
    app.patch<{
      Params: { id: string };
      Body: { status: string; performed_by?: string; reason?: string };
    }>(
      withPrefix(prefix, "/assets/:id/status"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1PatchAssetStatus" : "legacyPatchAssetStatus",
          summary: "Update asset workflow status",
          body: {
            type: "object",
            required: ["status"],
            properties: {
              status: {
                type: "string",
                enum: Object.keys(CONTEXT_MENU_STATUSES),
                description: "Target status: qc_pending | approved | rejected | on_hold",
              },
              performed_by: { type: "string" },
              reason: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                asset: { type: "object", additionalProperties: true },
                previousStatus: { type: "string" },
                newStatus: { type: "string" },
              },
            },
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { status: targetKey, performed_by, reason } = request.body;

        const targetStatus = CONTEXT_MENU_STATUSES[targetKey];
        if (!targetStatus) {
          return sendError(request, reply, 400, "INVALID_STATUS", `Unknown status: ${targetKey}`);
        }

        const rows = await persistence.listAssetQueueRows();
        const row = rows.find((r) => r.id === id);
        if (!row) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${id}`);
        }
        if (!row.jobId) {
          return sendError(request, reply, 400, "NO_JOB", "Asset has no associated workflow job");
        }

        const currentStatus = row.status as WorkflowStatus;
        if (!canTransitionWorkflowStatus(currentStatus, targetStatus)) {
          return sendError(request, reply, 409, "INVALID_TRANSITION", `Cannot transition from ${currentStatus} to ${targetStatus}`, {
            currentStatus,
            targetStatus,
          });
        }

        const updated = await persistence.updateJobStatus(
          row.jobId,
          currentStatus,
          targetStatus,
          {
            correlationId: request.id,
            now: new Date().toISOString(),
          },
        );

        if (!updated) {
          return sendError(request, reply, 409, "CAS_CONFLICT", "Concurrent modification; please retry");
        }

        const performer = request.identity ?? performed_by ?? "unknown";
        const auditMsg = reason
          ? `Status changed to ${targetStatus} by ${performer}: ${reason}`
          : `Status changed to ${targetStatus} by ${performer}`;
        await persistence.appendApprovalAuditEntry({
          id: crypto.randomUUID(),
          assetId: id,
          action: "status_change" as never,
          performedBy: performer,
          at: new Date().toISOString(),
          note: auditMsg,
        });

        const refreshed = rows.find((r) => r.id === id);

        eventBus.publish({
          type: `asset.status.${targetStatus}`,
          subject: `asset:${id}`,
          data: { assetId: id, previousStatus: currentStatus, newStatus: targetStatus, reason },
          actor: performer,
          correlationId: request.id,
        });

        return reply.send({
          asset: { ...refreshed, status: targetStatus },
          previousStatus: currentStatus,
          newStatus: targetStatus,
        });
      },
    );

    // ── GET /assets/:id/notes ──
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/notes"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1GetAssetNotes" : "legacyGetAssetNotes",
          summary: "List notes for an asset",
          response: {
            200: {
              type: "object",
              properties: {
                notes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      assetId: { type: "string" },
                      body: { type: "string" },
                      createdBy: { type: "string" },
                      createdAt: { type: "string" },
                    },
                  },
                },
              },
            },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${request.params.id}`);
        }
        const notes = await persistence.getAssetNotes(request.params.id);
        return reply.send({ notes });
      },
    );

    // ── POST /assets/:id/notes ──
    app.post<{
      Params: { id: string };
      Body: { body: string; created_by?: string };
    }>(
      withPrefix(prefix, "/assets/:id/notes"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1CreateAssetNote" : "legacyCreateAssetNote",
          summary: "Add a note to an asset",
          body: {
            type: "object",
            required: ["body"],
            properties: {
              body: { type: "string", minLength: 1 },
              created_by: { type: "string" },
            },
          },
          response: {
            201: {
              type: "object",
              properties: {
                note: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    assetId: { type: "string" },
                    body: { type: "string" },
                    createdBy: { type: "string" },
                    createdAt: { type: "string" },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { body, created_by } = request.body;

        if (!body || body.trim().length === 0) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "Note body cannot be empty");
        }

        const asset = await persistence.getAssetById(id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${id}`);
        }

        const note = await persistence.createAssetNote(id, {
          body: body.trim(),
          createdBy: request.identity ?? created_by ?? "unknown",
          correlationId: request.id,
        });

        eventBus.publish({
          type: "asset.note.added",
          subject: `asset:${id}`,
          data: { assetId: id, noteId: note.id, createdBy: note.createdBy },
          actor: note.createdBy,
          correlationId: request.id,
        });

        return reply.status(201).send({ note });
      },
    );

    // ── POST /assets/:id/archive ──
    app.post<{
      Params: { id: string };
      Body: { performed_by?: string; force?: boolean };
    }>(
      withPrefix(prefix, "/assets/:id/archive"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1ArchiveAsset" : "legacyArchiveAsset",
          summary: "Archive (soft-delete) an asset with dependency check",
          body: {
            type: "object",
            properties: {
              performed_by: { type: "string" },
              force: { type: "boolean", description: "Force archive even if dependencies exist" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                archived: { type: "boolean" },
                assetId: { type: "string" },
                dependencies: { type: "array", items: { type: "object", additionalProperties: true } },
                message: { type: "string" },
              },
            },
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { performed_by, force } = request.body ?? {};

        const asset = await persistence.getAssetById(id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${id}`);
        }

        const deps = await persistence.getDependenciesBySource("asset", id);

        if (deps.length > 0 && !force) {
          return sendError(request, reply, 409, "HAS_DEPENDENCIES", `Asset has ${deps.length} dependent(s). Use force=true to override.`, {
            dependencies: deps.map((d) => ({ id: d.id, targetEntityId: d.targetEntityId, type: d.dependencyType })),
          });
        }

        await persistence.archiveAsset(id, {
          correlationId: request.id,
          now: new Date().toISOString(),
        });

        const performer = request.identity ?? performed_by ?? "unknown";
        await persistence.appendApprovalAuditEntry({
          id: crypto.randomUUID(),
          assetId: id,
          action: "archive" as never,
          performedBy: performer,
          at: new Date().toISOString(),
          note: `Asset archived by ${performer}`,
        });

        eventBus.publish({
          type: "asset.archived",
          subject: `asset:${id}`,
          data: { assetId: id, dependentCount: deps.length, forced: deps.length > 0 },
          actor: performer,
          correlationId: request.id,
        });

        return reply.send({
          archived: true,
          assetId: id,
          dependencies: deps.map((d) => ({ id: d.id, targetEntityId: d.targetEntityId, type: d.dependencyType })),
          message: deps.length > 0
            ? `Archived with ${deps.length} dependent(s) (force=true)`
            : "Asset archived successfully",
        });
      },
    );
  }
}
