// services/control-plane/src/routes/metadata-lookup-proxy.ts
/**
 * GET /api/v1/metadata/lookup?path=&schema=&table=
 *
 * Admin proxy over vastdb-query's /api/v1/metadata/lookup. Reuses the
 * existing proxyToVastdbQuery helper so the base URL (VASTDB_QUERY_URL
 * env) and 503 fallback stay consistent with sibling metadata routes.
 *
 * Used by the Metadata Pipelines admin page's per-pipeline test-lookup
 * tool. No rate limiting — trusted internal admin surface.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { proxyToVastdbQuery } from "./exr-metadata.js";

export type MetadataLookupProxy = typeof proxyToVastdbQuery;

let proxyOverride: MetadataLookupProxy | null = null;

/** Test helper: inject a stub. Pass `null` to restore the default. */
export function __setMetadataLookupProxyForTests(p: MetadataLookupProxy | null): void {
  proxyOverride = p;
}

function getProxy(): MetadataLookupProxy {
  return proxyOverride ?? proxyToVastdbQuery;
}

interface LookupQuery {
  path?: string;
  schema?: string;
  table?: string;
}

const lookupQuerySchema = {
  type: "object",
  required: ["path", "schema", "table"],
  properties: {
    path: { type: "string", minLength: 1 },
    schema: { type: "string", minLength: 1 },
    table: { type: "string", minLength: 1 },
  },
} as const;

export async function registerMetadataLookupProxyRoute(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    app.get<{ Querystring: LookupQuery }>(
      withPrefix(prefix, "/metadata/lookup"),
      {
        schema: {
          tags: ["metadata"],
          operationId: `${opPrefix}AdminMetadataLookup`,
          summary: "Admin-only schema-agnostic lookup against vastdb-query",
          querystring: lookupQuerySchema,
          response: {
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { path, schema, table } = request.query;
        if (!path || !schema || !table) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "path, schema, table all required");
        }

        const q = new URLSearchParams({ path, schema, table }).toString();
        const result = await getProxy()(`/api/v1/metadata/lookup?${q}`);

        if (result.status === 503) {
          const detail = (result.data as { detail?: string })?.detail ?? "unknown";
          return sendError(request, reply, 503, "LOOKUP_UNREACHABLE", `vastdb-query unreachable: ${detail}`);
        }

        return reply.status(result.status).send(result.data);
      },
    );
  }
}
