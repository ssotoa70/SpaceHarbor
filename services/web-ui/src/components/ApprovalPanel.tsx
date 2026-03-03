import { useState } from "react";

import { approveAsset, rejectAsset, requestReview } from "../api";
import type { AssetRow } from "../types";

interface ApprovalPanelProps {
  asset: AssetRow | null;
  onActionComplete: () => void;
}

export function ApprovalPanel({ asset, onActionComplete }: ApprovalPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  if (!asset) {
    return (
      <section className="panel approval-panel" aria-labelledby="approval-heading">
        <h2 id="approval-heading">Asset Details</h2>
        <p className="approval-empty">Select an asset from the queue to view details.</p>
      </section>
    );
  }

  async function handleAction(action: () => Promise<void>, label: string) {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(`${label} successful.`);
      setShowRejectInput(false);
      setRejectReason("");
      onActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleApprove() {
    void handleAction(() => approveAsset(asset!.id), "Approval");
  }

  function handleReject() {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    if (!rejectReason.trim()) {
      setError("Rejection reason is required.");
      return;
    }
    void handleAction(() => rejectAsset(asset!.id, rejectReason.trim()), "Rejection");
  }

  function handleRequestReview() {
    void handleAction(() => requestReview(asset!.id), "Review request");
  }

  const meta = asset.metadata;
  const resolution = meta?.resolution
    ? `${meta.resolution.width} x ${meta.resolution.height}`
    : "-";
  const frameRange = meta?.frame_range
    ? `${meta.frame_range.start} - ${meta.frame_range.end}`
    : "-";

  return (
    <section className="panel approval-panel" aria-labelledby="approval-heading">
      <h2 id="approval-heading">Asset Details</h2>

      <dl className="detail-grid">
        <dt>Name</dt>
        <dd>{asset.title}</dd>
        <dt>Source</dt>
        <dd className="source-uri">{asset.sourceUri}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`status status-${asset.status}`}>{asset.status}</span>
        </dd>
        <dt>Resolution</dt>
        <dd>{resolution}</dd>
        <dt>Frame Range</dt>
        <dd>{frameRange}</dd>
        {meta?.codec && (
          <>
            <dt>Codec</dt>
            <dd>{meta.codec}</dd>
          </>
        )}
        {meta?.frame_rate != null && (
          <>
            <dt>Frame Rate</dt>
            <dd>{meta.frame_rate} fps</dd>
          </>
        )}
        {meta?.compression_type && (
          <>
            <dt>Compression</dt>
            <dd>{meta.compression_type}</dd>
          </>
        )}
        {meta?.file_size_bytes != null && (
          <>
            <dt>File Size</dt>
            <dd>{(meta.file_size_bytes / (1024 * 1024)).toFixed(2)} MB</dd>
          </>
        )}
        {meta?.md5_checksum && (
          <>
            <dt>MD5</dt>
            <dd className="checksum">{meta.md5_checksum}</dd>
          </>
        )}
        {asset.version && (
          <>
            <dt>Version</dt>
            <dd>{asset.version.version_label}</dd>
          </>
        )}
      </dl>

      {(error || success) && (
        <div
          className={`toast ${error ? "toast--error" : "toast--success"}`}
          role="alert"
          aria-live="assertive"
        >
          {error ?? success}
        </div>
      )}

      {showRejectInput && (
        <div className="reject-input">
          <label htmlFor="reject-reason">Rejection Reason</label>
          <textarea
            id="reject-reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Describe why this asset is rejected..."
            rows={3}
          />
        </div>
      )}

      <div className="approval-actions">
        <button
          type="button"
          className="btn btn--approve"
          onClick={handleApprove}
          disabled={loading}
        >
          {loading ? "..." : "Approve"}
        </button>
        <button
          type="button"
          className="btn btn--reject"
          onClick={handleReject}
          disabled={loading}
        >
          {loading ? "..." : showRejectInput ? "Confirm Reject" : "Reject"}
        </button>
        <button
          type="button"
          className="btn btn--review"
          onClick={handleRequestReview}
          disabled={loading}
        >
          {loading ? "..." : "Request Review"}
        </button>
      </div>
    </section>
  );
}
