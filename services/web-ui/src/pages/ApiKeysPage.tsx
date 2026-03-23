import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "../design-system";
import { fetchApiKeys, createApiKey, revokeApiKey } from "../api";
import type { ApiKeyData } from "../api";

/* ── Create Key Dialog ── */

function CreateKeyDialog({
  onCreated,
  onCancel,
}: {
  onCreated: (plaintext: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createApiKey(label.trim(), parseInt(expiresInDays, 10) || undefined);
      onCreated(result.plaintext);
    } catch {
      setError("Failed to create API key.");
    } finally {
      setSubmitting(false);
    }
  }, [label, expiresInDays, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[420px] max-w-[90vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Create API Key</h3>

        {error && (
          <div className="mb-3 p-2 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-danger)]/10 border border-[var(--color-ah-danger)]/30 text-sm text-[var(--color-ah-danger)]">
            {error}
          </div>
        )}

        <div className="grid gap-3 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Label</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              placeholder="e.g., Maya plugin, CI pipeline"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Expires in (days)</span>
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              min="1"
              max="3650"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={submitting || !label.trim()}
          >
            {submitting ? "Creating..." : "Create Key"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Show Plaintext Dialog ── */

function PlaintextDialog({ plaintext, onClose }: { plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [plaintext]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <Card className="w-[480px] max-w-[90vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-2">API Key Created</h3>
        <p className="text-sm text-[var(--color-ah-warning)] mb-3">
          Copy this key now. You will not be able to see it again.
        </p>
        <div className="p-3 bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] font-[var(--font-ah-mono)] text-xs break-all mb-4">
          {plaintext}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void handleCopy()}>
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Revoke Confirmation Dialog ── */

function RevokeDialog({
  keyLabel,
  onConfirm,
  onCancel,
}: {
  keyLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[400px] max-w-[90vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">Revoke API Key</h3>
        <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
          Are you sure you want to revoke <strong>{keyLabel}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Revoke</Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Main Page ── */

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyData | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const result = await fetchApiKeys();
    setKeys(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleCreated = useCallback((pt: string) => {
    setShowCreate(false);
    setPlaintext(pt);
    void loadKeys();
  }, [loadKeys]);

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    await revokeApiKey(revokeTarget.id);
    setRevokeTarget(null);
    void loadKeys();
  }, [revokeTarget, loadKeys]);

  return (
    <section aria-label="API Key Management" className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Manage API keys for automation and DCC plugin access.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          Create Key
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading...</p>
      ) : keys.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] text-center py-4">
            No API keys yet. Create one to get started.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {keys.map((key) => (
            <Card key={key.id}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{key.label}</span>
                    <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                      {key.prefix}...
                    </span>
                    {key.revokedAt && (
                      <span className="text-xs text-[var(--color-ah-danger)]">revoked</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-ah-text-muted)]">
                    <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                    {key.expiresAt && <span>Expires: {new Date(key.expiresAt).toLocaleDateString()}</span>}
                    {key.lastUsedAt && <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                {!key.revokedAt && (
                  <Button variant="destructive" onClick={() => setRevokeTarget(key)}>
                    Revoke
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateKeyDialog onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
      )}

      {plaintext && (
        <PlaintextDialog plaintext={plaintext} onClose={() => setPlaintext(null)} />
      )}

      {revokeTarget && (
        <RevokeDialog
          keyLabel={revokeTarget.label}
          onConfirm={() => void handleRevoke()}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </section>
  );
}
