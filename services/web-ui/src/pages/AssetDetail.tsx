import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

import {
  fetchAsset,
  fetchAssetAudit,
  type AssetRow,
  type AuditRow,
} from "../api";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { Badge, Button, Card, Skeleton } from "../design-system";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { VersionDispatchCard } from "../components/VersionDispatchCard";

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

  const metadataResult = useAssetMetadata(id ?? null);
  const metadata = metadataResult.data;

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

          {/* Rich per-frame metadata from unified asset metadata reader */}
          {metadata && metadata.dbRows.length > 0 && (() => {
            const row = metadata.dbRows[0];
            const w = row.width as number | undefined;
            const h = row.height as number | undefined;
            const resolution = w != null && h != null ? `${w}x${h}` : undefined;
            const compression = row.compression as string | undefined;
            const colorSpace = row.color_space as string | undefined;
            const isDeep = row.is_deep as boolean | undefined;
            return (
              <Card>
                <h2 className="text-sm font-semibold mb-3">EXR Metadata</h2>
                <dl className="space-y-2 text-sm">
                  {resolution && (
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-ah-text-muted)]">Resolution</dt>
                      <dd>{resolution}</dd>
                    </div>
                  )}
                  {compression && (
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-ah-text-muted)]">Compression</dt>
                      <dd>{compression}</dd>
                    </div>
                  )}
                  {colorSpace && (
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-ah-text-muted)]">Color Space</dt>
                      <dd>{colorSpace}</dd>
                    </div>
                  )}
                  {isDeep && (
                    <div className="flex justify-between">
                      <dt className="text-[var(--color-ah-text-muted)]">Type</dt>
                      <dd><Badge variant="info">Deep</Badge></dd>
                    </div>
                  )}
                </dl>
                {/* AOV / Channel pills — sourced from frame-metadata-extractor sidecar JSON */}
                {(() => {
                  const rawChannels = metadata.sidecar?.channels;
                  if (!Array.isArray(rawChannels)) return null;
                  const sidecarChannels = (rawChannels as Array<{
                    channel_name?: string;
                    layer_name?: string;
                    component_name?: string;
                    channel_type?: string;
                    part_index?: number;
                  }>).filter(
                    (ch): ch is Required<Pick<typeof ch, "channel_name">> & typeof ch =>
                      typeof ch.channel_name === "string"
                  );
                  if (sidecarChannels.length === 0) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-[var(--color-ah-border-muted)]">
                      <h3 className="text-xs font-semibold text-[var(--color-ah-text-muted)] mb-2">
                        AOVs / Channels
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        {sidecarChannels.map((ch, i) => (
                          <span
                            key={`${ch.part_index ?? ""}-${ch.channel_name}-${i}`}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-700 text-gray-300"
                          >
                            {ch.layer_name && ch.layer_name !== "rgba"
                              ? `${ch.layer_name}.`
                              : ""}
                            {ch.channel_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </Card>
            );
          })()}

          {/* Custom Fields — runtime-extensible metadata */}
          <Card>
            <h2 className="text-sm font-semibold mb-3">Custom Fields</h2>
            <CustomFieldsPanel entityType="asset" entityId={asset.id} />
          </Card>

          {/* DataEngine processing status — only when there's a linked version */}
          {asset.currentVersionId && (
            <Card>
              <h2 className="text-sm font-semibold mb-3">Processing</h2>
              <VersionDispatchCard versionId={asset.currentVersionId} />
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
