// services/control-plane/src/routes/dataengine-pipelines-defaults.ts
/**
 * GET /api/v1/dataengine/pipelines/defaults
 *
 * Returns the canonical default pipeline list by re-reading the same
 * seed JSON that pipeline-seed.ts uses on first-boot. Single source of
 * truth — admins can call this to populate an empty `dataEnginePipelines`
 * setting without duplicating the list in the web-ui.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { FileSeedLoader, type SeedLoader } from "../data-engine/pipeline-seed.js";
import {
  validatePipelineConfigList,
  type DataEnginePipelineConfig,
} from "../data-engine/pipeline-config.js";

let loaderOverride: SeedLoader | null = null;

/** Test helper: inject a fake loader. Pass `null` to restore the default. */
export function __setPipelineDefaultsLoaderForTests(
  loader: SeedLoader | null,
): void {
  loaderOverride = loader;
}

function getLoader(): SeedLoader {
  return loaderOverride ?? new FileSeedLoader();
}

const defaultsResponseSchema = {
  type: "object",
  required: ["pipelines"],
  properties: {
    pipelines: {
      type: "array",
      items: {
        type: "object",
        required: ["fileKind", "functionName", "extensions", "targetSchema", "targetTable", "sidecarSchemaId"],
        properties: {
          fileKind: { type: "string", enum: ["image", "video", "raw_camera"] },
          functionName: { type: "string" },
          extensions: { type: "array", items: { type: "string" } },
          targetSchema: { type: "string" },
          targetTable: { type: "string" },
          sidecarSchemaId: { type: "string" },
          displayLabel: { type: "string" },
          enabled: { type: "boolean" },
        },
      },
    },
  },
} as const;

export async function registerDataEnginePipelineDefaultsRoute(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    app.get(
      withPrefix(prefix, "/dataengine/pipelines/defaults"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}GetDataEnginePipelineDefaults`,
          summary: "Canonical default pipeline list (same seed JSON as pipeline-seed.ts)",
          response: {
            200: defaultsResponseSchema,
            500: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        let raw: unknown;
        try {
          raw = getLoader().load();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return sendError(request, reply, 500, "SEED_UNAVAILABLE", `could not load seed file: ${msg}`);
        }

        let validated: DataEnginePipelineConfig[];
        try {
          validated = validatePipelineConfigList(raw);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return sendError(request, reply, 500, "SEED_UNAVAILABLE", `seed file failed validation: ${msg}`);
        }

        return reply.send({ pipelines: validated });
      },
    );
  }
}
