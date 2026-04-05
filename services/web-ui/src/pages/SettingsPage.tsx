import { useState, useEffect, useCallback } from "react";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Card } from "../design-system/Card";
import { PermissionGate } from "../components/PermissionGate";
import { generateId } from "../utils/id";
import {
  fetchPlatformSettings,
  savePlatformSettings,
  testServiceConnection,
  deploySchema,
  fetchSchemaStatus,
  fetchIamSettings,
  saveIamSettings,
  fetchLdapSettings,
  saveLdapSettings,
  testLdapConnection,
  fetchScimSettings,
  saveScimSettings,
  generateScimToken,
  fetchRbacMatrix,
} from "../api";
import type {
  PlatformSettings,
  S3EndpointConfig,
  NfsConnectorConfig,
  SmbConnectorConfig,
  ConnectionTestResult,
  SchemaStatus,
  IamSettings,
  RbacMatrix,
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
    id: generateId(),
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
// S3 section — manages its own inline test results
// ---------------------------------------------------------------------------

function S3Section({
  endpoints,
  onUpdate,
  onRemove,
  onAdd,
  onSaveBeforeTest,
}: {
  endpoints: S3EndpointConfig[];
  onUpdate: (id: string, updated: S3EndpointConfig) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onSaveBeforeTest: () => Promise<void>;
}) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setS3TestResult] = useState<{ id: string; status: string; message: string } | null>(null);

  const handleTest = async (epId: string) => {
    setTestingId(epId);
    setS3TestResult(null);
    try {
      // Save current config first so the backend has the latest endpoint data
      await onSaveBeforeTest();
      const result = await testServiceConnection(`s3:${epId}`);
      setS3TestResult({ id: epId, status: result.status, message: result.message });
    } catch {
      setS3TestResult({ id: epId, status: "error", message: "Connection test failed" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <SectionCard
      title="Object Storage (S3)"
      iconPath="M3 3h10v10H3zM7 3v10M3 7h10"
      status={endpoints.length > 0 ? "connected" : "not_configured"}
    >
      <p className="text-xs text-[var(--color-ah-text-muted)] mb-3">
        Configure one or more S3-compatible endpoints. VAST requires path-style addressing and SigV4 signatures.
      </p>

      <div className="space-y-3">
        {endpoints.map((ep) => (
          <div key={ep.id}>
            <S3EndpointRow
              ep={ep}
              onChange={(updated) => onUpdate(ep.id, updated)}
              onRemove={() => onRemove(ep.id)}
              onTest={() => void handleTest(ep.id)}
              testing={testingId === ep.id}
            />
            {testResult && testResult.id === ep.id && (
              <div className={`mt-2 p-2 rounded text-xs border ${
                testResult.status === "ok"
                  ? "bg-[var(--color-ah-success-bg,#0d3320)] border-[var(--color-ah-success,#22c55e)] text-[var(--color-ah-success,#22c55e)]"
                  : "bg-red-900/30 border-red-500 text-red-400"
              }`}>
                {testResult.message}
              </div>
            )}
          </div>
        ))}
      </div>

      <Button variant="secondary" onClick={onAdd} className="mt-3">
        + Add S3 Endpoint
      </Button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// SCIM section — manages its own inline token display
// ---------------------------------------------------------------------------

function ScimSection({ settings }: { settings: PlatformSettings }) {
  const [scimToken, setScimToken] = useState<string | null>(null);
  const [scimError, setScimError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  return (
    <SectionCard
      title="SCIM User Provisioning"
      iconPath="M5 3a2 2 0 100 4 2 2 0 000-4zM11 3a2 2 0 100 4 2 2 0 000-4zM3 13c0-1.7 1-3 2.5-3h5c1.5 0 2.5 1.3 2.5 3"
      status={settings.scim.enabled ? (settings.scim.configured ? "connected" : "not_configured") : "not_configured"}
    >
      <ConfigRow label="Enabled" value={settings.scim.enabled ? "Yes" : "No"} />
      <ConfigRow label="Token Configured" value={settings.scim.configured ? "Yes" : "No"} />

      {scimToken && (
        <div className="mt-3 p-3 rounded bg-[var(--color-ah-success-bg,#0d3320)] border border-[var(--color-ah-success,#22c55e)]">
          <p className="text-xs font-semibold text-[var(--color-ah-success,#22c55e)] mb-1">SCIM Token Generated</p>
          <code className="block text-xs break-all bg-black/30 p-2 rounded select-all">{scimToken}</code>
          <p className="text-xs text-[var(--color-ah-text-muted)] mt-1">Copy this token now. You will not be able to see it again.</p>
        </div>
      )}

      {scimError && (
        <div className="mt-3 p-2 rounded bg-red-900/30 border border-red-500 text-xs text-red-400">
          {scimError}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <Button variant="secondary" disabled={generating} onClick={async () => {
          setGenerating(true);
          setScimToken(null);
          setScimError(null);
          try {
            const r = await generateScimToken();
            setScimToken(r.token);
          } catch {
            setScimError("Token generation failed");
          } finally {
            setGenerating(false);
          }
        }}>{generating ? "Generating..." : "Generate SCIM Token"}</Button>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function SettingsContent() {
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
  const [dbSecretKey, setDbSecretKey] = useState("");
  const [dbBucket, setDbBucket] = useState("");
  const [dbSchema, setDbSchema] = useState("");
  const [brokerUrl, setBrokerUrl] = useState("");
  const [brokerTopic, setBrokerTopic] = useState("");
  const [deUrl, setDeUrl] = useState("");
  const [deTenant, setDeTenant] = useState("");
  const [deUsername, setDeUsername] = useState("");
  const [dePassword, setDePassword] = useState("");
  const [s3Endpoints, setS3Endpoints] = useState<S3EndpointConfig[]>([]);

  // Connection test state — per-section inline results
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});

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
      setDbSecretKey(s.vastDatabase.hasSecretKey ? "--------" : "");
      setDbBucket(s.vastDatabase.bucket ?? "");
      setDbSchema(s.vastDatabase.schema ?? "");
      setBrokerUrl(s.vastEventBroker.brokerUrl ?? "");
      setBrokerTopic(s.vastEventBroker.topic ?? "");
      setDeUrl(s.vastDataEngine.url ?? "");
      setDeTenant(s.vastDataEngine.tenant ?? "");
      setDeUsername(s.vastDataEngine.username ?? "");
      setDePassword(s.vastDataEngine.hasPassword ? "--------" : "");
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
          bucket: dbBucket || null,
          schema: dbSchema || null,
          // Only send secretKey if user actually changed it (not the masked placeholder)
          ...(dbSecretKey && dbSecretKey !== "--------" ? { secretKey: dbSecretKey } : {}),
        },
        vastEventBroker: { ...settings.vastEventBroker, brokerUrl: brokerUrl || null, topic: brokerTopic || null },
        vastDataEngine: {
          ...settings.vastDataEngine,
          url: deUrl || null,
          tenant: deTenant || null,
          username: deUsername || null,
          // Only send password if user actually changed it (not the masked placeholder)
          ...(dePassword && dePassword !== "--------" ? { password: dePassword } : {}),
        },
        storage: {
          ...settings.storage,
          endpoints: s3Endpoints,
          s3Endpoint: s3Endpoints[0]?.endpoint ?? null,
          s3Bucket: s3Endpoints[0]?.bucket ?? null,
          nfsConnectors: settings.storage?.nfsConnectors ?? [],
          smbConnectors: settings.storage?.smbConnectors ?? [],
        },
      });
      setSettings(updated);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [settings, dbEndpoint, dbVmsVip, dbCnodeVips, dbAccessKeyId, dbSecretKey, dbBucket, dbSchema, brokerUrl, brokerTopic, deUrl, deTenant, deUsername, dePassword, s3Endpoints]);

  const handleTestConnection = useCallback(async (service: string) => {
    setTestingService(service);
    // Clear previous result for this service
    setTestResults((prev) => { const next = { ...prev }; delete next[service]; return next; });
    try {
      const result = await testServiceConnection(service);
      setTestResults((prev) => ({ ...prev, [service]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [service]: { service, status: "error", message: "Request failed" } }));
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

  /** Inline test result rendered below each section's Test Connection button. */
  function InlineTestResult({ service }: { service: string }) {
    const result = testResults[service];
    if (!result) return null;
    return (
      <div
        className={`mt-2 p-2 rounded-[var(--radius-ah-sm)] text-xs flex items-center gap-2 ${
          result.status === "ok"
            ? "bg-[var(--color-ah-success)]/10 text-[var(--color-ah-success)] border border-[var(--color-ah-success)]/30"
            : "bg-[var(--color-ah-danger)]/10 text-[var(--color-ah-danger)] border border-[var(--color-ah-danger)]/30"
        }`}
        data-testid={`test-result-${service}`}
      >
        <StatusDot status={result.status === "ok" ? "ok" : "error"} />
        <span>{result.message}</span>
      </div>
    );
  }

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

      {DeployBanner}

      <ConfirmDialog
        open={confirmDeploy}
        title="Deploy Schema Migrations"
        message={`This will apply ${schemaStatus?.pending.length ?? 0} pending migration(s) to the database. This action cannot be undone.`}
        onConfirm={() => void handleDeploySchema()}
        onCancel={() => setConfirmDeploy(false)}
      />

      <div className="grid gap-4">
        {/* 1. VAST Database */}
        <SectionCard
          title="VAST Database"
          iconPath="M2 4c0-1.1 2.7-2 6-2s6 .9 6 2v8c0 1.1-2.7 2-6 2s-6-.9-6-2V4zM2 7c0 1.1 2.7 2 6 2s6-.9 6-2M2 10c0 1.1 2.7 2 6 2s6-.9 6-2"
          status={settings.vastDatabase.configured ? settings.vastDatabase.status : "not_configured"}
        >
          <div className="grid grid-cols-2 gap-3">
            <ConfigInput
              label="Database Endpoint URL"
              value={dbEndpoint}
              onChange={(v) => { setDbEndpoint(v); markDirty(); }}
              placeholder="https://<VAST_VIP>:8443"
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
            <ConfigInput
              label="Secret Access Key"
              value={dbSecretKey}
              onChange={(v) => { setDbSecretKey(v); markDirty(); }}
              placeholder="Enter secret access key"
              type="password"
            />
            <ConfigInput
              label="Database Bucket"
              value={dbBucket}
              onChange={(v) => { setDbBucket(v); markDirty(); }}
              placeholder="sergio-db"
            />
            <ConfigInput
              label="Schema Name"
              value={dbSchema}
              onChange={(v) => { setDbSchema(v); markDirty(); }}
              placeholder="spaceharbor"
            />
          </div>
          <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-1">
            The VAST Endpoint (VMS VIP) is used for schema deployment via the VAST Database SDK. The bucket must be a Database-enabled view with S3 and DATABASE protocols.
          </p>
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
              Tests: SELECT 1 via VAST Database SQL endpoint
            </span>
          </div>
          <InlineTestResult service="vast_database" />
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
          <InlineTestResult service="event_broker" />
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
          <div className="grid grid-cols-2 gap-3 mt-3">
            <ConfigInput
              label="VMS Username"
              value={deUsername}
              onChange={(v) => { setDeUsername(v); markDirty(); }}
              placeholder="admin"
            />
            <ConfigInput
              label="VMS Password"
              value={dePassword}
              onChange={(v) => { setDePassword(v); markDirty(); }}
              placeholder="Enter VMS password"
              type="password"
            />
          </div>
          <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-1">
            VMS credentials are used to authenticate with the VAST DataEngine management API. Manage functions, triggers, and pipelines directly from SpaceHarbor.
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
          <InlineTestResult service="data_engine" />
        </SectionCard>

        {/* 4. Object Storage (S3) — Multi-endpoint */}
        <S3Section
          endpoints={s3Endpoints}
          onUpdate={updateS3Endpoint}
          onRemove={removeS3Endpoint}
          onAdd={addS3Endpoint}
          onSaveBeforeTest={handleSave}
        />

        {/* 5. Storage Connectors (NFS / SMB) */}
        <SectionCard
          title="Storage Connectors (NFS / SMB)"
          iconPath="M3 6h10v6H3zM6 6V3M9 6V3"
          status={(settings.storage?.nfsConnectors?.length || settings.storage?.smbConnectors?.length) ? "connected" : "not_configured"}
        >
          <p className="text-xs text-[var(--color-ah-text-muted)] mb-3">
            Configure NFS and SMB mount points for accessing VAST Element Store or network shares.
          </p>

          <h4 className="text-xs font-semibold mb-2">NFS Exports</h4>
          {(settings.storage?.nfsConnectors ?? []).map((c, i) => (
            <div key={c.id || i} className="grid grid-cols-3 gap-2 mb-2 text-xs">
              <ConfigInput label="Label" value={c.label} onChange={(v) => { const arr = [...(settings.storage?.nfsConnectors ?? [])]; arr[i] = { ...c, label: v }; setSettings({ ...settings, storage: { ...settings.storage, nfsConnectors: arr } }); markDirty(); }} />
              <ConfigInput label="Export Path" value={c.exportPath} onChange={(v) => { const arr = [...(settings.storage?.nfsConnectors ?? [])]; arr[i] = { ...c, exportPath: v }; setSettings({ ...settings, storage: { ...settings.storage, nfsConnectors: arr } }); markDirty(); }} />
              <ConfigInput label="Mount Point" value={c.mountPoint} onChange={(v) => { const arr = [...(settings.storage?.nfsConnectors ?? [])]; arr[i] = { ...c, mountPoint: v }; setSettings({ ...settings, storage: { ...settings.storage, nfsConnectors: arr } }); markDirty(); }} />
            </div>
          ))}
          <Button variant="secondary" className="text-xs mb-3" onClick={() => {
            const arr = [...(settings.storage?.nfsConnectors ?? [])];
            arr.push({ id: generateId(), label: "", exportPath: "", mountPoint: "", version: "4.1", options: "" });
            setSettings({ ...settings, storage: { ...settings.storage, nfsConnectors: arr } }); markDirty();
          }}>+ Add NFS Export</Button>

          <h4 className="text-xs font-semibold mb-2">SMB Shares</h4>
          {(settings.storage?.smbConnectors ?? []).map((c, i) => (
            <div key={c.id || i} className="grid grid-cols-3 gap-2 mb-2 text-xs">
              <ConfigInput label="Label" value={c.label} onChange={(v) => { const arr = [...(settings.storage?.smbConnectors ?? [])]; arr[i] = { ...c, label: v }; setSettings({ ...settings, storage: { ...settings.storage, smbConnectors: arr } }); markDirty(); }} />
              <ConfigInput label="Share Path" value={c.sharePath} onChange={(v) => { const arr = [...(settings.storage?.smbConnectors ?? [])]; arr[i] = { ...c, sharePath: v }; setSettings({ ...settings, storage: { ...settings.storage, smbConnectors: arr } }); markDirty(); }} />
              <ConfigInput label="Domain" value={c.domain} onChange={(v) => { const arr = [...(settings.storage?.smbConnectors ?? [])]; arr[i] = { ...c, domain: v }; setSettings({ ...settings, storage: { ...settings.storage, smbConnectors: arr } }); markDirty(); }} />
            </div>
          ))}
          <Button variant="secondary" className="text-xs" onClick={() => {
            const arr = [...(settings.storage?.smbConnectors ?? [])];
            arr.push({ id: generateId(), label: "", sharePath: "", mountPoint: "", domain: "", username: "" });
            setSettings({ ...settings, storage: { ...settings.storage, smbConnectors: arr } }); markDirty();
          }}>+ Add SMB Share</Button>
        </SectionCard>

        {/* 6. Authentication & IAM (editable) */}
        <SectionCard
          title="Authentication & IAM"
          iconPath="M8 2a3 3 0 100 6 3 3 0 000-6zM4 14c0-2.2 1.8-4 4-4s4 1.8 4 4"
          status={settings.authentication.iamEnabled ? "connected" : "not_configured"}
        >
          <ConfigRow label="Auth Mode" value={settings.authentication.mode.toUpperCase()} />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.authentication.shadowMode} onChange={(e) => {
                setSettings({ ...settings, authentication: { ...settings.authentication, shadowMode: e.target.checked } });
                void saveIamSettings({ shadowMode: e.target.checked });
              }} />
              Shadow Mode
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.scim.enabled} onChange={(e) => {
                setSettings({ ...settings, scim: { ...settings.scim, enabled: e.target.checked } });
                void saveIamSettings({ enableScimSync: e.target.checked });
              }} />
              SCIM Sync
            </label>
          </div>
          <div className="mt-2">
            <label className="text-xs font-medium">Rollout Ring</label>
            <select
              className="block w-full mt-1 px-2 py-1 rounded text-xs bg-[var(--color-ah-bg-secondary)] border border-[var(--color-ah-border)]"
              value={settings.authentication.rolloutRing}
              onChange={(e) => {
                setSettings({ ...settings, authentication: { ...settings.authentication, rolloutRing: e.target.value } });
                void saveIamSettings({ rolloutRing: e.target.value });
              }}
            >
              <option value="internal">Internal</option>
              <option value="pilot">Pilot</option>
              <option value="expand">Expand</option>
              <option value="general">General</option>
            </select>
          </div>
          {settings.authentication.mode === "oidc" && (
            <>
              <ConfigRow label="OIDC Issuer" value={settings.authentication.oidcIssuer} />
              <ConfigRow label="JWKS URI" value={settings.authentication.jwksUri} />
            </>
          )}
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => window.location.href = "/admin/rbac"}
            >
              View RBAC Matrix
            </Button>
          </div>
        </SectionCard>

        {/* 7. LDAP / Active Directory */}
        <SectionCard
          title="LDAP / Active Directory"
          iconPath="M3 3h10v10H3zM13 7h3v6h-3"
          status={settings.ldap?.configured ? (settings.ldap.enabled ? "connected" : "not_configured") : "not_configured"}
        >
          <p className="text-xs text-[var(--color-ah-text-muted)] mb-3">
            Connect to LDAP or Active Directory for centralized user and group management.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ConfigInput label="Host" value={settings.ldap?.host ?? ""} onChange={(v) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: !!v, enabled: settings.ldap?.enabled ?? false, host: v } }); markDirty(); }} />
            <ConfigInput label="Port" value={String(settings.ldap?.port ?? 389)} onChange={(v) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: true, enabled: settings.ldap?.enabled ?? false, port: parseInt(v) || 389 } }); markDirty(); }} />
            <ConfigInput label="Base DN" value={settings.ldap?.baseDn ?? ""} onChange={(v) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: true, enabled: settings.ldap?.enabled ?? false, baseDn: v } }); markDirty(); }} />
            <ConfigInput label="Bind DN" value={settings.ldap?.bindDn ?? ""} onChange={(v) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: true, enabled: settings.ldap?.enabled ?? false, bindDn: v } }); markDirty(); }} />
          </div>
          <label className="flex items-center gap-2 text-xs mt-2">
            <input type="checkbox" checked={settings.ldap?.useTls ?? true} onChange={(e) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: true, enabled: settings.ldap?.enabled ?? false, useTls: e.target.checked } }); markDirty(); }} />
            Use TLS
          </label>
          <label className="flex items-center gap-2 text-xs mt-1">
            <input type="checkbox" checked={settings.ldap?.enabled ?? false} onChange={(e) => { setSettings({ ...settings, ldap: { ...settings.ldap!, configured: true, enabled: e.target.checked } }); markDirty(); }} />
            Enable LDAP Authentication
          </label>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" onClick={() => {
              void saveLdapSettings(settings.ldap ?? {}).then(() => loadData());
            }}>Save LDAP Config</Button>
            <Button variant="secondary" onClick={async () => {
              try {
                const r = await testLdapConnection();
                setTestResults((prev) => ({ ...prev, ldap: { service: "ldap", status: r.status as "ok" | "error", message: r.message } }));
              } catch { setTestResults((prev) => ({ ...prev, ldap: { service: "ldap", status: "error", message: "LDAP test failed" } })); }
            }}>Test Connection</Button>
          </div>
          <InlineTestResult service="ldap" />
        </SectionCard>

        {/* 8. SCIM User Sync (editable) */}
        <ScimSection settings={settings} />
      </div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <PermissionGate
      permission="admin:system_config"
      fallback={
        <div className="max-w-4xl mx-auto p-6">
          <Card className="py-8 text-center">
            <p className="text-sm text-[var(--color-ah-text-muted)]">
              You do not have permission to access Platform Settings.
            </p>
          </Card>
        </div>
      }
    >
      <SettingsContent />
    </PermissionGate>
  );
}
