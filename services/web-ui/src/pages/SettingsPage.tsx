import { useState, useEffect, useCallback } from "react";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import {
  fetchPlatformSettings,
  savePlatformSettings,
  testServiceConnection,
  deploySchema,
  fetchSchemaStatus,
} from "../api";
import type {
  PlatformSettings,
  S3EndpointConfig,
  ConnectionTestResult,
  SchemaStatus,
} from "../api";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: "ok" | "error" | "warn" | "off" }) {
  const color =
    status === "ok"
      ? "var(--color-ah-success)"
      : status === "error"
        ? "var(--color-ah-danger)"
        : status === "warn"
          ? "var(--color-ah-warning)"
          : "var(--color-ah-text-subtle)";

  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

function statusToBadge(
  status: string,
): { label: string; variant: "success" | "danger" | "warning" | "default" } {
  switch (status) {
    case "connected":
    case "ok":
      return { label: "Connected", variant: "success" };
    case "disconnected":
    case "error":
      return { label: "Disconnected", variant: "danger" };
    case "not_configured":
      return { label: "Not Configured", variant: "warning" };
    default:
      return { label: status, variant: "default" };
  }
}

function SectionCard({
  title,
  iconPath,
  status,
  children,
}: {
  title: string;
  iconPath: string;
  status: string;
  children: React.ReactNode;
}) {
  const badge = statusToBadge(status);
  const dotStatus =
    badge.variant === "success"
      ? "ok"
      : badge.variant === "danger"
        ? "error"
        : badge.variant === "warning"
          ? "warn"
          : "off";

  return (
    <div
      className="bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-lg)] p-5"
      data-testid={`settings-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--color-ah-accent)]"
          >
            <path d={iconPath} />
          </svg>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={dotStatus} />
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--color-ah-text-subtle)] min-w-[120px] shrink-0">{label}:</span>
      <span className="font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-text-muted)] break-all">
        {value ?? "--"}
      </span>
    </div>
  );
}

const inputClass = "w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] font-[var(--font-ah-mono)]";
const labelClass = "text-xs font-medium text-[var(--color-ah-text-muted)] mb-1 block";

function ConfigInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="confirm-dialog">
      <div className="bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-lg)] p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S3 Endpoint Editor
// ---------------------------------------------------------------------------

function newS3Endpoint(): S3EndpointConfig {
  return {
    id: crypto.randomUUID(),
    label: "",
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    region: "us-east-1",
    useSsl: true,
    pathStyle: true,
  };
}

function S3EndpointRow({
  ep,
  onChange,
  onRemove,
  onTest,
  testing,
}: {
  ep: S3EndpointConfig;
  onChange: (updated: S3EndpointConfig) => void;
  onRemove: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const set = (field: keyof S3EndpointConfig, value: string | boolean) =>
    onChange({ ...ep, [field]: value });

  return (
    <div className="border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-md)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">
          {ep.label || "Unnamed Endpoint"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-[var(--color-ah-danger)] hover:underline cursor-pointer"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ConfigInput label="Label" value={ep.label} onChange={(v) => set("label", v)} placeholder="e.g. Production Media" />
        <ConfigInput label="Region" value={ep.region} onChange={(v) => set("region", v)} placeholder="us-east-1" />
        <ConfigInput label="S3 Endpoint URL" value={ep.endpoint} onChange={(v) => set("endpoint", v)} placeholder="https://vast-vip.example.com" />
        <ConfigInput label="Bucket" value={ep.bucket} onChange={(v) => set("bucket", v)} placeholder="media-assets" />
        <ConfigInput label="Access Key ID" value={ep.accessKeyId} onChange={(v) => set("accessKeyId", v)} placeholder="VAST S3 access key" />
        <ConfigInput
          label="Secret Access Key"
          value={ep.secretAccessKey ?? ""}
          onChange={(v) => set("secretAccessKey", v)}
          placeholder={ep.secretAccessKey === undefined ? "••••••  (previously set)" : "Enter secret key"}
          type="password"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ah-text-muted)] cursor-pointer">
          <input type="checkbox" checked={ep.useSsl} onChange={(e) => set("useSsl", e.target.checked)} className="accent-[var(--color-ah-accent)]" />
          SSL/TLS
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ah-text-muted)] cursor-pointer">
          <input type="checkbox" checked={ep.pathStyle} onChange={(e) => set("pathStyle", e.target.checked)} className="accent-[var(--color-ah-accent)]" />
          Path-style (required for VAST)
        </label>
        <div className="ml-auto">
          <Button variant="secondary" disabled={testing} onClick={onTest}>
            {testing ? "Testing..." : "Test"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only env-var display helper
// ---------------------------------------------------------------------------

function EnvVarDisplay({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-subtle,var(--color-ah-bg))] px-3 py-2 text-sm text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)] break-all">
        {value ?? "Configured via environment variable"}
      </div>
      <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-0.5">
        This setting is configured via environment variables. See deployment guide.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [schemaStatus, setSchemaStatus] = useState<SchemaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Editable form state for VAST services (only fields backed by PlatformSettings)
  const [dbEndpoint, setDbEndpoint] = useState("");
  const [dbVmsVip, setDbVmsVip] = useState("");
  const [dbCnodeVips, setDbCnodeVips] = useState("");
  const [dbAccessKeyId, setDbAccessKeyId] = useState("");
  const [brokerUrl, setBrokerUrl] = useState("");
  const [brokerTopic, setBrokerTopic] = useState("");
  const [deUrl, setDeUrl] = useState("");
  const [deTenant, setDeTenant] = useState("");
  const [s3Endpoints, setS3Endpoints] = useState<S3EndpointConfig[]>([]);

  // Connection test state
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // Schema deploy state
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployMessage, setDeployMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, ss] = await Promise.all([
        fetchPlatformSettings(),
        fetchSchemaStatus(),
      ]);
      setSettings(s);
      setSchemaStatus(ss);
      // Populate editable fields (only fields backed by PlatformSettings API)
      setDbEndpoint(s.vastDatabase.endpoint ?? "");
      setDbVmsVip(s.vastDatabase.vmsVip ?? "");
      setDbCnodeVips(s.vastDatabase.cnodeVips ?? "");
      setDbAccessKeyId(s.vastDatabase.accessKeyId ?? "");
      setBrokerUrl(s.vastEventBroker.brokerUrl ?? "");
      setBrokerTopic(s.vastEventBroker.topic ?? "");
      setDeUrl(s.vastDataEngine.url ?? "");
      setDeTenant(s.vastDataEngine.tenant ?? "");
      setS3Endpoints(s.storage.endpoints ?? (s.storage.s3Endpoint ? [{
        id: "default",
        label: "Default",
        endpoint: s.storage.s3Endpoint,
        bucket: s.storage.s3Bucket ?? "",
        accessKeyId: "",
        region: "us-east-1",
        useSsl: true,
        pathStyle: true,
      }] : []));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const markDirty = () => setDirty(true);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await savePlatformSettings({
        vastDatabase: {
          ...settings.vastDatabase,
          endpoint: dbEndpoint || null,
          vmsVip: dbVmsVip || null,
          cnodeVips: dbCnodeVips || null,
          accessKeyId: dbAccessKeyId || null,
        },
        vastEventBroker: { ...settings.vastEventBroker, brokerUrl: brokerUrl || null, topic: brokerTopic || null },
        vastDataEngine: { ...settings.vastDataEngine, url: deUrl || null, tenant: deTenant || null },
        storage: {
          ...settings.storage,
          endpoints: s3Endpoints,
          s3Endpoint: s3Endpoints[0]?.endpoint ?? null,
          s3Bucket: s3Endpoints[0]?.bucket ?? null,
        },
      });
      setSettings(updated);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [settings, dbEndpoint, dbVmsVip, dbCnodeVips, dbAccessKeyId, brokerUrl, brokerTopic, deUrl, deTenant, s3Endpoints]);

  const handleTestConnection = useCallback(async (service: string) => {
    setTestingService(service);
    setTestResult(null);
    try {
      const result = await testServiceConnection(service);
      setTestResult(result);
    } catch {
      setTestResult({ service, status: "error", message: "Request failed" });
    } finally {
      setTestingService(null);
    }
  }, []);

  const handleDeploySchema = useCallback(async () => {
    setConfirmDeploy(false);
    setDeploying(true);
    setDeployMessage(null);
    try {
      const result = await deploySchema();
      setDeployMessage(
        result.status === "ok"
          ? result.message
          : `Error: ${result.message}`,
      );
      await loadData();
    } catch (err) {
      setDeployMessage(`Deploy failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDeploying(false);
    }
  }, [loadData]);

  const addS3Endpoint = () => {
    setS3Endpoints((prev) => [...prev, newS3Endpoint()]);
    markDirty();
  };

  const updateS3Endpoint = (id: string, updated: S3EndpointConfig) => {
    setS3Endpoints((prev) => prev.map((ep) => ep.id === id ? updated : ep));
    markDirty();
  };

  const removeS3Endpoint = (id: string) => {
    setS3Endpoints((prev) => prev.filter((ep) => ep.id !== id));
    markDirty();
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto" data-testid="settings-loading">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 bg-[var(--color-ah-bg-raised)] rounded-[var(--radius-ah-lg)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto" data-testid="settings-error">
        <div className="bg-[var(--color-ah-danger-muted)]/20 border border-[var(--color-ah-danger-muted)] rounded-[var(--radius-ah-lg)] p-5 text-[var(--color-ah-danger)]">
          <p className="font-medium">Failed to load platform settings</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void loadData()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  const TestResultBanner = testResult ? (
    <div
      className={`mb-4 p-3 rounded-[var(--radius-ah-md)] text-sm flex items-center gap-2 ${
        testResult.status === "ok"
          ? "bg-[var(--color-ah-success-muted)]/20 text-[var(--color-ah-success)] border border-[var(--color-ah-success-muted)]"
          : "bg-[var(--color-ah-danger-muted)]/20 text-[var(--color-ah-danger)] border border-[var(--color-ah-danger-muted)]"
      }`}
      data-testid="test-result-banner"
    >
      <StatusDot status={testResult.status === "ok" ? "ok" : "error"} />
      <span className="font-medium">{testResult.service}:</span>
      <span>{testResult.message}</span>
      <button
        className="ml-auto text-xs opacity-60 hover:opacity-100 cursor-pointer"
        onClick={() => setTestResult(null)}
      >
        Dismiss
      </button>
    </div>
  ) : null;

  const DeployBanner = deployMessage ? (
    <div
      className={`mb-4 p-3 rounded-[var(--radius-ah-md)] text-sm flex items-center gap-2 ${
        deployMessage.startsWith("Error") || deployMessage.startsWith("Deploy failed")
          ? "bg-[var(--color-ah-danger-muted)]/20 text-[var(--color-ah-danger)] border border-[var(--color-ah-danger-muted)]"
          : "bg-[var(--color-ah-success-muted)]/20 text-[var(--color-ah-success)] border border-[var(--color-ah-success-muted)]"
      }`}
      data-testid="deploy-result-banner"
    >
      <span>{deployMessage}</span>
      <button
        className="ml-auto text-xs opacity-60 hover:opacity-100 cursor-pointer"
        onClick={() => setDeployMessage(null)}
      >
        Dismiss
      </button>
    </div>
  ) : null;

  return (
    <div className="max-w-4xl mx-auto" data-testid="settings-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Platform Settings</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Configure service connections for this SpaceHarbor instance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Badge variant="warning">Unsaved</Badge>
          )}
          <Button variant="secondary" onClick={() => void loadData()}>
            Refresh
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {TestResultBanner}
      {DeployBanner}

      <ConfirmDialog
        open={confirmDeploy}
        title="Deploy Schema Migrations"
        message={`This will apply ${schemaStatus?.pending.length ?? 0} pending migration(s) to the database. This action cannot be undone.`}
        onConfirm={() => void handleDeploySchema()}
        onCancel={() => setConfirmDeploy(false)}
      />

      <div className="grid gap-4">
        {/* 1. VAST Database (Trino) */}
        <SectionCard
          title="VAST Database (Trino)"
          iconPath="M2 4c0-1.1 2.7-2 6-2s6 .9 6 2v8c0 1.1-2.7 2-6 2s-6-.9-6-2V4zM2 7c0 1.1 2.7 2 6 2s6-.9 6-2M2 10c0 1.1 2.7 2 6 2s6-.9 6-2"
          status={settings.vastDatabase.configured ? settings.vastDatabase.status : "not_configured"}
        >
          <div className="grid grid-cols-2 gap-3">
            <ConfigInput
              label="Trino Coordinator URL"
              value={dbEndpoint}
              onChange={(v) => { setDbEndpoint(v); markDirty(); }}
              placeholder="http://trino-coordinator:8080"
            />
            <ConfigInput
              label="VAST Endpoint (VMS VIP)"
              value={dbVmsVip}
              onChange={(v) => { setDbVmsVip(v); markDirty(); }}
              placeholder="192.168.1.10"
            />
            <ConfigInput
              label="Data Endpoints (CNode VIPs)"
              value={dbCnodeVips}
              onChange={(v) => { setDbCnodeVips(v); markDirty(); }}
              placeholder="192.168.1.20,192.168.1.21"
            />
            <ConfigInput
              label="Access Key ID"
              value={dbAccessKeyId}
              onChange={(v) => { setDbAccessKeyId(v); markDirty(); }}
              placeholder="VAST access key ID"
            />
          </div>
          {schemaStatus && (
            <div className="mt-2 space-y-1">
              <ConfigRow
                label="Schema Version"
                value={`${schemaStatus.currentVersion} / ${schemaStatus.availableMigrations}`}
              />
              <ConfigRow
                label="Tables"
                value={settings.vastDatabase.tablesDeployed ? "Deployed" : "Not deployed"}
              />
              {!schemaStatus.upToDate && (
                <Badge variant="warning">{schemaStatus.pending.length} pending migrations</Badge>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-ah-border-muted)]">
            <Button
              variant="secondary"
              disabled={testingService === "vast_database"}
              onClick={() => void handleTestConnection("vast_database")}
            >
              {testingService === "vast_database" ? "Testing..." : "Test Connection"}
            </Button>
            <Button
              variant="primary"
              disabled={deploying || !settings.vastDatabase.configured}
              onClick={() => setConfirmDeploy(true)}
            >
              {deploying ? "Deploying..." : "Deploy Schema"}
            </Button>
            <span className="ml-auto text-[10px] text-[var(--color-ah-text-subtle)]">
              Tests: GET /v1/info + SHOW CATALOGS
            </span>
          </div>
        </SectionCard>

        {/* 2. VAST Event Broker */}
        <SectionCard
          title="VAST Event Broker"
          iconPath="M2 3h12v3H2zM2 10h12v3H2zM5 6v4M8 6v4M11 6v4"
          status={settings.vastEventBroker.status}
        >
          <div className="grid grid-cols-2 gap-3">
            <ConfigInput
              label="Broker URL"
              value={brokerUrl}
              onChange={(v) => { setBrokerUrl(v); markDirty(); }}
              placeholder="kafka://vast-vip:9092"
            />
            <ConfigInput
              label="Topic"
              value={brokerTopic}
              onChange={(v) => { setBrokerTopic(v); markDirty(); }}
              placeholder="spaceharbor-events"
            />
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-ah-border-muted)]">
            <Button
              variant="secondary"
              disabled={testingService === "event_broker"}
              onClick={() => void handleTestConnection("event_broker")}
            >
              {testingService === "event_broker" ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </SectionCard>

        {/* 3. VAST DataEngine */}
        <SectionCard
          title="VAST DataEngine"
          iconPath="M4 2v12M12 2v12M4 8h8M2 4h4M10 4h4M2 12h4M10 12h4"
          status={settings.vastDataEngine.status}
        >
          <div className="grid grid-cols-2 gap-3">
            <ConfigInput
              label="DataEngine / VMS URL"
              value={deUrl}
              onChange={(v) => { setDeUrl(v); markDirty(); }}
              placeholder="https://vast-vip.example.com"
            />
            <ConfigInput
              label="Tenant Name"
              value={deTenant}
              onChange={(v) => { setDeTenant(v); markDirty(); }}
              placeholder="default"
            />
          </div>
          <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-1">
            DataEngine uses S3 access keys for authentication. Configure triggers and functions via the DataEngine web UI or CLI.
          </p>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-ah-border-muted)]">
            <Button
              variant="secondary"
              disabled={testingService === "data_engine"}
              onClick={() => void handleTestConnection("data_engine")}
            >
              {testingService === "data_engine" ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </SectionCard>

        {/* 4. Object Storage (S3) — Multi-endpoint */}
        <SectionCard
          title="Object Storage (S3)"
          iconPath="M3 3h10v10H3zM7 3v10M3 7h10"
          status={s3Endpoints.length > 0 ? "connected" : "not_configured"}
        >
          <p className="text-xs text-[var(--color-ah-text-muted)] mb-3">
            Configure one or more S3-compatible endpoints. VAST requires path-style addressing and SigV4 signatures.
          </p>

          <div className="space-y-3">
            {s3Endpoints.map((ep) => (
              <S3EndpointRow
                key={ep.id}
                ep={ep}
                onChange={(updated) => updateS3Endpoint(ep.id, updated)}
                onRemove={() => removeS3Endpoint(ep.id)}
                onTest={() => void handleTestConnection(`s3:${ep.id}`)}
                testing={testingService === `s3:${ep.id}`}
              />
            ))}
          </div>

          <Button variant="secondary" onClick={addS3Endpoint} className="mt-3">
            + Add S3 Endpoint
          </Button>
        </SectionCard>

        {/* 5. Authentication & IAM */}
        <SectionCard
          title="Authentication & IAM"
          iconPath="M8 2a3 3 0 100 6 3 3 0 000-6zM4 14c0-2.2 1.8-4 4-4s4 1.8 4 4"
          status={settings.authentication.iamEnabled ? "connected" : "not_configured"}
        >
          <ConfigRow label="Auth Mode" value={settings.authentication.mode.toUpperCase()} />
          <ConfigRow
            label="IAM Enabled"
            value={settings.authentication.iamEnabled ? "Yes" : "No"}
          />
          <ConfigRow
            label="Shadow Mode"
            value={settings.authentication.shadowMode ? "Yes" : "No"}
          />
          <ConfigRow label="Rollout Ring" value={settings.authentication.rolloutRing} />
          {settings.authentication.mode === "oidc" && (
            <>
              <ConfigRow label="OIDC Issuer" value={settings.authentication.oidcIssuer} />
              <ConfigRow label="JWKS URI" value={settings.authentication.jwksUri} />
            </>
          )}
        </SectionCard>

        {/* 6. SCIM User Sync */}
        <SectionCard
          title="SCIM User Sync"
          iconPath="M5 3a2 2 0 100 4 2 2 0 000-4zM11 3a2 2 0 100 4 2 2 0 000-4zM3 13c0-1.7 1-3 2.5-3h5c1.5 0 2.5 1.3 2.5 3"
          status={settings.scim.enabled ? (settings.scim.configured ? "connected" : "not_configured") : "not_configured"}
        >
          <ConfigRow
            label="Enabled"
            value={settings.scim.enabled ? "Yes" : "No"}
          />
          <ConfigRow
            label="Configured"
            value={settings.scim.configured ? "Yes" : "No"}
          />
        </SectionCard>
      </div>
    </div>
  );
}
