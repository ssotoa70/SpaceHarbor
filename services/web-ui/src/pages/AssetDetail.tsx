import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

import { fetchAsset, fetchAssetAudit, type AssetRow, type AuditRow } from "../api";
import { Badge, Button, Card, Skeleton } from "../design-system";

const statusVariant = (s: string) => {
  if (s === "completed" || s === "qc_approved") return "success" as const;
  if (s === "failed" || s === "qc_rejected") return "danger" as const;
  if (s === "processing") return "info" as const;
  return "warning" as const;
};

export function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchAsset(id), fetchAssetAudit(id)]).then(([a, auditRows]) => {
      setAsset(a);
      setAudit(auditRows);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading asset">
        <Skeleton height="32px" width="300px" />
        <Skeleton height="200px" />
        <Skeleton height="100px" />
      </div>
    );
  }

  if (!asset) {
    return (
      <section aria-label="Asset not found">
        <h1 className="text-xl font-bold mb-4">Asset Not Found</h1>
        <p className="text-[var(--color-ah-text-muted)] mb-4">The asset with ID &quot;{id}&quot; could not be found.</p>
        <Link to="/">
          <Button variant="primary">Back to Assets</Button>
        </Link>
      </section>
    );
  }

  return (
    <section aria-label="Asset detail">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]">
          &larr; Assets
        </Link>
        <span className="text-[var(--color-ah-text-subtle)]">/</span>
        <h1 className="text-xl font-bold">{asset.title}</h1>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="space-y-6">
          <Card>
            <div className="aspect-video bg-black rounded-[var(--radius-ah-sm)] flex items-center justify-center mb-4">
              {asset.proxy?.uri ? (
                <video src={asset.proxy.uri} controls className="w-full h-full" />
              ) : asset.thumbnail?.uri ? (
                <img src={asset.thumbnail.uri} alt={asset.title} className="max-w-full max-h-full" />
              ) : (
                <span className="text-[var(--color-ah-text-subtle)]">No media available</span>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold mb-3">Audit Trail</h2>
            {audit.length === 0 ? (
              <p className="text-sm text-[var(--color-ah-text-muted)]">No audit events.</p>
            ) : (
              <ul className="space-y-2">
                {audit.map((row) => (
                  <li key={row.id} className="flex justify-between text-sm border-b border-[var(--color-ah-border-muted)] pb-2">
                    <span>{row.message}</span>
                    <span className="text-[var(--color-ah-text-subtle)]">{row.at}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold mb-3">Metadata</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-ah-text-muted)]">Status</dt>
                <dd><Badge variant={statusVariant(asset.status)}>{asset.status}</Badge></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-ah-text-muted)]">ID</dt>
                <dd className="font-mono text-xs">{asset.id}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-ah-text-muted)]">Source</dt>
                <dd className="truncate max-w-[180px]">{asset.sourceUri}</dd>
              </div>
              {asset.jobId && (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ah-text-muted)]">Job ID</dt>
                  <dd className="font-mono text-xs">{asset.jobId}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </section>
  );
}
