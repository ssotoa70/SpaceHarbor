// ---------------------------------------------------------------------------
// Phase 3.1: Persistent Authorization Decision Logger
// Batch-inserts decisions to auth_decisions table via Trino.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { TrinoClient } from "../db/trino-client.js";
import type { AuthzResult, AuthzDecision, Permission } from "./types.js";
import type { AuthzLogger, AuthzMetrics, AuthzDecisionFilter } from "./authz-logger.js";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

const S = 'vast."spaceharbor/production"';

function escapeStr(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Batch decision record (extended beyond AuthzResult with request context)
// ---------------------------------------------------------------------------

export interface AuditDecisionRecord {
  id: string;
  timestamp: string;
  actorId: string;
  actorEmail: string | null;
  authStrategy: string | null;
  permission: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: string;
  denialReason: string | null;
  shadowMode: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string | null;
  requestPath: string | null;
}

// ---------------------------------------------------------------------------
// Extended AuthzLogger with persistence + retention
// ---------------------------------------------------------------------------

export interface PersistentAuthzLogger extends AuthzLogger {
  /** Flush pending decisions to database immediately. */
  flush(): Promise<void>;
  /** Delete auth_decisions older than retention period. */
  runRetention(): Promise<number>;
  /** Start background flush and retention timers. */
  start(): void;
  /** Stop background timers. */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 100;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

function getRetentionDays(): number {
  const val = process.env.SPACEHARBOR_AUDIT_RETENTION_DAYS;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 90;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPersistentAuthzLogger(trino: TrinoClient): PersistentAuthzLogger {
  const pending: AuditDecisionRecord[] = [];
  const inMemory: AuthzResult[] = [];
  const metrics: AuthzMetrics = {
    total: 0,
    allow: 0,
    deny: 0,
    shadowDeny: 0,
  };

  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let retentionTimer: ReturnType<typeof setInterval> | null = null;
  let flushing = false;

  // Build batch INSERT SQL for pending records
  function buildInsertSql(records: AuditDecisionRecord[]): string {
    const rows = records.map((r) =>
      `(${escapeStr(r.id)}, TIMESTAMP ${escapeStr(r.timestamp)}, ${escapeStr(r.actorId)}, ` +
      `${escapeStr(r.actorEmail)}, ${escapeStr(r.authStrategy)}, ${escapeStr(r.permission)}, ` +
      `${escapeStr(r.resourceType)}, ${escapeStr(r.resourceId)}, ${escapeStr(r.decision)}, ` +
      `${escapeStr(r.denialReason)}, ${r.shadowMode}, ${escapeStr(r.ipAddress)}, ` +
      `${escapeStr(r.userAgent)}, ${escapeStr(r.requestMethod)}, ${escapeStr(r.requestPath)})`
    );
    return `INSERT INTO ${S}.auth_decisions (id, timestamp, actor_id, actor_email, auth_strategy, permission, resource_type, resource_id, decision, denial_reason, shadow_mode, ip_address, user_agent, request_method, request_path) VALUES ${rows.join(", ")}`;
  }

  async function flush(): Promise<void> {
    if (pending.length === 0 || flushing) return;
    flushing = true;
    const batch = pending.splice(0, pending.length);
    try {
      await trino.query(buildInsertSql(batch));
    } catch (err) {
      // On failure, push records back for retry
      pending.unshift(...batch);
      console.error("Failed to flush auth decisions:", err instanceof Error ? err.message : String(err));
    } finally {
      flushing = false;
    }
  }

  async function runRetention(): Promise<number> {
    const days = getRetentionDays();
    const sql = `DELETE FROM ${S}.auth_decisions WHERE timestamp < CURRENT_TIMESTAMP - INTERVAL '${days}' DAY`;
    try {
      const result = await trino.query(sql);
      return result.rowCount;
    } catch (err) {
      console.error("Audit retention failed:", err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  const logger: PersistentAuthzLogger = {
    logDecision(result: AuthzResult): void {
      // In-memory tracking (same as base logger)
      inMemory.push(result);
      metrics.total++;
      if (result.decision === "allow") {
        metrics.allow++;
      } else {
        metrics.deny++;
      }
      if (result.shadow && result.reason.startsWith("shadow-deny:")) {
        metrics.shadowDeny++;
      }

      // Queue for batch persistence
      pending.push({
        id: randomUUID(),
        timestamp: result.evaluatedAt,
        actorId: result.actor,
        actorEmail: null,
        authStrategy: null,
        permission: result.permission,
        resourceType: null,
        resourceId: null,
        decision: result.decision,
        denialReason: result.decision === "deny" ? result.reason : null,
        shadowMode: result.shadow,
        ipAddress: null,
        userAgent: null,
        requestMethod: null,
        requestPath: null,
      });

      // Flush if threshold reached
      if (pending.length >= FLUSH_THRESHOLD) {
        void flush();
      }
    },

    getDecisions(filter?: AuthzDecisionFilter): readonly AuthzResult[] {
      if (!filter) return inMemory;
      return inMemory.filter((d) => {
        if (filter.actor !== undefined && d.actor !== filter.actor) return false;
        if (filter.permission !== undefined && d.permission !== filter.permission) return false;
        if (filter.decision !== undefined && d.decision !== filter.decision) return false;
        if (filter.tenantId !== undefined && d.tenantId !== filter.tenantId) return false;
        if (filter.projectId !== undefined && d.projectId !== filter.projectId) return false;
        if (filter.shadow !== undefined && d.shadow !== filter.shadow) return false;
        return true;
      });
    },

    getMetrics(): AuthzMetrics {
      return { ...metrics };
    },

    clear(): void {
      inMemory.length = 0;
      pending.length = 0;
      metrics.total = 0;
      metrics.allow = 0;
      metrics.deny = 0;
      metrics.shadowDeny = 0;
    },

    flush,
    runRetention,

    start(): void {
      if (!flushTimer) {
        flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
      }
      if (!retentionTimer) {
        retentionTimer = setInterval(() => { void runRetention(); }, RETENTION_INTERVAL_MS);
      }
    },

    stop(): void {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      if (retentionTimer) {
        clearInterval(retentionTimer);
        retentionTimer = null;
      }
    },
  };

  return logger;
}
