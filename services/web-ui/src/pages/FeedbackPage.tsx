import { useEffect, useState } from "react";

import { fetchRejectedFeedback, resubmitVersion } from "../api";
import type { RejectedAssetRow } from "../api";
import { Badge, Button, Card } from "../design-system";
import { MediaTypeIcon } from "../components/MediaTypeIcon";
import { inferMediaType } from "../utils/media-types";

export function FeedbackPage() {
  const [rejected, setRejected] = useState<RejectedAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchRejectedFeedback().then((assets) => {
      setRejected(assets);
      setLoading(false);
    });
  }, []);

  const handleResubmit = async (asset: RejectedAssetRow) => {
    await resubmitVersion({
      title: asset.title,
      sourceUri: asset.sourceUri,
      shotId: asset.productionMetadata?.shot ?? undefined,
      projectId: asset.productionMetadata?.show ?? undefined,
    });
    setRejected((prev) => prev.filter((a) => a.id !== asset.id));
  };

  return (
    <section aria-label="Feedback" className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Feedback</h1>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        Rejected items requiring revision or resubmission.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading feedback...</p>
      ) : rejected.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No rejected versions.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rejected.map((asset) => {
            const mediaType = inferMediaType(asset.title, asset.sourceUri);
            const commentCount = asset.comments?.length ?? 0;
            const isExpanded = expandedId === asset.id;

            return (
              <Card
                key={asset.id}
                className="p-4 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : asset.id)}
              >
                <div className="flex items-center gap-3">
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
                      <Badge variant="danger">rejected</Badge>
                      {commentCount > 0 && (
                        <Badge variant="default">{commentCount} comment{commentCount !== 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Button variant="secondary" onClick={() => void handleResubmit(asset)}>
                      Resubmit
                    </Button>
                  </div>
                </div>

                {asset.rejectionReason && (
                  <div className="mt-2 ml-[52px]">
                    <p className="text-xs text-[var(--color-ah-danger)]">
                      <span className="font-medium">Reason:</span> {asset.rejectionReason}
                    </p>
                    {asset.rejectedBy && (
                      <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5">
                        by {asset.rejectedBy}{" "}
                        {asset.rejectedAt ? `on ${new Date(asset.rejectedAt).toLocaleDateString()}` : ""}
                      </p>
                    )}
                  </div>
                )}

                {isExpanded && commentCount > 0 && (
                  <div className="mt-3 ml-[52px] grid gap-1">
                    {asset.comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="text-xs p-2 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)]"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium">{comment.authorId}</span>
                          {comment.frameNumber != null && (
                            <Badge variant="default">
                              {comment.timecode ?? `F${comment.frameNumber}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[var(--color-ah-text-muted)]">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
