import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  type VastDataEngineCompletionEvent,
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "../events/types.js";
import { processAssetEvent, processVastFunctionCompletion } from "../events/processor.js";
import { broadcastEvent } from "./events-stream.js";

export async function registerVastEventsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    app.post(
      withPrefix(prefix, "/events/vast-dataengine"),
      {
        schema: {
          tags: ["events"],
          operationId: `v1PostVastDataEngineEvent${prefix ? "" : "Legacy"}`,
          summary: "Receive VAST DataEngine completion event (dev simulation mode)",
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {}),
        },
      },
      async (request, reply) => {
        const body = request.body;

        if (!isVastDataEngineCompletionEvent(body)) {
          return sendError(
            request,
            reply,
            400,
            "VALIDATION_ERROR",
            "invalid VAST DataEngine event shape",
            null,
          );
        }

        const normalized = normalizeVastDataEngineEvent(body);
        const context = {
          correlationId: resolveCorrelationId(request),
          now: body.time,
        };

        const result = await processAssetEvent(persistence, normalized, context, {
          enableRetryOnFailure: true,
        });

        if (!result.accepted && !result.duplicate) {
          return sendError(
            request,
            reply,
            422,
            "EVENT_REJECTED",
            result.reason ?? "event rejected",
            null,
          );
        }

        // Persist metadata to asset record on success
        if (normalized.eventType === "asset.processing.completed" && normalized.metadata) {
          const job = await persistence.getJobById(normalized.jobId);
          if (job) {
            await persistence.updateAsset(job.assetId, { metadata: normalized.metadata }, context);
          }
        }

        // Route DataEngine function-specific metadata processing
        const functionId = (body as VastDataEngineCompletionEvent).data.function_id;
        if (functionId && result.accepted && !result.duplicate) {
          await processVastFunctionCompletion(persistence, normalized, functionId, context);
          broadcastEvent("ingest:stage_update", { jobId: normalized.jobId, functionId, status: "done" });
        }

        return reply
          .status(200)
          .send({ accepted: true, duplicate: result.duplicate ?? false });
      },
    );
  }
}
