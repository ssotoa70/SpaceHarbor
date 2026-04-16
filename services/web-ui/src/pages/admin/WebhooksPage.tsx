/**
 * Webhooks admin page — endpoints + delivery log.
 *
 * Two tabs:
 *   - Endpoints: list inbound/outbound, create new (plaintext secret
 *     returned ONCE — copy button), revoke.
 *   - Deliveries: outbound attempts with status, response code, retry count.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  listWebhookEndpoints, createWebhookEndpoint, revokeWebhookEndpoint,
  listWebhookDeliveries,
  type WebhookEndpoint, type WebhookDelivery, type WebhookDirection,
  type WebhookDeliveryStatus,
} from "../../api";

type Tab = "endpoints" | "deliveries";

export function WebhooksPage() {
  const [tab, setTab] = useState<Tab>("endpoints");

  return (
    <section aria-label="Webhooks" className="flex flex-col h-full gap-4">
      <header>
        <h1 className="text-xl font-bold">Webhooks</h1>
        <p className="text-sm text-[var(--color-ah-text-muted)]">
          HMAC-SHA256-signed HTTP integrations. Inbound endpoints verify signatures; outbound
          deliveries retry with exponential backoff.
        </p>
      </header>

      <div className="flex gap-1 border-b border-[var(--color-ah-border)]">
        {(["endpoints", "deliveries"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[var(--color-ah-accent)] text-[var(--color-ah-text)]"
                : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
            }`}
          >
            {t === "endpoints" ? "Endpoints" : "Delivery Log"}
          </button>
        ))}
      </div>

      {tab === "endpoints" ? <EndpointsTab /> : <DeliveriesTab />}
    </section>
  );
}

function EndpointsTab() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<{ endpoint: WebhookEndpoint; plaintext: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listWebhookEndpoints({ includeRevoked: true });
      setEndpoints(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const handleRevoke = useCallback(async (ep: WebhookEndpoint) => {
    if (!confirm(`Revoke "${ep.name}"? Existing secret will be invalidated.`)) return;
    try {
      await revokeWebhookEndpoint(ep.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    }
  }, [reload]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Endpoint</Button>
      </div>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Direction</th>
              <th className="px-3 py-2 text-left font-medium">URL</th>
              <th className="px-3 py-2 text-left font-medium">Secret Prefix</th>
              <th className="px-3 py-2 text-left font-medium">Last Used</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>}
            {!loading && endpoints.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No webhook endpoints yet.
              </td></tr>
            )}
            {endpoints.map((ep) => (
              <tr key={ep.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2 font-medium">{ep.name}</td>
                <td className="px-3 py-2"><Badge variant="info">{ep.direction}</Badge></td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs truncate max-w-[260px]">{ep.url ?? "—"}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-text-muted)]">{ep.secretPrefix}…</td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {ep.lastUsedAt ? new Date(ep.lastUsedAt).toLocaleString() : "never"}
                </td>
                <td className="px-3 py-2">
                  {ep.revokedAt ? <Badge variant="danger">revoked</Badge> : <Badge variant="success">active</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  {!ep.revokedAt && <Button variant="ghost" onClick={() => void handleRevoke(ep)}>Revoke</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showCreate && (
        <CreateEndpointDialog
          onCancel={() => setShowCreate(false)}
          onCreated={async (ep, plaintext) => {
            setShowCreate(false);
            setNewSecret({ endpoint: ep, plaintext });
            await reload();
          }}
        />
      )}
      {newSecret && (
        <SecretRevealDialog
          endpoint={newSecret.endpoint}
          plaintext={newSecret.plaintext}
          onClose={() => setNewSecret(null)}
        />
      )}
    </div>
  );
}

function CreateEndpointDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (ep: WebhookEndpoint, plaintext: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<WebhookDirection>("outbound");
  const [url, setUrl] = useState("");
  const [allowedEventTypesRaw, setAllowedEventTypesRaw] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() && (direction === "inbound" || url.trim());

  const handleSubmit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      const result = await createWebhookEndpoint({
        name: name.trim(),
        direction,
        url: direction === "outbound" ? url.trim() : undefined,
        allowedEventTypes: allowedEventTypesRaw.trim()
          ? allowedEventTypesRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        description: description.trim() || undefined,
      });
      await onCreated(result.endpoint, result.secret.plaintext);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }, [name, direction, url, allowedEventTypesRaw, description, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[500px] max-w-[95vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">New Webhook Endpoint</h3>

        {error && <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>}

        <div className="grid gap-3">
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </Field>
          <Field label="Direction">
            <select value={direction} onChange={(e) => setDirection(e.target.value as WebhookDirection)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]">
              <option value="outbound">outbound — SpaceHarbor calls this URL</option>
              <option value="inbound">inbound — SpaceHarbor accepts POSTs to /webhooks/&lt;id&gt;</option>
            </select>
          </Field>
          {direction === "outbound" && (
            <Field label="URL">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-xs" />
            </Field>
          )}
          <Field label="Allowed Event Types (comma-separated, optional)">
            <input type="text" value={allowedEventTypesRaw} onChange={(e) => setAllowedEventTypesRaw(e.target.value)}
              placeholder="checkin.committed, version.*"
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-xs" />
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
              Empty = deliver all event types. Wildcards supported.
            </p>
          </Field>
          <Field label="Description (optional)">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={submitting || !canSubmit}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SecretRevealDialog({
  endpoint,
  plaintext,
  onClose,
}: {
  endpoint: WebhookEndpoint;
  plaintext: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [plaintext]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[560px] max-w-[95vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-2">Secret for "{endpoint.name}"</h3>
        <p className="text-sm text-[var(--color-ah-text-muted)] mb-3">
          This secret is shown <strong>once only</strong>. Save it in your password manager or
          deployment secrets store. You won't be able to retrieve it again.
        </p>
        <div className="p-3 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] font-[var(--font-ah-mono)] text-xs break-all">
          {plaintext}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={handleCopy}>{copied ? "Copied!" : "Copy"}</Button>
          <Button variant="primary" onClick={onClose}>I've saved it</Button>
        </div>
      </Card>
    </div>
  );
}

function DeliveriesTab() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [statusFilter, setStatusFilter] = useState<WebhookDeliveryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const reload = useCallback(async (cursor?: string | null) => {
    setLoading(true);
    try {
      const r = await listWebhookDeliveries({
        status: statusFilter === "all" ? undefined : statusFilter,
        cursor: cursor ?? undefined,
        limit: 50,
      });
      setDeliveries(r.deliveries);
      setNextCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);
  useEffect(() => { setCursors([]); void reload(null); }, [reload]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[var(--color-ah-text-muted)]">Status:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as WebhookDeliveryStatus | "all")}
          className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)]">
          <option value="all">All</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
          <option value="in_flight">in_flight</option>
          <option value="pending">pending</option>
          <option value="abandoned">abandoned</option>
        </select>
      </div>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Event</th>
              <th className="px-3 py-2 text-left font-medium">URL</th>
              <th className="px-3 py-2 text-right font-medium">Attempt</th>
              <th className="px-3 py-2 text-right font-medium">HTTP</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>}
            {!loading && deliveries.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No deliveries yet.
              </td></tr>
            )}
            {deliveries.map((d) => (
              <tr key={d.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">{new Date(d.startedAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{d.eventType}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs truncate max-w-[260px]">{d.requestUrl ?? "—"}</td>
                <td className="px-3 py-2 text-right">{d.attemptNumber}</td>
                <td className="px-3 py-2 text-right">{d.responseStatus ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={
                    d.status === "succeeded" ? "success" :
                    d.status === "failed" ? "danger" :
                    d.status === "in_flight" ? "info" : "warning"
                  }>
                    {d.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-red-400 truncate max-w-[200px]">{d.lastError ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={cursors.length === 0} onClick={() => {
          const prev = cursors[cursors.length - 1] ?? null;
          setCursors(cursors.slice(0, -1));
          void reload(prev);
        }}>← Prev</Button>
        <Button variant="ghost" disabled={!nextCursor} onClick={() => {
          if (nextCursor) {
            setCursors([...cursors, nextCursor]);
            void reload(nextCursor);
          }
        }}>Next →</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
