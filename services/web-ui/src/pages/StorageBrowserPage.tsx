import { useState, useEffect, useCallback, useRef, type DragEvent } from "react";
import {
  fetchStorageEndpoints,
  fetchStorageBrowse,
  fetchExrMetadataLookup,
  fetchMediaUrls,
  fetchProcessingStatus,
  deriveDisplayState,
  ingestAsset,
  type StorageEndpoint,
  type StorageBrowseFile,
  type StorageBrowseFolder,
  type ExrMetadataLookupResult,
  type MediaUrls,
  type ProcessingStatusEntry,
  type ProcessingDisplayState,
} from "../api";
import { IngestPanel } from "../components/IngestPanel";
import { Button } from "../design-system";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function mediaTypeColor(type: string): string {
  const colors: Record<string, string> = {
    image: "bg-blue-500/20 text-blue-300",
    video: "bg-purple-500/20 text-purple-300",
    audio: "bg-green-500/20 text-green-300",
    "3d": "bg-orange-500/20 text-orange-300",
    material: "bg-yellow-500/20 text-yellow-300",
    editorial: "bg-pink-500/20 text-pink-300",
    texture: "bg-cyan-500/20 text-cyan-300",
  };
  return colors[type] ?? "bg-gray-500/20 text-gray-300";
}

// ---------------------------------------------------------------------------
// File Detail Sidebar — shows EXR metadata from the exr_metadata schema
// ---------------------------------------------------------------------------

