import { useState, useEffect } from "react";
import { fetchPlaylists, createPlaylist, addPlaylistItem, type PlaylistData } from "../api";

interface AddToPlaylistModalProps {
  shotId: string;
  versionId: string;
  projectId: string;
  onClose: () => void;
}

export function AddToPlaylistModal({ shotId, versionId, projectId, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<PlaylistData[]>([]);
  const [mode, setMode] = useState<"select" | "create">("select");
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    void fetchPlaylists(projectId).then(setPlaylists);
  }, [projectId]);

  async function handleAddToExisting(playlistId: string) {
    setLoading(true);
    try {
      await addPlaylistItem(playlistId, { shotId, versionId, addedBy: "current-user" });
      setAdded(true);
      setTimeout(onClose, 800);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAndAdd() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const playlist = await createPlaylist(projectId, {
        name: newName.trim(),
        createdBy: "current-user",
        sessionDate: newDate,
      });
      await addPlaylistItem(playlist.id, { shotId, versionId, addedBy: "current-user" });
      setAdded(true);
      setTimeout(onClose, 800);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="add-to-playlist-modal"
    >
      <div className="bg-[var(--color-ah-surface)] border border-[var(--color-ah-border)] rounded-[var(--radius-ah-md)] shadow-lg w-96 max-h-[80vh] overflow-auto p-4">
        <h2 className="text-sm font-semibold mb-3">Add to Playlist</h2>

        {added ? (
          <p className="text-sm text-[var(--color-ah-success)]">Added successfully</p>
        ) : mode === "select" ? (
          <>
            {playlists.length > 0 ? (
              <ul className="space-y-1 mb-3">
                {playlists.map((pl) => (
                  <li key={pl.id}>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleAddToExisting(pl.id)}
                      className="w-full text-left px-3 py-2 text-sm rounded-[var(--radius-ah-sm)] hover:bg-[var(--color-ah-accent-muted)]/20 transition-colors"
                    >
                      <span className="font-medium">{pl.name}</span>
                      <span className="ml-2 text-xs text-[var(--color-ah-text-muted)]">{pl.sessionDate}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-ah-text-muted)] mb-3">No playlists yet</p>
            )}
            <button
              type="button"
              onClick={() => setMode("create")}
              className="w-full text-sm text-[var(--color-ah-accent)] hover:underline"
            >
              + Create new playlist
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Playlist Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Dailies 2026-03-13"
                className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
                data-testid="playlist-name-input"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Session Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("select")}
                className="text-sm px-3 py-1.5 border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={loading || !newName.trim()}
                onClick={handleCreateAndAdd}
                className="text-sm px-3 py-1.5 bg-[var(--color-ah-accent)] text-white rounded-[var(--radius-ah-sm)] disabled:opacity-50"
                data-testid="create-playlist-btn"
              >
                {loading ? "Creating..." : "Create & Add"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-[var(--color-ah-border)]">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ah-text-muted)] hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
