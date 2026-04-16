/**
 * CheckinDropZone — atomic multi-file check-in UI.
 *
 * Usage:
 *   <CheckinDropZone
 *     initialShot={...}    // optional: pre-filled shot context
 *     onComplete={...}     // callback with committed versionId + files
 *     onClose={...}
 *   />
 *
 * Flow:
 *   1. User picks/drags files, assigns roles (primary/sidecar/...), sets label
 *   2. We call reserveCheckin → get N multipart uploads + presigned URLs
 *   3. For each file, slice per the server part plan, PUT each part,
 *      collect ETags, show progress
 *   4. POST /commit with the full parts manifest → atomic flip to committed
 *   5. On any failure before commit, call /abort so no S3 objects leak
 *
 * Shot selection uses the existing /api/v1/hierarchy endpoint — the user
 * picks Project → Sequence → Shot in cascading dropdowns. Admins with
 * context pre-filled (e.g. from a shot page) can skip the picker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  reserveCheckin, commitCheckin, abortCheckin,
  fetchHierarchy,
  type CheckinFileRole, type CheckinFileSpec, type CheckinReservation,
  type HierarchyNode,
} from "../../api";
import { putPart, sliceFile } from "./upload";

const ROLES: CheckinFileRole[] = ["primary", "sidecar", "proxy", "frame_range", "audio", "reference"];

interface FileEntry {
  id: string;
  file: File;
  role: CheckinFileRole;
  progress: number;      // 0..100
  status: "pending" | "uploading" | "uploaded" | "failed";
  error: string | null;
  etags: Array<{ partNumber: number; eTag: string }>;
}

export interface CheckinDropZoneProps {
  /** Pre-filled context (usually the shot the user was looking at). */
  initialContext?: {
    projectId: string;
    sequenceId: string;
    shotId: string;
  };
  onComplete?: (result: { versionId: string; checkinId: string; files: Array<{ filename: string; role: string }> }) => void;
  onClose: () => void;
}