function FileDetailSidebar({ file, onClose }: { file: StorageBrowseFile; onClose: () => void }) {
  const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const filename = file.key.split("/").pop() ?? file.key;

  useEffect(() => {
    setLoading(true);
    setExrMeta(null);
    setPreviewUrl(null);

    // Fetch EXR metadata by filename
    void fetchExrMetadataLookup(filename).then((res) => {
      setExrMeta(res);
      setLoading(false);
    });

    // Try to get a presigned preview URL (prefer thumbnail from .proxies/ convention)
    void fetchMediaUrls(file.sourceUri).then((urls) => {
      setPreviewUrl(urls.thumbnail ?? urls.source ?? null);
    });
  }, [file.key, filename, file.sourceUri]);

  const summary = exrMeta?.summary;
  const parts = exrMeta?.parts ?? [];
  const channels = exrMeta?.channels ?? [];
  const part0 = parts[0];

  return (
    <div className="w-96 border-l border-gray-700 bg-gray-900/95 overflow-y-auto flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white truncate">{filename}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">&times;</button>
      </div>

      {/* Preview area */}
      <div className="h-48 bg-gray-950 flex items-center justify-center border-b border-gray-700">
        {previewUrl ? (
          <img src={previewUrl} alt={filename} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-gray-600 text-xs font-mono">No preview</div>
        )}
      </div>

      {loading ? (
        <div className="p-4 text-gray-500 text-sm">Loading metadata...</div>
      ) : !exrMeta?.found ? (
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">No EXR metadata available for this file.</div>
          <div className="space-y-2">
            <DetailRow label="File" value={filename} />
            <DetailRow label="Size" value={formatBytes(file.sizeBytes)} />
            <DetailRow label="Type" value={file.inferredMediaType} />
            <DetailRow label="Modified" value={file.lastModified ? new Date(file.lastModified).toLocaleString() : "-"} />
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Summary section */}
          {summary && (
            <Section title="Image">
              <DetailRow label="Resolution" value={summary.resolution} />
              <DetailRow label="Channels" value={String(summary.channelCount)} />
              <DetailRow label="Deep" value={summary.isDeep ? "Yes" : "No"} />
              {summary.frameNumber != null && <DetailRow label="Frame" value={String(summary.frameNumber)} />}
            </Section>
          )}

          {/* Technical section from part0 */}
          {part0 && (
            <Section title="Technical">
              <DetailRow label="Compression" value={part0.compression} />
              <DetailRow label="Color Space" value={part0.color_space ?? "-"} />
              <DetailRow label="Pixel Aspect" value={String(part0.pixel_aspect_ratio)} />
              <DetailRow label="Tiled" value={part0.is_tiled ? `${part0.tile_width}\u00d7${part0.tile_height}` : "Scanline"} />
              {part0.render_software && <DetailRow label="Software" value={part0.render_software.split(" ")[0]} />}
              <DetailRow label="Data Window" value={part0.data_window ?? "-"} />
              <DetailRow label="Display Window" value={part0.display_window ?? "-"} />
            </Section>
          )}

          {/* Channels/AOVs */}
          {channels.length > 0 && (
            <Section title={`Channels (${channels.length})`}>
              <div className="flex flex-wrap gap-1">
                {channels.map((ch) => (
                  <span key={`${ch.part_index}-${ch.channel_name}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-700 text-gray-300">
                    {ch.channel_name} <span className="text-gray-500">{ch.channel_type}</span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* File info */}
          <Section title="File">
            <DetailRow label="Size" value={formatBytes(file.sizeBytes)} />
            <DetailRow label="Path" value={file.key} mono />
            <DetailRow label="S3 URI" value={file.sourceUri} mono />
            {exrMeta.file && <DetailRow label="Inspected" value={new Date(exrMeta.file.inspection_timestamp).toLocaleString()} />}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-medium tracking-widest text-gray-500 uppercase mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-xs gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-gray-200 text-right truncate ${mono ? "font-mono text-[10px]" : ""}`}>{value}</span>
    </div>
  );
}

// 16px inline status indicator shown in the name cell. Non-intrusive — absent
// (or neutral gray) for unprocessed files, colored only when there's signal.
function ProcessingStatusIcon({
  state,
  entry,
}: {
  state: ProcessingDisplayState;
  entry?: ProcessingStatusEntry;
}) {
  const tooltip = (() => {
    if (!entry) return "Checking…";
    const parts: string[] = [];
    parts.push(entry.thumb_ready ? "thumbnail ✓" : "thumbnail ✗");
    parts.push(entry.preview_ready ? "preview ✓" : "preview ✗");
    parts.push(entry.proxy_ready ? "proxy ✓" : "proxy ✗");
    if (entry.sourceUri.toLowerCase().endsWith(".exr")) {
      parts.push(entry.metadata_ready ? "metadata ✓" : "metadata ✗");
    }
    if (entry.last_error) parts.push(`last error: ${entry.last_error}`);
    return parts.join("  ·  ");
  })();

  if (state === "ready") {
    return (
      <span title={tooltip} className="inline-flex items-center" aria-label="Processed">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="#10b981" fillOpacity="0.18" stroke="#10b981" strokeWidth="1.2" />
          <path d="M4.5 7.2 L6.2 8.8 L9.5 5.4" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </span>
    );
  }

  if (state === "partial") {
    return (
      <span title={tooltip} className="inline-flex items-center" aria-label="Partially processed">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="none" stroke="#f59e0b" strokeWidth="1.2" />
          <path d="M7 1 A6 6 0 0 1 7 13 Z" fill="#f59e0b" fillOpacity="0.4" />
        </svg>
      </span>
    );
  }

  if (state === "processing") {
    return (
      <span title={tooltip} className="inline-flex items-center" aria-label="Processing">
        <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin">
          <circle cx="7" cy="7" r="5" stroke="#06b6d4" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="20 12" fill="none" />
        </svg>
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span title={tooltip} className="inline-flex items-center" aria-label="Processing failed">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="#ef4444" fillOpacity="0.18" stroke="#ef4444" strokeWidth="1.2" />
          <path d="M5 5 L9 9 M9 5 L5 9" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  // not_processed — empty circle, muted
  return (
    <span title={tooltip} className="inline-flex items-center" aria-label="Not processed">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" fill="none" stroke="#4b5563" strokeWidth="1.2" strokeDasharray="1.5 1.5" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function StorageBrowserPage() {
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [files, setFiles] = useState<StorageBrowseFile[]>([]);
  const [folders, setFolders] = useState<StorageBrowseFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | undefined>();
  const [ingesting, setIngesting] = useState<Set<string>>(new Set());
  const [ingested, setIngested] = useState<Set<string>>(new Set());
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<StorageBrowseFile | null>(null);
  // Processing status keyed by sourceUri — populated after each browse via
  // the batch /storage/processing-status endpoint. Empty map means "unknown"
  // and the row renders a neutral dashed circle until data arrives.
  const [statusByUri, setStatusByUri] = useState<Map<string, ProcessingStatusEntry>>(new Map());
  // Upload drawer — the primary affordance for putting new bytes into the
  // bucket, moved here from the Assets page as of the IA refactor.
  const [uploadOpen, setUploadOpen] = useState(false);
  // Drag-over overlay state — shown while the user drags files over the page
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetchStorageEndpoints().then((eps) => {
      setEndpoints(eps);
      if (eps.length > 0) setSelectedEndpoint(eps[0].id);
    });
  }, []);

  const browse = useCallback(
    async (prefix: string, token?: string) => {
      if (!selectedEndpoint) return;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchStorageBrowse({
          endpointId: selectedEndpoint,
          prefix,
          maxKeys: 200,
          continuationToken: token,
        });
        if (result) {
          if (token) {
            setFiles((prev) => [...prev, ...result.files]);
          } else {
            setFiles(result.files);
          }
          setFolders(result.folders);
          setTruncated(result.truncated);
          setContinuationToken(result.continuationToken);
          setCurrentPrefix(prefix);
        } else {
          setError("Failed to browse storage");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Browse failed");
      } finally {
        setLoading(false);
      }
    },
    [selectedEndpoint],
  );

  useEffect(() => {
    if (selectedEndpoint) browse("");
  }, [selectedEndpoint, browse]);

  // After each browse, fetch processing status for all visible files in a
  // single batched POST. The endpoint caps at 200 sourceUris per request so
  // we chunk if the listing exceeds that (rare — page size is 200).
  useEffect(() => {
    if (files.length === 0) {
      setStatusByUri(new Map());
      return;
    }
    let cancelled = false;
    const fetchStatuses = async () => {
      const uris = files.map((f) => f.sourceUri).filter(Boolean);
      // Chunk at 200 — matches the backend's maxItems guard
      const chunks: string[][] = [];
      for (let i = 0; i < uris.length; i += 200) chunks.push(uris.slice(i, i + 200));
      const all: ProcessingStatusEntry[] = [];
      for (const chunk of chunks) {
        const batch = await fetchProcessingStatus(chunk);
        all.push(...batch);
        if (cancelled) return;
      }
      if (cancelled) return;
      const next = new Map<string, ProcessingStatusEntry>();
      for (const entry of all) next.set(entry.sourceUri, entry);
      setStatusByUri(next);
    };
    void fetchStatuses();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const navigateToFolder = (prefix: string) => {
    browse(prefix);
  };

  const navigateUp = () => {
    const parts = currentPrefix.replace(/\/$/, "").split("/");
    parts.pop();
    const parent = parts.length > 0 ? parts.join("/") + "/" : "";
    browse(parent);
  };

  const handleIngest = async (file: StorageBrowseFile) => {
    setIngesting((prev) => new Set(prev).add(file.key));
    setIngestError(null);
    try {
      const filename = file.key.split("/").pop() ?? file.key;
      await ingestAsset({
        title: filename,
        sourceUri: file.sourceUri,
        fileSizeBytes: file.sizeBytes,
      });
      setIngested((prev) => new Set(prev).add(file.key));
    } catch (err) {
      setIngestError(`Failed to ingest ${file.key.split("/").pop()}: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setIngesting((prev) => {
        const next = new Set(prev);
        next.delete(file.key);
        return next;
      });
    }
  };

  const currentEp = endpoints.find((e) => e.id === selectedEndpoint);
  const breadcrumbs = currentPrefix
    .split("/")
    .filter(Boolean)
    .reduce<{ label: string; prefix: string }[]>((acc, part) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].prefix : "";
      acc.push({ label: part, prefix: `${prev}${part}/` });
      return acc;
    }, []);

  // Drag-and-drop handlers — counter-based so nested enter/leave don't flicker.
  const dragCounterRef = useRef(0);
  const handleDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragOver(false);
  };
  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      // Opening the upload drawer is enough — IngestPanel's own drop zone
      // will receive the next drag-drop session. For now, nudge the user.
      setUploadOpen(true);
    }
  };

  return (
    <div
      className="flex h-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
    {/* Drag-over overlay — shown while files are being dragged over the page */}
    {dragOver && (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-ah-accent)]/10 backdrop-blur-sm pointer-events-none">
        <div className="px-8 py-6 rounded-2xl border-2 border-dashed border-[var(--color-ah-accent)] bg-[var(--color-ah-bg-raised)]/90">
          <p className="text-lg font-semibold text-white text-center">Drop files to upload</p>
          <p className="text-xs text-gray-400 text-center mt-1">
            Files will be placed in <span className="font-mono">{currentPrefix || "/"}</span>
          </p>
        </div>
      </div>
    )}
    <div className={`flex-1 p-6 space-y-4 overflow-auto ${selectedFile ? "pr-0" : ""}`}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Storage Browser</h1>
        <div className="flex items-center gap-3">
          {endpoints.length > 1 && (
            <select
              value={selectedEndpoint}
              onChange={(e) => setSelectedEndpoint(e.target.value)}
              className="bg-gray-800 text-white border border-gray-600 rounded px-3 py-1.5 text-sm"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.label} ({ep.bucket})
                </option>
              ))}
            </select>
          )}
          {currentEp && (
            <span className="text-xs text-gray-400">
              s3://{currentEp.bucket}
            </span>
          )}
          <Button
            variant="primary"
            onClick={() => setUploadOpen(true)}
            disabled={endpoints.length === 0}
          >
            + Upload
          </Button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm text-gray-400">
        <button
          onClick={() => browse("")}
          className="hover:text-white transition-colors"
        >
          /
        </button>
        {breadcrumbs.map((bc, i) => (
          <span key={bc.prefix} className="flex items-center gap-1">
            <span>/</span>
            <button
              onClick={() => navigateToFolder(bc.prefix)}
              className={`hover:text-white transition-colors ${
                i === breadcrumbs.length - 1 ? "text-white font-medium" : ""
              }`}
            >
              {bc.label}
            </button>
          </span>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {ingestError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm flex justify-between items-center">
          <span>{ingestError}</span>
          <button onClick={() => setIngestError(null)} className="text-red-400 hover:text-red-200 ml-2">x</button>
        </div>
      )}

      {ingested.size > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded p-3 text-green-300 text-sm flex justify-between items-center">
          <span>Registered {ingested.size} file{ingested.size > 1 ? "s" : ""} as assets</span>
          <button onClick={() => setIngested(new Set())} className="text-green-400 hover:text-green-200 ml-2">x</button>
        </div>
      )}

      {endpoints.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-2">No storage endpoints configured</p>
          <p className="text-sm">
            Go to Settings &gt; Storage to add S3 endpoints
          </p>
        </div>
      )}

      {/* File listing */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium w-24">Type</th>
              <th className="text-right px-4 py-2 font-medium w-24">Size</th>
              <th className="text-left px-4 py-2 font-medium w-44">Modified</th>
              <th className="text-right px-4 py-2 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentPrefix && (
              <tr
                onClick={navigateUp}
                className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
              >
                <td className="px-4 py-2 text-gray-300" colSpan={5}>
                  ..
                </td>
              </tr>
            )}
            {folders.map((folder) => (
              <tr
                key={folder.prefix}
                onClick={() => navigateToFolder(folder.prefix)}
                className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
              >
                <td className="px-4 py-2 text-blue-300 font-medium">
                  {folder.prefix.replace(currentPrefix, "").replace(/\/$/, "")}
                  /
                </td>
                <td className="px-4 py-2 text-gray-500">folder</td>
                <td className="px-4 py-2 text-right text-gray-500">-</td>
                <td className="px-4 py-2 text-gray-500">-</td>
                <td className="px-4 py-2 text-right">-</td>
              </tr>
            ))}
            {files.map((file) => {
              const name = file.key.replace(currentPrefix, "");
              const isIngesting = ingesting.has(file.key);
              const statusEntry = statusByUri.get(file.sourceUri);
              const displayState: ProcessingDisplayState = statusEntry
                ? deriveDisplayState(statusEntry)
                : "not_processed";
              return (
                <tr
                  key={file.key}
                  onClick={() => setSelectedFile(file)}
                  className={`border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer ${selectedFile?.key === file.key ? "bg-indigo-500/10 border-l-2 border-l-indigo-400" : ""}`}
                >
                  <td className="px-4 py-2 text-white font-mono text-xs">
                    <span className="inline-flex items-center gap-2">
                      <ProcessingStatusIcon state={displayState} entry={statusEntry} />
                      <span>{name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${mediaTypeColor(file.inferredMediaType)}`}
                    >
                      {file.inferredMediaType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {formatBytes(file.sizeBytes)}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {file.lastModified
                      ? new Date(file.lastModified).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {/*
                      Per-row action label is contextual based on processing state.
                      Today the button still calls the legacy registration path
                      (handleIngest → ingestAsset) — Commit 3 will swap the handler
                      body to publish a CloudEvent to the DataEngine trigger topic
                      so "Process" / "Reprocess" actually fire the pipeline.
                    */}
                    {ingested.has(file.key) || displayState === "ready" ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleIngest(file); }}
                        disabled={isIngesting}
                        className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Re-run the processing pipeline for this file"
                      >
                        {isIngesting ? "..." : "Reprocess"}
                      </button>
                    ) : displayState === "processing" ? (
                      <span className="text-xs px-2 py-1 rounded bg-cyan-600/20 text-cyan-300">
                        Processing…
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleIngest(file); }}
                        disabled={isIngesting}
                        className="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Run the processing pipeline for this file"
                      >
                        {isIngesting ? "..." : "Process"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            Loading...
          </div>
        )}

        {truncated && !loading && (
          <div className="flex justify-center py-3 border-t border-gray-700">
            <button
              onClick={() => browse(currentPrefix, continuationToken)}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Load more files...
            </button>
          </div>
        )}

        {!loading && files.length === 0 && folders.length === 0 && endpoints.length > 0 && (
          <div className="text-center py-8 text-gray-500">
            No files found in this location
          </div>
        )}
      </div>
    </div>

    {/* Detail sidebar */}
    {selectedFile && (
      <FileDetailSidebar file={selectedFile} onClose={() => setSelectedFile(null)} />
    )}

    {/* Upload drawer — IA refactor: upload lives in the Storage section now */}
    {uploadOpen && (
      <IngestPanel
        onClose={() => setUploadOpen(false)}
        onAssetIngested={() => {
          // Re-browse so the new file shows up in the listing, plus a status refresh
          void browse(currentPrefix);
        }}
      />
    )}
    </div>
  );
}
