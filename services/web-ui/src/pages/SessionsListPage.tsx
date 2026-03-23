import { useEffect, useState } from "react";

import { fetchReviewSessions, createReviewSession, closeReviewSession } from "../api";
import type { ReviewSessionData } from "../api";
import { Badge, Button, Card } from "../design-system";

function statusVariant(status: ReviewSessionData["status"]) {
  switch (status) {
    case "active": return "success" as const;
    case "completed": return "default" as const;
    case "archived": return "default" as const;
  }
}

interface CreateSessionModalProps {
  onClose: () => void;
  onCreated: (session: ReviewSessionData) => void;
}

function CreateSessionModal({ onClose, onCreated }: CreateSessionModalProps) {
  const [projectId, setProjectId] = useState("");
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [sessionType, setSessionType] = useState<"dailies" | "client_review" | "final">("dailies");
  const [department, setDepartment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId.trim() || !sessionDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await createReviewSession({
        projectId: projectId.trim(),
        sessionDate,
        sessionType,
        department: department.trim() || undefined,
      });
      onCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="create-session-modal"
    >
      <div className="bg-[var(--color-ah-surface)] border border-[var(--color-ah-border)] rounded-[var(--radius-ah-md)] shadow-lg w-96 p-5">
        <h2 className="text-sm font-semibold mb-4">Create Review Session</h2>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Project ID</label>
            <input
              type="text"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="e.g. proj-abc123"
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="session-project-id-input"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Session Date</label>
            <input
              type="date"
              required
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="session-date-input"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Session Type</label>
            <select
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as typeof sessionType)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="session-type-select"
            >
              <option value="dailies">Dailies</option>
              <option value="client_review">Client Review</option>
              <option value="final">Final</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Department (optional)</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. comp, lighting"
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="session-department-input"
            />
          </div>
          {error && (
            <p className="text-xs text-[var(--color-ah-danger)]" role="alert">{error}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || !projectId.trim()}>
              {submitting ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SessionsListPage() {
  const [sessions, setSessions] = useState<ReviewSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  function loadSessions() {
    setLoading(true);
    void fetchReviewSessions().then((data) => {
      setSessions(data);
      setLoading(false);
    });
  }

  useEffect(() => {
    loadSessions();
  }, []);

  function handleCreated(session: ReviewSessionData) {
    setSessions((prev) => [session, ...prev]);
    setShowCreateModal(false);
  }

  async function handleClose(id: string) {
    setClosingId(id);
    try {
      const updated = await closeReviewSession(id);
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <section aria-label="Review sessions" className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Review Sessions</h1>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          Create Session
        </Button>
      </div>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        All review sessions across the project.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading sessions...</p>
      ) : sessions.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No review sessions found.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          <div className="grid grid-cols-[1fr_120px_80px_120px_120px_80px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
            <span>Session</span>
            <span>Created By</span>
            <span>Items</span>
            <span>Status</span>
            <span>Created</span>
            <span>Actions</span>
          </div>
          {sessions.map((session) => (
            <Card key={session.id} className="grid grid-cols-[1fr_120px_80px_120px_120px_80px] gap-4 items-center px-4 py-3">
              <span className="text-sm font-medium truncate">{session.name}</span>
              <span className="text-xs text-[var(--color-ah-text-muted)] truncate">{session.createdBy}</span>
              <span className="text-xs">{session.itemCount}</span>
              <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
              <span className="text-xs text-[var(--color-ah-text-muted)]">
                {new Date(session.createdAt).toLocaleDateString()}
              </span>
              <span>
                {session.status === "active" && (
                  <button
                    type="button"
                    disabled={closingId === session.id}
                    onClick={() => { void handleClose(session.id); }}
                    className="text-xs text-[var(--color-ah-danger)] hover:underline disabled:opacity-50 cursor-pointer"
                    data-testid={`close-session-${session.id}`}
                  >
                    {closingId === session.id ? "Closing..." : "Close"}
                  </button>
                )}
              </span>
            </Card>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateSessionModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </section>
  );
}
