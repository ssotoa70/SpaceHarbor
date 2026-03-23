// ---------------------------------------------------------------------------
// Phase 8: Authorization Decision Audit Logger
// SERGIO-100 (Slice 3)
// ---------------------------------------------------------------------------

import type { AuthzDecision, AuthzResult, Permission } from "./types.js";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface AuthzMetrics {
  total: number;
  allow: number;
  deny: number;
  /** Decisions that were deny in evaluation but allowed due to shadow mode. */
  shadowDeny: number;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface AuthzDecisionFilter {
  actor?: string;
  permission?: Permission;
  decision?: AuthzDecision;
  tenantId?: string;
  projectId?: string | null;
  shadow?: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface & implementation
// ---------------------------------------------------------------------------

export interface AuthzLogger {
  logDecision(result: AuthzResult): void;
  getDecisions(filter?: AuthzDecisionFilter): readonly AuthzResult[];
  getMetrics(): AuthzMetrics;
  clear(): void;
}

/**
 * Creates an in-memory authz decision logger for local development and
 * shadow-mode auditing.
 */
export function createAuthzLogger(): AuthzLogger {
  const decisions: AuthzResult[] = [];
  const metrics: AuthzMetrics = {
    total: 0,
    allow: 0,
    deny: 0,
    shadowDeny: 0,
  };

  return {
    logDecision(result: AuthzResult): void {
      decisions.push(result);
      metrics.total++;
      if (result.decision === "allow") {
        metrics.allow++;
      } else {
        metrics.deny++;
      }
      // A shadow deny is when the result is "allow" but the reason indicates
      // the underlying evaluation was a deny (shadow mode overrode it).
      if (result.shadow && result.reason.startsWith("shadow-deny:")) {
        metrics.shadowDeny++;
      }
    },

    getDecisions(filter?: AuthzDecisionFilter): readonly AuthzResult[] {
      if (!filter) return decisions;
      return decisions.filter((d) => {
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
      decisions.length = 0;
      metrics.total = 0;
      metrics.allow = 0;
      metrics.deny = 0;
      metrics.shadowDeny = 0;
    },
  };
}
