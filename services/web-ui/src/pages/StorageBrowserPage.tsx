import { useState, useEffect, useCallback } from "react";
import {
  fetchStorageEndpoints,
  fetchStorageBrowse,
  fetchExrMetadataLookup,
  fetchPresignedUrl,
  ingestAsset,
  type StorageEndpoint,
  type StorageBrowseFile,
  type StorageBrowseFolder,
  type ExrMetadataLookupResult,
} from "../api";

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

    // Try to get a presigned preview URL
    void fetchPresignedUrl(file.sourceUri).then(setPreviewUrl);
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

  return (
    <div className="flex h-full">
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
          <span>Ingested {ingested.size} file{ingested.size > 1 ? "s" : ""} successfully</span>
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
              return (
                <tr
                  key={file.key}
                  onClick={() => setSelectedFile(file)}
                  className={`border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer ${selectedFile?.key === file.key ? "bg-indigo-500/10 border-l-2 border-l-indigo-400" : ""}`}
                >
                  <td className="px-4 py-2 text-white font-mono text-xs">
                    {name}
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
                    {ingested.has(file.key) ? (
                      <span className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-300">
                        Ingested
                      </span>
                    ) : (
                      <button
                        onClick={() => handleIngest(file)}
                        disabled={isIngesting}
                        className="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isIngesting ? "..." : "Ingest"}
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
    </div>
  );
}
