import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createPlaylist,
  fetchPlaylists,
  type PlaylistData,
} from "../api";
import { Badge, Button, Card } from "../design-system";
import { useProject } from "../contexts/ProjectContext";

/* ── Create playlist modal ── */

interface CreateModalProps {
  onClose: () => void;
  onCreated: (playlist: PlaylistData) => void;
  projectId: string;
}

function CreatePlaylistModal({ onClose, onCreated, projectId }: CreateModalProps) {
  const [name, setName] = useState("");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;

      setSaving(true);
      setError(null);
      try {
        const playlist = await createPlaylist(projectId, {
          name: trimmed,
          createdBy: "current-user",
          sessionDate,
          description: description.trim() || undefined,
        });
        onCreated(playlist);
      } catch {
        setError("Failed to create playlist. Please try again.");
        setSaving(false);
      }
    },
    [name, sessionDate, description, projectId, onCreated],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-[480px] p-6">
        <h2 className="text-base font-semibold mb-4">Create Playlist</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-[var(--color-ah-text-muted)]">Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning Dailies — Seq A"
              required
              className="mt-1 block w-full px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-ah-text-muted)]">Session Date *</span>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-ah-text-muted)]">Description (optional)</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className="mt-1 block w-full px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
            />
          </label>
          {error && (
            <p className="text-sm text-[var(--color-ah-danger)]">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating..." : "Create Playlist"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/* ── Page ── */

export function DailiesIndexPage() {
  const navigate = useNavigate();
  const { project } = useProject();
  const [playlists, setPlaylists] = useState<PlaylistData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPlaylists(project?.id ?? "");
      setPlaylists(result);
    } catch {
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  const handleCreated = useCallback((playlist: PlaylistData) => {
    setPlaylists((prev) => [playlist, ...prev]);
    setShowCreate(false);
  }, []);

  return (
    <div data-testid="dailies-index-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Dailies</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Review playlists{project ? ` for ${project.label}` : ""}
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          Create Playlist
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-overlay)] animate-pulse"
            />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="dailies-empty"
        >
          <div className="text-4xl mb-4 opacity-40">&#9654;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No dailies playlists</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            Create a playlist to start reviewing dailies.
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="playlist-list">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => navigate(`/work/dailies/${pl.id}`)}
              className="w-full text-left"
              data-testid={`playlist-row-${pl.id}`}
            >
              <Card className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{pl.name}</span>
                    <Badge variant={pl.status === "active" ? "success" : "default"}>
                      {pl.status}
                    </Badge>
                  </div>
                  {pl.description && (
                    <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5 truncate">
                      {pl.description}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                    {pl.sessionDate}
                  </p>
                  <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-0.5">
                    by {pl.createdBy}
                  </p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreatePlaylistModal
          projectId={project?.id ?? ""}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
