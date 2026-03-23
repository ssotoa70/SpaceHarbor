import type { FastifyInstance } from "fastify";
import type { TrinoClient } from "../db/trino-client.js";
import { classifyStatement, referencesBlockedTable, ensureLimit, validateLength } from "../query/sql-classifier.js";
import { esc, escNum, escTimestamp } from "../persistence/adapters/vast-trino-queries.js";
import { randomUUID, createHash } from "node:crypto";

const S = 'vast."spaceharbor/production"';

// In-memory rate limiter (10 req/min per user)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  bucket.count++;
  return bucket.count <= 10;
}

/** Reset rate limiter state (for testing). */
export function resetRateBuckets(): void {
  rateBuckets.clear();
}

// In-memory audit + history store (fallback when Trino unavailable)
interface AuditEntry {
  id: string;
  userId: string;
  sqlText: string;
  sqlHash: string;
  rowCount: number | null;
  durationMs: number | null;
  status: "success" | "error" | "denied";
  errorMessage: string | null;
  createdAt: string;
}

const auditStore: AuditEntry[] = [];

/** Reset audit store (for testing). */
export function resetAuditStore(): void {
  auditStore.length = 0;
}

async function recordAudit(
  trino: TrinoClient | null,
  entry: AuditEntry,
): Promise<void> {
  auditStore.push(entry);
  // Keep only last 1000 entries in memory
  if (auditStore.length > 1000) auditStore.splice(0, auditStore.length - 1000);

  if (trino) {
    try {
      await trino.query(
        `INSERT INTO ${S}.adhoc_query_audit (id, user_id, sql_text, sql_hash, row_count, duration_ms, status, error_message, created_at) ` +
        `VALUES (${esc(entry.id)}, ${esc(entry.userId)}, ${esc(entry.sqlText)}, ${esc(entry.sqlHash)}, ${escNum(entry.rowCount)}, ${escNum(entry.durationMs)}, ${esc(entry.status)}, ${esc(entry.errorMessage)}, ${escTimestamp(entry.createdAt)})`
      );
    } catch {
      // Audit persistence failure — in-memory fallback suffices
    }
  }
}

