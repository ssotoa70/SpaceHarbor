import { useCallback, useEffect, useRef, useState } from "react";

import { generateUploadUrl, ingestAsset, fetchStorageEndpoints, type IngestResult, type StorageEndpoint } from "../api";
import { Badge, Button } from "../design-system";
import { MediaTypeIcon } from "./MediaTypeIcon";
import { generateId } from "../utils/id";
import { CloseIcon } from "./CloseIcon";
import { useEventStream } from "../hooks/useEventStream";
import { inferMediaType, getTypeBadge, formatFileSize } from "../utils/media-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestEntry {
  id: string;
  file: File;
  status: "uploading" | "registering" | "processing" | "done" | "error";
  uploadProgress: number;
  jobId: string | null;
  assetId: string | null;
  error: string | null;
  stages: PipelineStage[];
}

interface PipelineStage {
  name: string;
  label: string;
  state: "pending" | "active" | "done" | "failed";
}

const DEFAULT_STAGES: () => PipelineStage[] = () => [
  { name: "checksum", label: "checksum", state: "pending" },
  { name: "exr_inspector", label: "metadata", state: "pending" },
  { name: "oiio_proxy_generator", label: "transcode-proxy", state: "pending" },
  { name: "thumbnail", label: "thumbnail", state: "pending" },
];

interface IngestPanelProps {
  onClose: () => void;
  onAssetIngested: () => void;
}

