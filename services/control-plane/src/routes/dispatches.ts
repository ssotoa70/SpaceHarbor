/**
 * DataEngine dispatch observability routes.
 *
 *   GET  /api/v1/dispatches?versionId=...|checkinId=...|status=...
 *   GET  /api/v1/versions/:id/dispatches
 *   POST /api/v1/admin/dispatches/sweep   (manual poller trigger for incident response)
 *
 * The dispatch ledger (migration 022) records one row per expected
 * DataEngine function run. Rows are populated when `checkin.committed`
 * fires and flipped to `completed` by the background poller. These
 * endpoints let the UI + ops surface current processing state and
 * retry specific dispatches during an incident.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { paginateSortedArray, parsePaginationParams, paginationQuerySchema } from "../http/pagination.js";
import type { DispatchPollingDetector } from "../automation/dataengine-dispatch.js";

const dispatchResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    checkinId: { type: ["string", "null"] },
    versionId: { type: "string" },
    fileRole: { type: "string" },
    fileKind: { type: "string" },
    sourceS3Bucket: { type: "string" },
    sourceS3Key: { type: "string" },
    expectedFunction: { type: "string" },
    status: { type: "string" },
    proxyUrl: { type: ["string", "null"] },
    thumbnailUrl: { type: ["string", "null"] },
    metadataTargetSchema: { type: ["string", "null"] },
    metadataTargetTable: { type: ["string", "null"] },
    metadataRowId: { type: ["string", "null"] },
    lastError: { type: ["string", "null"] },
    deadlineAt: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    pollAttempts: { type: "integer" },
    lastPolledAt: { type: ["string", "null"] },
  },
} as const;

export async function registerDispatchesRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  poller: DispatchPollingDetector,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    app.get<{ Querystring: { versionId?: string; checkinId?: string; status?: string; cursor?: string; limit?: string; offset?: string } }>(
      withPrefix(prefix, "/dispatches"),
      {
        schema: {
          tags: ["pipeline"],
          operationId: `${op}ListDispatches`,
          summary: "List DataEngine dispatches with optional filters",
          querystring: {
            type: "object",
            properties: {
              versionId: { type: "string" },
              checkinId: { type: "string" },
              status: { type: "string" },
              ...paginationQuerySchema,
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                dispatches: { type: "array", items: dispatchResponseSchema },
                nextCursor: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      async (request) => {
        const pageParams = parsePaginationParams(request.query, { defaultLimit: 50 });
        const all = await persistence.listDataEngineDispatches({
          versionId: request.query.versionId,
          checkinId: request.query.checkinId,
          status: request.query.status,
          limit: 500,
        });
        const { items, nextCursor } = paginateSortedArray(all, pageParams, (d) => `${d.createdAt}|${d.id}`);
        return { dispatches: items, nextCursor };
      },
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/versions/:id/dispatches"),
      {
        schema: {
          tags: ["pipeline"],
          operationId: `${op}GetVersionDispatches`,
          summary: "Get all DataEngine dispatches for a version",
          response: {
            200: { type: "object", properties: { dispatches: { type: "array", items: dispatchResponseSchema } } },
          },
        },
      },
      async (request) => {
        const rows = await persistence.listDataEngineDispatches({ versionId: request.params.id, limit: 500 });
        return { dispatches: rows };
      },
    );

    app.post(
      withPrefix(prefix, "/admin/dispatches/sweep"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${op}SweepDispatches`,
          summary: "Manually trigger a dispatch polling sweep (admin override)",
          response: {
            200: {
              type: "object",
              properties: {
                polled: { type: "integer" },
                completed: { type: "integer" },
                abandoned: { type: "integer" },
              },
            },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const result = await poller.runSweep();
          return result;
        } catch (e) {
          return sendError(
            request, reply, 503, "SWEEP_FAILED",
            e instanceof Error ? e.message : String(e),
          );
        }
      },
    );
  }
}
