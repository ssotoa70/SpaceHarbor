import { useState, useEffect, useCallback } from "react";
import {
  fetchStorageEndpoints,
  fetchStorageBrowse,
  ingestAsset,
  type StorageEndpoint,
  type StorageBrowseFile,
  type StorageBrowseFolder,
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
    try {
      const filename = file.key.split("/").pop() ?? file.key;
      await ingestAsset({
        title: filename,
        sourceUri: file.sourceUri,
        fileSizeBytes: file.sizeBytes,
      });
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
    <div className="p-6 space-y-4">
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
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
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
                    <button
                      onClick={() => handleIngest(file)}
                      disabled={isIngesting}
                      className="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isIngesting ? "..." : "Ingest"}
                    </button>
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
  );
}
