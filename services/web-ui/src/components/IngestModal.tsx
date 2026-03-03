import { FormEvent, useEffect, useRef, useState } from "react";

import { ingestAsset } from "../api";

interface IngestModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SAMPLE_PROJECTS = [
  { id: "proj-001", name: "Feature Film Alpha" },
  { id: "proj-002", name: "Commercial Spot Beta" },
  { id: "proj-003", name: "VFX Sequence Gamma" }
];

export function IngestModal({ open, onClose, onSuccess }: IngestModalProps) {
  const [name, setName] = useState("");
  const [fileUri, setFileUri] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function reset() {
    setName("");
    setFileUri("");
    setProjectId("");
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!name.trim() || !fileUri.trim()) {
      setError("Name and File URI are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await ingestAsset({
        title: name.trim(),
        sourceUri: fileUri.trim(),
        projectId: projectId || undefined
      });
      setSuccess(true);
      reset();
      onSuccess();
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ingest-modal-heading">
      <div className="ingest-modal">
        <form onSubmit={handleSubmit} className="ingest-modal-form">
          <h2 id="ingest-modal-heading">Ingest New Asset</h2>

          {error && (
            <div className="toast toast--error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {success && (
            <div className="toast toast--success" role="alert" aria-live="assertive">
              Asset ingested successfully.
            </div>
          )}

          <label htmlFor="ingest-name">Name</label>
          <input
            id="ingest-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Asset name"
            required
          />

          <label htmlFor="ingest-uri">File URI</label>
          <input
            id="ingest-uri"
            type="text"
            value={fileUri}
            onChange={(e) => setFileUri(e.target.value)}
            placeholder="/vast/media/shot_001.exr"
            required
          />

          <label htmlFor="ingest-project">Project</label>
          <select
            id="ingest-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">-- Select project --</option>
            {SAMPLE_PROJECTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="modal-actions">
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? "Submitting..." : "Ingest"}
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
