import { useCallback, useEffect, useState } from "react";

import {
  approveAsset,
  fetchApprovalQueue,
  rejectAsset,
} from "../api";
import type { AssetRow } from "../api";
import { Badge, Button, Card } from "../design-system";
import { MediaTypeIcon } from "../components/MediaTypeIcon";
import { RejectDialog } from "../components/RejectDialog";
import { inferMediaType } from "../utils/media-types";

export function ApprovalQueuePage() {
  const [queue, setQueue] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [heldIds, setHeldIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<AssetRow | null>(null);

  useEffect(() => {
    void fetchApprovalQueue("created_at", "desc", 1, 100).then(({ assets }) => {
      setQueue(assets);
      setLoading(false);
    });
  }, []);

  const handleApprove = useCallback(async (id: string) => {
    await approveAsset(id);
    setQueue((prev) => prev.filter((a) => a.id !== id));
    setBulkSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const handleRejectConfirm = useCallback(async (id: string, reason: string) => {
    await rejectAsset(id, reason);
    setQueue((prev) => prev.filter((a) => a.id !== id));
    setRejectTarget(null);
  }, []);

  const handleHold = useCallback((id: string) => {
    setHeldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkApprove = useCallback(async () => {
    for (const id of bulkSelected) {
      await approveAsset(id);
    }
    setQueue((prev) => prev.filter((a) => !bulkSelected.has(a.id)));
    setBulkSelected(new Set());
  }, [bulkSelected]);

  const toggleBulk = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <section aria-label="Approval queue" className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Approval Queue</h1>
        {bulkSelected.size > 0 && (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void handleBulkApprove()}>
              Approve ({bulkSelected.size})
            </Button>
            <Button variant="ghost" onClick={() => setBulkSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading approval queue...</p>
      ) : queue.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No items pending approval.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {queue.map((asset) => {
            const mediaType = inferMediaType(asset.title, asset.sourceUri);
            const isHeld = heldIds.has(asset.id);
            const isBulkSelected = bulkSelected.has(asset.id);

            return (
              <Card
                key={asset.id}
                className={`flex items-center gap-4 p-3 ${
                  isHeld ? "border-[var(--color-ah-warning)] bg-[var(--color-ah-warning)]/5" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isBulkSelected}
                  onChange={() => toggleBulk(asset.id)}
                  className="shrink-0"
                  aria-label={`Select ${asset.title}`}
                />
                <div className="w-10 h-8 rounded-sm flex items-center justify-center overflow-hidden shrink-0">
                  {asset.thumbnail?.uri ? (
                    <img src={asset.thumbnail.uri} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <MediaTypeIcon type={mediaType} size={20} className="text-[var(--color-ah-text-muted)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{asset.title}</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant={asset.status === "qc_pending" ? "warning" : "default"}>
                      {asset.status}
                    </Badge>
                    {isHeld && <Badge variant="warning">hold</Badge>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="primary" onClick={() => void handleApprove(asset.id)}>Approve</Button>
                  <Button
                    variant={isHeld ? "secondary" : "ghost"}
                    onClick={() => handleHold(asset.id)}
                  >
                    Hold
                  </Button>
                  <Button variant="destructive" onClick={() => setRejectTarget(asset)}>Reject</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {rejectTarget && (
        <RejectDialog
          assetTitle={rejectTarget.title}
          onConfirm={(reason) => void handleRejectConfirm(rejectTarget.id, reason)}
          onCancel={() => setRejectTarget(null)}
        />
      )}
    </section>
  );
}
