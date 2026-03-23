import { useEffect, useState } from "react";
import { fetchCatalogResolveElement, type ResolvedElement } from "../api";
import { Card } from "../design-system";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

/* ── Provenance types ── */

interface ProvenanceRecord {
  id: string;
  versionId: string;
  creator: string | null;
  softwareUsed: string | null;
  softwareVersion: string | null;
  renderJobId: string | null;
  pipelineStage: string | null;
  vastStoragePath: string | null;
  vastElementHandle: string | null;
  sourceHost: string | null;
  sourceProcessId: string | null;
  createdAt: string;
}

interface LineageEdge {
  id: string;
  ancestorVersionId: string;
  descendantVersionId: string;
  relationshipType: string;
  depth: number;
  createdAt: string;
}

/* ── Fetch helpers ── */

async function fetchProvenance(versionId: string): Promise<ProvenanceRecord[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/versions/${encodeURIComponent(versionId)}/provenance`);
    if (!response.ok) return [];
    const body = (await response.json()) as { provenance: ProvenanceRecord[] };
    return body.provenance;
  } catch {
    return [];
  }
}

async function fetchLineage(versionId: string): Promise<LineageEdge[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/versions/${encodeURIComponent(versionId)}/lineage?direction=ancestors&maxDepth=5`
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { lineage: LineageEdge[] };
    return body.lineage;
  } catch {
    return [];
  }
}

/* ── Detail row ── */

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-[var(--color-ah-text-muted)] text-xs">{label}</dt>
      <dd className={`text-xs truncate ${mono ? "font-[var(--font-ah-mono)]" : ""}`}>{value}</dd>
    </>
  );
}

/* ── Component ── */

interface ProvenancePanelProps {
  versionId: string | null;
  createdAt?: string;
  createdBy?: string;
  variant?: "card" | "inline";
}

export function ProvenancePanel({ versionId, createdAt, createdBy, variant = "card" }: ProvenancePanelProps) {
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [lineage, setLineage] = useState<LineageEdge[]>([]);
  const [resolvedPath, setResolvedPath] = useState<ResolvedElement | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!versionId) {
      setProvenance([]);
      setLineage([]);
      return;
    }

    setLoading(true);
    setResolvedPath(null);
    Promise.all([
      fetchProvenance(versionId),
      fetchLineage(versionId),
    ]).then(([prov, lin]) => {
      setProvenance(prov);
      setLineage(lin);
      setLoading(false);

      // C.10: Resolve element handle to current path if available
      const handle = prov[0]?.vastElementHandle;
      if (handle) {
        void fetchCatalogResolveElement(handle).then((resolved) => {
          if (resolved) setResolvedPath(resolved);
        });
      }
    }).catch(() => setLoading(false));
  }, [versionId]);

  if (!versionId) {
    return null;
  }

  const record = provenance[0] ?? null;
  const ancestorCount = lineage.length;
  const maxDepth = lineage.reduce((max, e) => Math.max(max, e.depth), 0);

  const content = (
    <>
      <h3 className="text-sm font-semibold text-[var(--color-ah-text-muted)] mb-2">Provenance</h3>

      {loading ? (
        <p className="text-xs text-[var(--color-ah-text-subtle)]">Loading...</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {/* Basic creation info */}
          <DetailRow label="Creator" value={record?.creator ?? createdBy ?? null} />
          <DetailRow
            label="Created"
            value={record?.createdAt
              ? new Date(record.createdAt).toLocaleString()
              : createdAt
                ? new Date(createdAt).toLocaleString()
                : null
            }
          />

          {/* Software info */}
          <DetailRow label="Software" value={
            record?.softwareUsed
              ? record.softwareVersion
                ? `${record.softwareUsed} ${record.softwareVersion}`
                : record.softwareUsed
              : null
          } />

          {/* Render info */}
          <DetailRow label="Render Job" value={record?.renderJobId} mono />
          <DetailRow label="Pipeline Stage" value={record?.pipelineStage} />
          <DetailRow label="Source Host" value={record?.sourceHost} mono />
          <DetailRow label="Process ID" value={record?.sourceProcessId} mono />

          {/* VAST storage */}
          <DetailRow label="VAST Path" value={record?.vastStoragePath} mono />
          <DetailRow label="Element Handle" value={record?.vastElementHandle} mono />

          {/* C.10: Resolved current path from VAST Catalog */}
          {resolvedPath && (
            <>
              <dt className="text-[var(--color-ah-text-muted)] text-xs">Current Path</dt>
              <dd className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]" title="Resolved via VAST Catalog - reflects current location even if file was moved">
                {resolvedPath.currentPath}
              </dd>
            </>
          )}

          {/* Lineage summary */}
          {ancestorCount > 0 && (
            <>
              <dt className="text-[var(--color-ah-text-muted)] text-xs">Ancestors</dt>
              <dd className="text-xs">
                {ancestorCount} version{ancestorCount !== 1 ? "s" : ""}, depth {maxDepth}
              </dd>
            </>
          )}
        </dl>
      )}

      {/* Lineage chain (compact) */}
      {lineage.length > 0 && (
        <div className="mt-3 pt-2 border-t border-[var(--color-ah-border-muted)]">
          <h4 className="text-[10px] font-semibold text-[var(--color-ah-text-subtle)] uppercase tracking-wide mb-1">
            Lineage Chain
          </h4>
          <div className="grid gap-0.5">
            {lineage.slice(0, 5).map(edge => (
              <div
                key={edge.id}
                className="flex items-center gap-1.5 text-[10px]"
              >
                <span className="text-[var(--color-ah-accent-muted)]">{edge.relationshipType.replace(/_/g, " ")}</span>
                <span className="text-[var(--color-ah-text-subtle)]">depth {edge.depth}</span>
                <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] truncate">
                  {edge.ancestorVersionId.slice(0, 8)}...
                </span>
              </div>
            ))}
            {lineage.length > 5 && (
              <span className="text-[10px] text-[var(--color-ah-text-subtle)]">
                +{lineage.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (variant === "inline") {
    return <div className="py-2">{content}</div>;
  }

  return <Card className="mt-3">{content}</Card>;
}
