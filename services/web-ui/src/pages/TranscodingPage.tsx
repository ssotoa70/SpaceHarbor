import { useEffect, useState } from "react";

import { fetchQueueItems } from "../api";
import type { QueueItemData } from "../api";
import { Badge, Card } from "../design-system";

const TRANSCODING_STAGES = ["ffmpeg_transcoder", "transcode", "proxy_gen"];

function isTranscodingJob(job: QueueItemData): boolean {
  return TRANSCODING_STAGES.some((stage) =>
    job.stage.toLowerCase().includes(stage.toLowerCase()),
  );
}

export function TranscodingPage() {
  const [jobs, setJobs] = useState<QueueItemData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchQueueItems().then((data) => {
      setJobs(data.filter(isTranscodingJob));
      setLoading(false);
    });
  }, []);

  const activeJobs = jobs.filter((j) => j.status === "processing" || j.status === "queued");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const failedJobs = jobs.filter((j) => j.status === "failed");

  return (
    <section aria-label="Transcoding" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Transcoding</h1>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        Active and recent transcoding jobs run by the ffmpeg-transcoder function.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{activeJobs.length}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Active</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-ah-success)]">{completedJobs.length}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Completed</p>
        </Card>
        <Card className="p-4 text-center">
          <p className={`text-2xl font-bold ${failedJobs.length > 0 ? "text-[var(--color-ah-warning)]" : ""}`}>
            {failedJobs.length}
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Failed</p>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading transcoding jobs...</p>
      ) : jobs.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No transcoding jobs
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)] pb-6 text-center">
            Transcoding jobs will appear here when video assets are ingested and processed by the ffmpeg-transcoder function.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {activeJobs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Active Jobs</h2>
              <div className="grid gap-1">
                {activeJobs.map((job) => (
                  <Card key={job.id} className="flex items-center gap-4 px-4 py-2">
                    <span className="text-sm flex-1 truncate">{job.assetTitle}</span>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">{job.stage}</span>
                    <Badge variant={job.status === "processing" ? "warning" : "default"}>
                      {job.status}
                    </Badge>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">
                      {new Date(job.queuedAt).toLocaleTimeString()}
                    </span>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {completedJobs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Recently Completed</h2>
              <div className="grid gap-1">
                {completedJobs.slice(0, 20).map((job) => (
                  <Card key={job.id} className="flex items-center gap-4 px-4 py-2">
                    <span className="text-sm flex-1 truncate">{job.assetTitle}</span>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">{job.stage}</span>
                    <Badge variant="success">completed</Badge>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">
                      {job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : "—"}
                    </span>
                  </Card>
                ))}
                {completedJobs.length > 20 && (
                  <p className="text-xs text-[var(--color-ah-text-muted)] pl-4">
                    and {completedJobs.length - 20} more...
                  </p>
                )}
              </div>
            </div>
          )}

          {failedJobs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Failed</h2>
              <div className="grid gap-1">
                {failedJobs.map((job) => (
                  <Card key={job.id} className="flex items-center gap-4 px-4 py-2">
                    <span className="text-sm flex-1 truncate">{job.assetTitle}</span>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">{job.stage}</span>
                    <Badge variant="danger">failed</Badge>
                    <span className="text-xs text-[var(--color-ah-text-muted)]">
                      {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "—"}
                    </span>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
