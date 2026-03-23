// ---------------------------------------------------------------------------
// Phase 3.1: GET /api/v1/audit/auth-decisions — paginated audit query
// Admin-only endpoint for investigating authorization decisions.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { TrinoClient } from "../db/trino-client.js";
import type { RequestContext } from "../iam/types.js";

const S = 'vast."spaceharbor/production"';

function escapeStr(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export async function registerAuditDecisionsRoute(
  app: FastifyInstance,
  trino: TrinoClient | null,
  prefixes: string[] = ["", "/api/v1"],
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(`${prefix}/audit/auth-decisions`, {
      schema: {
        tags: ["audit"],
        operationId: "getAuthDecisions",
        summary: "Paginated audit log of authorization decisions — administrator only",
        security: [{ BearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "string", description: "Page number (default: 1)" },
            limit: { type: "string", description: "Results per page, max 200 (default: 50)" },
            actor: { type: "string", description: "Filter by actor user ID" },
            permission: { type: "string", description: "Filter by permission checked" },
            decision: { type: "string", description: "Filter by decision: allow or deny" },
            from: { type: "string", description: "Filter from timestamp (ISO 8601)" },
            to: { type: "string", description: "Filter to timestamp (ISO 8601)" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    timestamp: { type: "string" },
                    actorId: { type: "string" },
                    actorEmail: { type: "string" },
                    authStrategy: { type: "string" },
                    permission: { type: "string" },
                    resourceType: { type: "string" },
                    resourceId: { type: "string" },
                    decision: { type: "string" },
                    denialReason: { type: "string", nullable: true },
                    shadowMode: { type: "boolean" },
                    ipAddress: { type: "string" },
                    userAgent: { type: "string" },
                    requestMethod: { type: "string" },
                    requestPath: { type: "string" },
                  },
                },
              },
              pagination: {
                type: "object",
                properties: {
                  page: { type: "number" },
                  limit: { type: "number" },
                  total: { type: "number" },
                  totalPages: { type: "number" },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          500: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          503: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      // Admin-only check
      const ctx = (request as any).iamContext as RequestContext | undefined;
      if (ctx) {
        const isAdmin = ctx.roles.some(
          (r) => r === "administrator" || r === "super_admin"
        );
        if (!isAdmin) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "administrator role required",
            requestId: request.id,
            details: null,
          });
        }
      }

      if (!trino) {
        return reply.status(503).send({
          code: "SERVICE_UNAVAILABLE",
          message: "audit persistence not configured (no Trino connection)",
          requestId: request.id,
          details: null,
        });
      }

      const query = request.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
      const offset = (page - 1) * limit;

      // Build WHERE clauses
      const conditions: string[] = [];
      if (query.actor) {
        conditions.push(`actor_id = ${escapeStr(query.actor)}`);
      }
      if (query.permission) {
        conditions.push(`permission = ${escapeStr(query.permission)}`);
      }
      if (query.decision) {
        conditions.push(`decision = ${escapeStr(query.decision)}`);
      }
      if (query.from) {
        conditions.push(`timestamp >= TIMESTAMP ${escapeStr(query.from)}`);
      }
      if (query.to) {
        conditions.push(`timestamp <= TIMESTAMP ${escapeStr(query.to)}`);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      try {
        const countSql = `SELECT COUNT(*) AS cnt FROM ${S}.auth_decisions ${whereClause}`;
        const countResult = await trino.query(countSql);
        const total = Number(countResult.data[0]?.[0] ?? 0);

        const dataSql = `SELECT id, timestamp, actor_id, actor_email, auth_strategy, permission, resource_type, resource_id, decision, denial_reason, shadow_mode, ip_address, user_agent, request_method, request_path FROM ${S}.auth_decisions ${whereClause} ORDER BY timestamp DESC OFFSET ${offset} LIMIT ${limit}`;
        const result = await trino.query(dataSql);

        const decisions = result.data.map((row) => ({
          id: row[0],
          timestamp: row[1],
          actorId: row[2],
          actorEmail: row[3],
          authStrategy: row[4],
          permission: row[5],
          resourceType: row[6],
          resourceId: row[7],
          decision: row[8],
          denialReason: row[9],
          shadowMode: row[10],
          ipAddress: row[11],
          userAgent: row[12],
          requestMethod: row[13],
          requestPath: row[14],
        }));

        return reply.status(200).send({
          data: decisions,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (err) {
        return reply.status(500).send({
          code: "INTERNAL_ERROR",
          message: "failed to query audit decisions",
          requestId: request.id,
          details: null,
        });
      }
    });
  }
}