export function registerQueryRoutes(
  app: FastifyInstance,
  catalogTrino: TrinoClient | null,
  prefixes: string[],
): void {
  for (const prefix of prefixes) {
    // ── Execute Query ──
    app.post(`${prefix}/query/execute`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1QueryExecute" : "legacyQueryExecute",
        summary: "Execute an ad-hoc SQL query against the VAST catalog",
        body: {
          type: "object",
          properties: {
            sql: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["columns", "rows", "rowCount", "truncated", "durationMs", "queryId"],
            properties: {
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } },
              rowCount: { type: "number" },
              truncated: { type: "boolean" },
              durationMs: { type: "number" },
              queryId: { type: "string" },
            },
          },
          400: { type: "object", additionalProperties: true },
          403: { type: "object", additionalProperties: true },
          429: { type: "object", additionalProperties: true },
          500: { type: "object", additionalProperties: true },
        },
      },
    }, async (request, reply) => {
      // JWT-only auth: reject API key auth
      const iamContext = (request as any).iamContext;
      if (iamContext && iamContext.authStrategy === "api_key") {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "Query console requires JWT authentication, API keys are not accepted",
        });
      }

      const userId = iamContext?.userId ?? request.identity ?? "anonymous";

      // Rate limit
      if (!checkRateLimit(userId)) {
        return reply.status(429).send({
          code: "RATE_LIMITED",
          message: "Rate limit exceeded: maximum 10 queries per minute",
        });
      }

      const body = request.body as { sql?: string } | null;
      const sql = body?.sql?.trim();
      if (!sql) {
        return reply.status(400).send({ code: "BAD_REQUEST", message: "Missing 'sql' field" });
      }

      const auditId = randomUUID();
      const sqlHash = createHash("sha256").update(sql).digest("hex");
      const baseAudit: Omit<AuditEntry, "rowCount" | "durationMs" | "status" | "errorMessage"> = {
        id: auditId,
        userId,
        sqlText: sql,
        sqlHash,
        createdAt: new Date().toISOString(),
      };

      // Validation: length
      const lengthCheck = validateLength(sql);
      if (!lengthCheck.allowed) {
        await recordAudit(catalogTrino, { ...baseAudit, rowCount: null, durationMs: null, status: "denied", errorMessage: lengthCheck.reason! });
        return reply.status(400).send({ code: "BAD_REQUEST", message: lengthCheck.reason });
      }

      // Validation: statement type
      const typeCheck = classifyStatement(sql);
      if (!typeCheck.allowed) {
        await recordAudit(catalogTrino, { ...baseAudit, rowCount: null, durationMs: null, status: "denied", errorMessage: typeCheck.reason! });
        return reply.status(403).send({ code: "FORBIDDEN", message: typeCheck.reason });
      }

      // Validation: blocked tables
      const tableCheck = referencesBlockedTable(sql);
      if (!tableCheck.allowed) {
        await recordAudit(catalogTrino, { ...baseAudit, rowCount: null, durationMs: null, status: "denied", errorMessage: tableCheck.reason! });
        return reply.status(403).send({ code: "FORBIDDEN", message: tableCheck.reason });
      }

      // Ensure LIMIT
      const safeSql = ensureLimit(sql);

      if (!catalogTrino) {
        // No Trino — return sample data
        const sampleResult = {
          columns: ["id", "name", "status"],
          rows: [
            ["ast-001", "hero_char_v12.exr", "approved"],
            ["ast-002", "env_forest_v08.usd", "pending_review"],
          ],
          rowCount: 2,
          truncated: false,
          durationMs: 0,
          queryId: auditId,
        };
        await recordAudit(catalogTrino, { ...baseAudit, rowCount: 2, durationMs: 0, status: "success", errorMessage: null });
        return sampleResult;
      }

      // Execute
      const start = Date.now();
      try {
        const result = await catalogTrino.query(safeSql);
        const durationMs = Date.now() - start;
        const rowCount = result.data.length;
        await recordAudit(catalogTrino, { ...baseAudit, rowCount, durationMs, status: "success", errorMessage: null });
        return {
          columns: result.columns ?? [],
          rows: result.data,
          rowCount,
          truncated: rowCount >= 10000,
          durationMs,
          queryId: auditId,
        };
      } catch (err) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        await recordAudit(catalogTrino, { ...baseAudit, rowCount: null, durationMs, status: "error", errorMessage: message });
        return reply.status(500).send({ code: "QUERY_ERROR", message });
      }
    });

    // ── Query History ──
    app.get(`${prefix}/query/history`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1QueryHistory" : "legacyQueryHistory",
        summary: "Recent query history for the authenticated user",
        response: {
          200: {
            type: "object",
            required: ["history"],
            properties: {
              history: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    }, async (request) => {
      const iamContext = (request as any).iamContext;
      const userId = iamContext?.userId ?? request.identity ?? "anonymous";
      const userEntries = auditStore
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
      return { history: userEntries };
    });

    // ── Cancel Query ──
    app.delete(`${prefix}/query/:queryId`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1QueryCancel" : "legacyQueryCancel",
        summary: "Cancel a running query by ID",
        params: {
          type: "object",
          required: ["queryId"],
          properties: {
            queryId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["queryId", "cancelled"],
            properties: {
              queryId: { type: "string" },
              cancelled: { type: "boolean" },
            },
          },
        },
      },
    }, async (request, reply) => {
      const { queryId } = request.params as { queryId: string };
      // In a real implementation, this would call Trino REST API to cancel
      // For now, acknowledge the cancel request
      return { queryId, cancelled: true };
    });
  }
}
