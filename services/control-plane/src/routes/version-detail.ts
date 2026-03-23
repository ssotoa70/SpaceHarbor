import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { resolveAllProtocols } from "../storage/protocol-resolver.js";
import type { Version, AssetProvenance, VersionApproval } from "../domain/models.js";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface VersionDetailInfo {
  version: Version;
  provenance: AssetProvenance[];
  protocols: Record<string, string | null>;
}

export interface VersionDetailHistoryEvent {
  eventType: string;
  actor: string | null;
  at: string;
  detail: string | null;
}

export interface VersionDetailResponse {
  info?: VersionDetailInfo | null;
  aovs?: null;
  vast?: null;
  history?: VersionDetailHistoryEvent[] | null;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const VALID_TABS = new Set(["info", "aovs", "vast", "history"]);

export async function registerVersionDetailRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    app.get<{ Params: { id: string }; Querystring: { tabs?: string } }>(
      withPrefix(prefix, "/versions/:id/detail"),
      {
        schema: {
          tags: ["versions"],
          operationId: prefix === "/api/v1" ? "v1GetVersionDetail" : "legacyGetVersionDetail",
          summary: "Get detailed version information for the asset detail panel",
          response: {
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const tabsParam = (request.query as { tabs?: string }).tabs ?? "info";
        const requestedTabs = tabsParam.split(",").filter((t) => VALID_TABS.has(t));

        const version = await persistence.getVersionById(id);
        if (!version) {
          return sendError(request, reply, 404, "NOT_FOUND", `Version not found: ${id}`);
        }

        const result: VersionDetailResponse = {};

        if (requestedTabs.includes("info")) {
          const provenance = await persistence.getProvenanceByVersion(id);
          const protocols = version.elementPath
            ? resolveAllProtocols(version.elementPath)
            : { nfs: null, smb: null, s3: null };

          result.info = { version, provenance, protocols };
        }

        if (requestedTabs.includes("history")) {
          result.history = await buildHistoryTimeline(persistence, version);
        }

        if (requestedTabs.includes("aovs")) {
          result.aovs = null; // Phase 2
        }

        if (requestedTabs.includes("vast")) {
          result.vast = null; // Phase 3
        }

        return result;
      },
    );
  }
}

// ---------------------------------------------------------------------------
// History projection — union of lifecycle events
// ---------------------------------------------------------------------------

async function buildHistoryTimeline(
  persistence: PersistenceAdapter,
  version: Version,
): Promise<VersionDetailHistoryEvent[]> {
  const events: VersionDetailHistoryEvent[] = [];

  // 1. Version created
  events.push({
    eventType: "created",
    actor: version.createdBy,
    at: version.createdAt,
    detail: `Version ${version.versionLabel} created`,
  });

  // 2. Published
  if (version.publishedAt) {
    events.push({
      eventType: "published",
      actor: version.createdBy,
      at: version.publishedAt,
      detail: `Published as ${version.versionLabel}`,
    });
  }

  // 3. Provenance events (pipeline stage info)
  const provenanceRecords = await persistence.getProvenanceByVersion(version.id);
  for (const p of provenanceRecords) {
    events.push({
      eventType: "pipeline",
      actor: p.creator,
      at: p.createdAt,
      detail: p.pipelineStage
        ? `Pipeline stage: ${p.pipelineStage} via ${p.softwareUsed ?? "unknown"}`
        : `Processed by ${p.softwareUsed ?? "unknown"}`,
    });
  }

  // 4. Approval events
  const approvals = await persistence.listApprovalsByVersion(version.id);
  for (const a of approvals) {
    events.push({
      eventType: a.action,
      actor: a.performedBy,
      at: a.at,
      detail: a.note ?? `${a.action} by ${a.performedBy}`,
    });
  }

  // Sort descending by timestamp
  events.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));

  return events;
}
