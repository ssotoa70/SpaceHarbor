import { useEffect, useState } from "react";

import { fetchAuditDecisions } from "../api";
import type { AuditDecisionRow } from "../api";
import { Badge, Button, Card } from "../design-system";
import { PermissionGate } from "../components/PermissionGate";

function AuditTrailContent() {
  const [decisions, setDecisions] = useState<AuditDecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState("");
  const [filterDecision, setFilterDecision] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const load = (userId?: string, decision?: string, from?: string, to?: string) => {
    setLoading(true);
    void fetchAuditDecisions({
      userId: userId || undefined,
      decision: decision || undefined,
      from: from || undefined,
      to: to || undefined,
    }).then((data) => {
      setDecisions(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const handleFilter = () => {
    load(filterUser, filterDecision, filterFrom, filterTo);
  };

  const decisionVariant = (d: AuditDecisionRow["decision"]) => {
    switch (d) {
      case "allow": return "success" as const;
      case "deny": return "danger" as const;
      case "shadow_deny": return "warning" as const;
    }
  };

  return (
    <section aria-label="Audit trail" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Audit Trail</h1>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        IAM authorization decisions log.
      </p>

      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block flex-1 min-w-[160px]">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">User</span>
            <input
              type="text"
              placeholder="Filter by user ID..."
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
            />
          </label>
          <label className="block w-40">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Decision</span>
            <select
              value={filterDecision}
              onChange={(e) => setFilterDecision(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              aria-label="Filter by decision"
            >
              <option value="">All</option>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
              <option value="shadow_deny">Shadow Deny</option>
            </select>
          </label>
          <label className="block w-40">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">From</span>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              aria-label="Filter from date"
            />
          </label>
          <label className="block w-40">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">To</span>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              aria-label="Filter to date"
            />
          </label>
          <Button variant="secondary" onClick={handleFilter}>
            Apply Filters
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading audit data...</p>
      ) : decisions.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No audit decisions found.
          </p>
        </Card>
      ) : (
        <div className="grid gap-1">
          <div className="grid grid-cols-[140px_1fr_1fr_100px_140px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
            <span>User</span>
            <span>Action</span>
            <span>Resource</span>
            <span>Decision</span>
            <span>Timestamp</span>
          </div>
          {decisions.map((row) => (
            <Card key={row.id} className="grid grid-cols-[140px_1fr_1fr_100px_140px] gap-4 items-center px-4 py-2">
              <span className="text-xs truncate" title={row.userId}>{row.userEmail}</span>
              <span className="text-xs font-mono truncate">{row.action}</span>
              <span className="text-xs truncate">{row.resource}</span>
              <Badge variant={decisionVariant(row.decision)}>{row.decision}</Badge>
              <span className="text-xs text-[var(--color-ah-text-muted)]">
                {new Date(row.timestamp).toLocaleString()}
              </span>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export function AuditTrailPage() {
  return (
    <PermissionGate
      permission="audit:read"
      fallback={
        <section aria-label="Audit trail" className="p-6 max-w-5xl mx-auto">
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              You do not have permission to view the audit trail.
            </p>
          </Card>
        </section>
      }
    >
      <AuditTrailContent />
    </PermissionGate>
  );
}