export function CheckinDropZone({ initialContext, onComplete, onClose }: CheckinDropZoneProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [versionLabel, setVersionLabel] = useState("");
  const [context, setContext] = useState("main");
  const [notes, setNotes] = useState("");

  // Hierarchy picker
  const [hierarchy, setHierarchy] = useState<HierarchyNode[] | null>(null);
  const [projectId, setProjectId] = useState(initialContext?.projectId ?? "");
  const [sequenceId, setSequenceId] = useState(initialContext?.sequenceId ?? "");
  const [shotId, setShotId] = useState(initialContext?.shotId ?? "");

  const [phase, setPhase] = useState<"idle" | "reserving" | "uploading" | "committing" | "done" | "error">("idle");
  const [reservation, setReservation] = useState<CheckinReservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load hierarchy
  useEffect(() => {
    if (initialContext) return;
    void fetchHierarchy().then(setHierarchy).catch(() => setHierarchy([]));
  }, [initialContext]);

  const projects = hierarchy ?? [];
  const selectedProject = projects.find((p) => p.id === projectId);
  const sequences = (selectedProject?.children ?? []).filter((c) => c.type === "sequence");
  const selectedSequence = sequences.find((s) => s.id === sequenceId);
  const shots = (selectedSequence?.children ?? []).filter((c) => c.type === "shot");

  const handleAddFiles = useCallback((files: FileList | File[]) => {
    const next: FileEntry[] = [];
    let i = 0;
    for (const file of Array.from(files)) {
      next.push({
        id: `${Date.now()}-${i++}`,
        file,
        role: entries.length + next.length === 0 ? "primary" : "sidecar",
        progress: 0,
        status: "pending",
        error: null,
        etags: [],
      });
    }
    setEntries((prev) => [...prev, ...next]);
    if (!versionLabel && files.length > 0) {
      const name = (files as FileList).item ? (files as FileList).item(0)!.name : (files as File[])[0].name;
      setVersionLabel(`v001_${name.split(".")[0].slice(0, 30)}`);
    }
  }, [entries.length, versionLabel]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleAddFiles(e.dataTransfer.files);
  }, [handleAddFiles]);

  const handleRemove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const setRole = useCallback((id: string, role: CheckinFileRole) => {
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, role } : e));
  }, []);

  const primaryCount = entries.filter((e) => e.role === "primary").length;

  const canSubmit =
    entries.length > 0 &&
    versionLabel.trim().length > 0 &&
    projectId && sequenceId && shotId &&
    primaryCount <= 1 &&
    phase === "idle";

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setPhase("reserving");

    const files: CheckinFileSpec[] = entries.map((e) => ({
      filename: e.file.name,
      role: e.role,
      contentType: e.file.type || undefined,
      fileSizeBytes: e.file.size,
    }));

    let reservation: CheckinReservation;
    try {
      reservation = await reserveCheckin({
        shotId, projectId, sequenceId,
        versionLabel: versionLabel.trim(),
        context: context.trim() || "main",
        notes: notes.trim() || undefined,
        files,
      });
      setReservation(reservation);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Reserve failed");
      return;
    }

    // Match each reserved file back to its entry. The server may reorder
    // files (primary first) — match by filename.
    const entryByFilename = new Map(entries.map((e) => [e.file.name, e]));

    setPhase("uploading");
    abortControllerRef.current = new AbortController();

    try {
      // Upload files sequentially (one at a time). Parts within a file
      // are also sequential for simplicity — could parallelize per file
      // in a later iteration.
      for (const f of reservation.files) {
        const entry = entryByFilename.get(f.filename);
        if (!entry) throw new Error(`No local entry for ${f.filename}`);

        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, status: "uploading", progress: 0 } : e));

        const slices = sliceFile(entry.file, f.s3.parts);
        const etagsForFile: Array<{ partNumber: number; eTag: string }> = [];
        let uploadedBytes = 0;
        const totalBytes = entry.file.size;

        for (let i = 0; i < f.s3.parts.length; i++) {
          const part = f.s3.parts[i];
          const blob = slices[i].blob;
          const baseLoaded = uploadedBytes;
          const eTag = await putPart(
            part.presignedUrl,
            blob,
            (loaded) => {
              const pct = Math.round(((baseLoaded + loaded) / totalBytes) * 100);
              setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, progress: pct } : e));
            },
            abortControllerRef.current?.signal,
          );
          etagsForFile.push({ partNumber: part.partNumber, eTag });
          uploadedBytes += blob.size;
        }

        setEntries((prev) => prev.map((e) =>
          e.id === entry.id ? { ...e, status: "uploaded", progress: 100, etags: etagsForFile } : e));
      }

      // Commit
      setPhase("committing");
      const commitBody = {
        files: reservation.files.map((f) => {
          const entry = entryByFilename.get(f.filename)!;
          // Pull the freshly-uploaded etags from state via a closure — but
          // we accumulated them in etagsForFile above. Since React state
          // updates are async, use the collected data directly via a lookup.
          // We capture by iterating reservation.files in order.
          return {
            role: f.role,
            filename: f.filename,
            parts: entry.etags,
          };
        }),
      };

      // The above captured `entry.etags` from stale closure state. Read from
      // the LATEST entries via a functional setState is already too late —
      // we need a ref or to rebuild from the collected-during-upload data.
      // Simpler: rebuild from the entries state snapshot right now.
      const snapshot = await new Promise<FileEntry[]>((resolve) => {
        setEntries((latest) => { resolve(latest); return latest; });
      });
      const etagsByFilename = new Map(snapshot.map((e) => [e.file.name, e.etags]));
      const correctedCommit = {
        files: reservation.files.map((f) => ({
          role: f.role,
          filename: f.filename,
          parts: etagsByFilename.get(f.filename) ?? [],
        })),
      };
      void commitBody; // suppress unused

      const commitResult = await commitCheckin(reservation.checkinId, correctedCommit);
      setPhase("done");
      onComplete?.({
        versionId: commitResult.versionId,
        checkinId: commitResult.checkinId,
        files: commitResult.files.map((f) => ({ filename: f.filename, role: f.role })),
      });
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Upload/commit failed");
      // Best-effort abort so we don't leak open multipart uploads
      if (reservation) {
        try { await abortCheckin(reservation.checkinId); } catch { /* swallow */ }
      }
    }
  }, [canSubmit, entries, versionLabel, context, notes, shotId, projectId, sequenceId, onComplete]);

  const handleCancel = useCallback(async () => {
    if (phase === "uploading") {
      abortControllerRef.current?.abort();
      if (reservation) {
        try { await abortCheckin(reservation.checkinId); } catch { /* swallow */ }
      }
    }
    onClose();
  }, [phase, reservation, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[760px] max-w-[95vw] max-h-[92vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <header className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Atomic Check-in</h3>
          <button onClick={() => void handleCancel()} className="text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]" aria-label="Close">✕</button>
        </header>

        {phase === "done" ? (
          <SuccessView commitResult={reservation!} onClose={onClose} />
        ) : (
          <>
            {/* Shot picker */}
            {!initialContext && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Select label="Project" value={projectId} onChange={(v) => { setProjectId(v); setSequenceId(""); setShotId(""); }}
                  options={projects.map((p) => ({ value: p.id, label: p.label }))} />
                <Select label="Sequence" value={sequenceId} onChange={(v) => { setSequenceId(v); setShotId(""); }}
                  options={sequences.map((s) => ({ value: s.id, label: s.label }))} disabled={!projectId} />
                <Select label="Shot" value={shotId} onChange={setShotId}
                  options={shots.map((s) => ({ value: s.id, label: s.label }))} disabled={!sequenceId} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Version Label</span>
                <input type="text" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)}
                  placeholder="v001_comp_final"
                  className="mt-1 w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Context (parallel stream)</span>
                <input type="text" value={context} onChange={(e) => setContext(e.target.value)}
                  placeholder="main"
                  className="mt-1 w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm" />
              </label>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="rounded border-2 border-dashed border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] p-6 text-center mb-3"
            >
              <p className="text-sm text-[var(--color-ah-text-muted)]">
                Drag files here, or <FilePickerLabel onPick={handleAddFiles} />
              </p>
              <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
                One file per version must have role <code>primary</code>; the rest are sidecars.
              </p>
            </div>

            {/* File list */}
            {entries.length > 0 && (
              <div className="mb-3 border border-[var(--color-ah-border-muted)] rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)]">
                      <th className="px-2 py-1 text-left font-medium">File</th>
                      <th className="px-2 py-1 text-left font-medium">Size</th>
                      <th className="px-2 py-1 text-left font-medium">Role</th>
                      <th className="px-2 py-1 text-left font-medium">Status</th>
                      <th className="px-2 py-1 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-t border-[var(--color-ah-border-muted)]">
                        <td className="px-2 py-1 truncate max-w-[280px]">{e.file.name}</td>
                        <td className="px-2 py-1 font-[var(--font-ah-mono)]">{formatSize(e.file.size)}</td>
                        <td className="px-2 py-1">
                          <select value={e.role} onChange={(ev) => setRole(e.id, ev.target.value as CheckinFileRole)}
                            disabled={phase !== "idle"}
                            className="px-1 py-0.5 text-xs rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] disabled:opacity-50">
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          {e.status === "uploading" && <ProgressBar pct={e.progress} />}
                          {e.status === "uploaded" && <Badge variant="success">done</Badge>}
                          {e.status === "failed" && <Badge variant="danger">{e.error ?? "failed"}</Badge>}
                          {e.status === "pending" && phase === "idle" && <span className="text-[var(--color-ah-text-muted)]">ready</span>}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {phase === "idle" && (
                            <button onClick={() => handleRemove(e.id)} className="text-[var(--color-ah-text-muted)] hover:text-red-400">
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label className="block mb-3">
              <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Notes (optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm" />
            </label>

            {/* Validation hints */}
            {primaryCount > 1 && (
              <div className="mb-2 text-xs text-red-400">At most one file can have role <code>primary</code>.</div>
            )}
            {error && (
              <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400 break-words">
                {error}
              </div>
            )}

            <footer className="flex items-center justify-between">
              <div className="text-xs text-[var(--color-ah-text-muted)]">
                {phase === "reserving" && "Reserving version…"}
                {phase === "uploading" && "Uploading parts…"}
                {phase === "committing" && "Committing…"}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void handleCancel()}>Cancel</Button>
                <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                  {phase === "idle" ? "Start Check-in" : "Working…"}
                </Button>
              </div>
            </footer>
          </>
        )}
      </Card>
    </div>
  );
}

function Select({
  label, value, onChange, options, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="mt-1 w-full px-2 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm disabled:opacity-50">
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function FilePickerLabel({ onPick }: { onPick: (files: FileList) => void }) {
  return (
    <label className="text-[var(--color-ah-accent)] underline cursor-pointer">
      click to pick
      <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onPick(e.target.files); }} />
    </label>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-32 rounded bg-[var(--color-ah-bg-overlay)] overflow-hidden">
      <div className="h-full bg-[var(--color-ah-accent)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function SuccessView({ commitResult, onClose }: { commitResult: CheckinReservation; onClose: () => void }) {
  return (
    <div className="py-6 text-center">
      <div className="text-3xl mb-2">✓</div>
      <h4 className="text-lg font-semibold mb-1">Check-in committed</h4>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-2">
        Version <code className="font-[var(--font-ah-mono)] text-xs">{commitResult.versionId.slice(0, 8)}…</code> is live.
        DataEngine will process the files asynchronously; follow progress on the{" "}
        <code>/automation/dispatches</code> page.
      </p>
      <div className="mt-4">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