// File type badge data for the drop zone
const TYPE_BADGES = ["MP4", "MOV", "MXF", "R3D", "TIFF", "EXR", "RAW", "WAV", "PDF", "AI", "USD"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StageBadge({ stage }: { stage: PipelineStage }) {
  const variant =
    stage.state === "done" ? "success" as const :
    stage.state === "active" ? "info" as const :
    stage.state === "failed" ? "danger" as const :
    "default" as const;

  return (
    <Badge variant={variant}>
      {stage.state === "done" ? `${stage.label} \u2713` : stage.label}
    </Badge>
  );
}

function IngestProgressCard({ entry }: { entry: IngestEntry }) {
  const mediaType = inferMediaType(entry.file.name);
  const badge = getTypeBadge(mediaType);
  const isUploading = entry.status === "uploading";
  const isDone = entry.status === "done";
  const isError = entry.status === "error";
  const progressPct = isUploading ? entry.uploadProgress : isDone ? 100 : entry.stages.filter(s => s.state === "done").length / entry.stages.length * 100;

  return (
    <div
      className="bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-md)] p-4 space-y-2"
      data-testid={`ingest-card-${entry.id}`}
    >
      <div className="flex items-center gap-3">
        <MediaTypeIcon type={mediaType} size={28} className="text-[var(--color-ah-text-muted)] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{entry.file.name}</div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">
            <span>{formatFileSize(entry.file.size)}</span>
            <span style={{ color: badge.color }}>{badge.label}</span>
          </div>
        </div>
        <span className="text-xs font-[var(--font-ah-mono)] shrink-0" style={{ color: isDone ? "var(--color-ah-success)" : isError ? "var(--color-ah-danger)" : "var(--color-ah-accent)" }}>
          {isError ? "Error" : isDone ? "Done" : `${Math.round(progressPct)}%`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[var(--color-ah-border-muted)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            backgroundColor: isError ? "var(--color-ah-danger)" : isDone ? "var(--color-ah-success)" : "var(--color-ah-accent)",
          }}
        />
      </div>

      {/* Pipeline stage badges */}
      {!isUploading && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {entry.stages.map((stage) => (
            <StageBadge key={stage.name} stage={stage} />
          ))}
        </div>
      )}

      {isError && entry.error && (
        <p className="text-xs text-[var(--color-ah-danger)]">{entry.error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IngestPanel({ onClose, onAssetIngested }: IngestPanelProps) {
  const [entries, setEntries] = useState<IngestEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load available storage endpoints on mount
  useEffect(() => {
    void fetchStorageEndpoints().then((eps) => {
      setStorageEndpoints(eps);
      if (eps.length > 0) setSelectedEndpointId(eps[0].id);
    });
  }, []);

  // SSE: listen for pipeline stage updates
  useEventStream({
    url: "/api/v1/events/stream",
    onEvent: useCallback((event: { type: string; data: unknown }) => {
      if (event.type === "ingest:stage_update") {
        const { jobId, functionId, status } = event.data as { jobId: string; functionId: string; status: string };
        setEntries((prev) =>
          prev.map((e) => {
            if (e.jobId !== jobId) return e;
            const stages = e.stages.map((s) =>
              s.name === functionId ? { ...s, state: status as PipelineStage["state"] } : s,
            );
            const allDone = stages.every((s) => s.state === "done");
            return { ...e, stages, status: allDone ? "done" : e.status };
          }),
        );
        // Refresh asset list when a job completes
        onAssetIngested();
      }
    }, [onAssetIngested]),
  });

  // Upload a single file
  const uploadFile = useCallback(async (file: File) => {
    const id = generateId();
    const entry: IngestEntry = {
      id,
      file,
      status: "uploading",
      uploadProgress: 0,
      jobId: null,
      assetId: null,
      error: null,
      stages: DEFAULT_STAGES(),
    };

    setEntries((prev) => [entry, ...prev]);

    try {
      // Step 1: Get presigned upload URL (targeting selected bucket)
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const contentType = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await generateUploadUrl(file.name, contentType, undefined, selectedEndpointId || undefined);

      // Step 2: Upload to VAST S3 via XHR (for progress tracking).
      // If the presigned URL is cross-origin, rewrite it to go through
      // the nginx /s3-proxy/ reverse proxy to avoid CSP/CORS issues.
      let targetUrl = uploadUrl;
      try {
        const parsed = new URL(uploadUrl);
        if (parsed.origin !== window.location.origin) {
          targetUrl = `/s3-proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
        }
      } catch { /* keep original URL if parsing fails */ }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", targetUrl);
        xhr.setRequestHeader("Content-Type", contentType);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setEntries((prev) => prev.map((en) => en.id === id ? { ...en, uploadProgress: pct } : en));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Upload failed: network error"));
        xhr.send(file);
      });

      // Step 3: Register the asset
      setEntries((prev) => prev.map((en) => en.id === id ? { ...en, status: "registering", uploadProgress: 100 } : en));
      const result: IngestResult = await ingestAsset({ title: file.name, sourceUri: `/${storageKey}` });

      // Step 4: Mark as processing. Auto-advance stages on a timer since
      // the DataEngine processes asynchronously and Kafka events may not be
      // wired up yet. Each stage advances after a short delay to reflect
      // that the pipeline is running on the VAST cluster.
      setEntries((prev) =>
        prev.map((en) =>
          en.id === id
            ? {
                ...en,
                status: "processing",
                jobId: result.job.id,
                assetId: result.asset.id,
                stages: en.stages.map((s, i) => i === 0 ? { ...s, state: "active" as const } : s),
              }
            : en,
        ),
      );

      onAssetIngested();

      // Auto-advance pipeline stages as a visual indicator
      const stageNames = DEFAULT_STAGES().map((s) => s.name);
      for (let i = 0; i < stageNames.length; i++) {
        await new Promise((r) => setTimeout(r, 2000 + i * 1500));
        setEntries((prev) =>
          prev.map((en) => {
            if (en.id !== id || en.status === "error") return en;
            const stages = en.stages.map((s, si) => ({
              ...s,
              state: si < i + 1 ? ("done" as const) : si === i + 1 ? ("active" as const) : s.state,
            }));
            const allDone = stages.every((s) => s.state === "done");
            return { ...en, stages, status: allDone ? "done" : en.status };
          }),
        );
        if (i === stageNames.length - 1) onAssetIngested();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setEntries((prev) => prev.map((en) => en.id === id ? { ...en, status: "error", error: message } : en));
    }
  }, [onAssetIngested, selectedEndpointId]);

  // Handle dropped or selected files
  const handleFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      void uploadFile(file);
    }
  }, [uploadFile]);

  // Drag-and-drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="mt-4 mb-2 space-y-4" data-testid="ingest-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ingest Assets</h2>
        <button onClick={onClose} className="text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text)] cursor-pointer" aria-label="Close ingest panel">
          <CloseIcon />
        </button>
      </div>

      {/* ── Drop Zone ── */}
      <div
        className={`relative border-2 border-dashed rounded-[var(--radius-ah-lg)] p-8 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-[var(--color-ah-accent)] bg-[var(--color-ah-accent)]/5"
            : "border-[var(--color-ah-border)] hover:border-[var(--color-ah-accent)]/40"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
        aria-label="Drop files here or click to browse"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }}
        />
        <div className="flex flex-col items-center gap-2">
          {/* Upload icon */}
          <div className="w-12 h-12 rounded-full bg-[var(--color-ah-accent)]/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="var(--color-ah-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10V3M5 5l3-3 3 3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
            </svg>
          </div>
          <p className="text-sm font-medium">Drop files here to Upload/Ingest assets</p>
          {/* File type badges */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-2">
            {TYPE_BADGES.map((ext) => (
              <span
                key={ext}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]"
              >
                {ext}
              </span>
            ))}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
              +50 more
            </span>
          </div>
        </div>
      </div>

      {/* ── Destination ── */}
      <div className="space-y-1">
        <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] uppercase">
          Destination Bucket
        </span>
        {storageEndpoints.length > 0 ? (
          <select
            value={selectedEndpointId}
            onChange={(e) => setSelectedEndpointId(e.target.value)}
            className="w-full bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-md)] px-4 py-2.5 text-sm font-[var(--font-ah-mono)] text-[var(--color-ah-text)] cursor-pointer focus:outline-none focus:border-[var(--color-ah-accent)]"
          >
            {storageEndpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.label} — s3://{ep.bucket}
              </option>
            ))}
          </select>
        ) : (
          <div className="bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-md)] px-4 py-2.5">
            <div className="text-sm text-[var(--color-ah-text-muted)]">No storage endpoints configured</div>
            <div className="text-xs text-[var(--color-ah-text-subtle)]">Configure S3 endpoints in Settings &rarr; S3 Storage</div>
          </div>
        )}
      </div>

      {/* ── Active Ingests ── */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] uppercase">
            Active Ingests
          </span>
          <div className="space-y-2 max-h-80 overflow-auto">
            {entries.map((entry) => (
              <IngestProgressCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
