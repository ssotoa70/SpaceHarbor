import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  errorEnvelopeSchema,
  platformSettingsResponseSchema,
  savePlatformSettingsBodySchema,
  connectionTestResponseSchema,
  schemaDeployResponseSchema,
  schemaStatusResponseSchema,
} from "../http/schemas.js";
import { TrinoClient } from "../db/trino-client.js";
import { migrations } from "../db/migrations/index.js";
import { resolveIamFlags, setIamRuntimeOverrides, getIamRuntimeOverrides } from "../iam/feature-flags.js";
import type { IamFeatureFlags } from "../iam/feature-flags.js";
import { isValidApiKey, resolveValidApiKeys } from "../iam/auth-plugin.js";
import { PERMISSIONS } from "../iam/types.js";
import { getEffectivePermissions } from "../iam/permissions.js";
import type { SettingsStore } from "../persistence/settings-store.js";

/**
 * Enforce admin:system_config permission when IAM is enabled, or require an API
 * key when IAM is disabled. Platform settings are always sensitive — they expose
 * service endpoints, credentials masks, and allow schema migrations.
 *
 * Returns true if the request was denied (reply already sent).
 */
function denyUnlessAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const iamFlags = resolveIamFlags();

  if (iamFlags.iamEnabled) {
    // IAM path: check admin:system_config permission on the attached context.
    const ctx = (request as any).iamContext as { permissions?: Set<string> } | undefined;
    if (ctx?.permissions && !ctx.permissions.has(PERMISSIONS.ADMIN_SYSTEM_CONFIG)) {
      reply.status(403).send({
        code: "FORBIDDEN",
        message: `${PERMISSIONS.ADMIN_SYSTEM_CONFIG} permission required`,
        requestId: request.id,
        details: null,
      });
      return true;
    }
    return false;
  }

  // IAM disabled path: require API key when one is configured.
  const validKeys = resolveValidApiKeys();
  if (validKeys.length === 0) {
    // No API keys configured — dev/single-user mode. Log a warning and allow,
    // but do not silently expose settings in any environment that claims to be
    // production (the startup gate in app.ts already blocks that case).
    request.log.warn(
      "Platform settings accessed without authentication (no IAM, no API key). " +
      "Configure SPACEHARBOR_API_KEY or enable IAM before deploying to production."
    );
    return false;
  }

  const providedKey = request.headers["x-api-key"];
  if (!providedKey || typeof providedKey !== "string") {
    reply.status(401).send({
      code: "UNAUTHORIZED",
      message: "API key required for platform settings",
      requestId: request.id,
      details: null,
    });
    return true;
  }

  if (!isValidApiKey(providedKey)) {
    reply.status(403).send({
      code: "FORBIDDEN",
      message: "invalid API key",
      requestId: request.id,
      details: null,
    });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformSettings {
  vastDatabase: {
    configured: boolean;
    endpoint: string | null;
    status: "connected" | "disconnected" | "error";
    tablesDeployed: boolean;
    vmsVip: string | null;
    cnodeVips: string | null;
    accessKeyId: string | null;
    hasSecretKey: boolean;
    /** S3 bucket with DATABASE protocol enabled */
    bucket: string | null;
    /** Schema name within the bucket */
    schema: string | null;
  };
  vastEventBroker: {
    configured: boolean;
    brokerUrl: string | null;
    topic: string | null;
    status: "connected" | "disconnected" | "not_configured";
  };
  vastDataEngine: {
    configured: boolean;
    url: string | null;
    status: "connected" | "disconnected" | "not_configured";
    tenant: string | null;
    username: string | null;
    /** True if VMS password is stored. Password value is never returned. */
    hasPassword: boolean;
  };
  authentication: {
    mode: "local" | "oidc";
    oidcIssuer: string | null;
    jwksUri: string | null;
    iamEnabled: boolean;
    shadowMode: boolean;
    rolloutRing: string;
  };
  storage: {
    s3Endpoint: string | null;
    s3Bucket: string | null;
    configured: boolean;
    endpoints?: unknown[];
    nfsConnectors?: NfsConnectorStored[];
    smbConnectors?: Omit<SmbConnectorStored, "password">[];
  };
  scim: {
    configured: boolean;
    enabled: boolean;
  };
  ldap?: {
    configured: boolean;
    enabled: boolean;
    host?: string;
    port?: number;
    baseDn?: string;
    bindDn?: string;
    useTls?: boolean;
    userSearchFilter?: string;
    groupSearchBase?: string;
    groupSearchFilter?: string;
    syncIntervalMinutes?: number;
  };
}

// ---------------------------------------------------------------------------
// In-memory operational settings store
//
// Persists operational fields that are NOT available via environment variables
// (vmsVip, cnodeVips, accessKeyId, DataEngine tenant, S3 secretAccessKeys).
// Secret fields are stored here and NEVER serialised into GET response bodies.
// ---------------------------------------------------------------------------

interface S3EndpointStored {
  id: string;
  label: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // write-only; never returned to clients
  region: string;
  useSsl: boolean;
  pathStyle: boolean;
}

interface NfsConnectorStored {
  id: string;
  label: string;
  exportPath: string;
  mountPoint: string;
  version: "3" | "4" | "4.1";
  options: string;
}

interface SmbConnectorStored {
  id: string;
  label: string;
  sharePath: string;
  mountPoint: string;
  domain: string;
  username: string;
  password: string; // write-only; never returned to clients
}

interface LdapConfigStored {
  enabled: boolean;
  host: string;
  port: number;
  baseDn: string;
  bindDn: string;
  bindPassword: string; // write-only; never returned to clients
  useTls: boolean;
  userSearchFilter: string;
  groupSearchBase: string;
  groupSearchFilter: string;
  syncIntervalMinutes: number;
}

interface ScimConfigStored {
  enabled: boolean;
  tokenHash: string; // never returned; presence checked for "configured" status
  defaultRole: string;
}

interface OperationalSettings {
  vastDatabase: {
    url: string | null;
    vmsVip: string | null;
    cnodeVips: string | null;
    accessKeyId: string | null;
    secretKey: string | null; // write-only; never returned to clients
    bucket: string | null;   // S3 bucket with DATABASE protocol enabled (e.g. "sergio-db")
    schema: string | null;   // Schema name within the bucket (e.g. "spaceharbor")
  };
  vastEventBroker: {
    url: string | null;
    topic: string | null;
  };
  vastDataEngine: {
    url: string | null;
    tenant: string | null;
    username: string | null;
    password: string | null; // write-only; never returned to clients
  };
  storage: {
    endpoints: S3EndpointStored[];
    nfsConnectors: NfsConnectorStored[];
    smbConnectors: SmbConnectorStored[];
  };
  ldap: LdapConfigStored | null;
  scim: ScimConfigStored | null;
}

const defaultOperationalSettings: OperationalSettings = {
  vastDatabase: { url: null, vmsVip: null, cnodeVips: null, accessKeyId: null, secretKey: null, bucket: null, schema: null },
  vastEventBroker: { url: null, topic: null },
  vastDataEngine: { url: null, tenant: null, username: null, password: null },
  storage: { endpoints: [], nfsConnectors: [], smbConnectors: [] },
  ldap: null,
  scim: null,
};

/** Module-level store. Loaded from SettingsStore on startup; persisted on write. */
let operationalStore: OperationalSettings = { ...defaultOperationalSettings, storage: { ...defaultOperationalSettings.storage } };

/** Module-level reference to the settings store for persistence. */
let settingsStoreRef: SettingsStore | null = null;

function persistOperationalStore(): void {
  if (settingsStoreRef) {
    settingsStoreRef.set("platform.operational", operationalStore as unknown as Record<string, unknown>);
  }
}

function loadOperationalStore(store: SettingsStore): void {
  const saved = store.get("platform.operational") as unknown as OperationalSettings | null;
  if (saved) {
    operationalStore = {
      vastDatabase: { ...defaultOperationalSettings.vastDatabase, ...saved.vastDatabase },
      vastEventBroker: { ...defaultOperationalSettings.vastEventBroker, ...saved.vastEventBroker },
      vastDataEngine: { ...defaultOperationalSettings.vastDataEngine, ...saved.vastDataEngine },
      storage: {
        endpoints: saved.storage?.endpoints ?? [],
        nfsConnectors: saved.storage?.nfsConnectors ?? [],
        smbConnectors: saved.storage?.smbConnectors ?? [],
      },
      ldap: saved.ldap ?? null,
      scim: saved.scim ?? null,
    };
  }
}

/**
 * Get the configured VAST Database endpoint URL.
 * Priority: operational store > VAST_DB_ENDPOINT env > VAST_DATABASE_URL env > S3 endpoint fallback.
 */
export function getVastDatabaseUrl(): string | null {
  return operationalStore.vastDatabase.url
    || process.env.VAST_DB_ENDPOINT
    || process.env.VAST_DATABASE_URL
    || process.env.SPACEHARBOR_S3_ENDPOINT
    || null;
}

/**
 * Get the configured VAST Database bucket (database-enabled view).
 * Priority: operational store > VAST_DB_BUCKET env.
 */
export function getVastDatabaseBucket(): string | null {
  return operationalStore.vastDatabase.bucket || process.env.VAST_DB_BUCKET || null;
}

/**
 * Get the configured VAST Database schema name.
 * Priority: operational store > VAST_DB_SCHEMA env > default "spaceharbor".
 */
export function getVastDatabaseSchema(): string {
  return operationalStore.vastDatabase.schema || process.env.VAST_DB_SCHEMA || "spaceharbor";
}

/**
 * Get the full schema path for SQL queries: "bucket/schema".
 */
export function getVastDatabaseSchemaPath(): string {
  const bucket = getVastDatabaseBucket();
  const schema = getVastDatabaseSchema();
  return bucket ? `${bucket}/${schema}` : `spaceharbor/${schema}`;
}

/**
 * Get the configured VAST Event Broker URL.
 * Operational store (set via Settings UI) takes precedence over env var.
 */
export function getVastEventBrokerUrl(): string | null {
  return operationalStore.vastEventBroker.url || process.env.VAST_EVENT_BROKER_URL || null;
}

/**
 * Get the configured VAST Event Broker topic.
 * Operational store (set via Settings UI) takes precedence over env var.
 */
export function getVastEventBrokerTopic(): string {
  return operationalStore.vastEventBroker.topic || process.env.VAST_EVENT_BROKER_TOPIC || "spaceharbor.dataengine.completed";
}

/**
 * Get the configured VAST DataEngine URL.
 * Operational store (set via Settings UI) takes precedence over env var.
 */
export function getVastDataEngineUrl(): string | null {
  return operationalStore.vastDataEngine.url || process.env.VAST_DATA_ENGINE_URL || null;
}

/**
 * Get VMS credentials for the DataEngine proxy.
 * Returns null if credentials are not configured.
 */
export function getVastDataEngineCredentials(): { username: string; password: string } | null {
  const username = operationalStore.vastDataEngine.username;
  const password = operationalStore.vastDataEngine.password;
  if (!username || !password) return null;
  return { username, password };
}

export interface ConnectionTestResult {
  service: string;
  status: "ok" | "error";
  message: string;
}

export interface SchemaDeployResult {
  status: "ok" | "error";
  migrationsApplied: number;
  message: string;
}

export interface SchemaStatus {
  currentVersion: number;
  availableMigrations: number;
  upToDate: boolean;
  pending: { version: number; description: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TrinoClient from operational store / env vars, or null if not configured. */
function buildTrinoFromEnv(): TrinoClient | null {
  const dbUrl = getVastDatabaseUrl();
  if (!dbUrl) return null;
  try {
    const url = new URL(dbUrl);
    const accessKey = operationalStore.vastDatabase.accessKeyId
      || process.env.VAST_DB_ACCESS_KEY
      || url.username
      || process.env.VAST_ACCESS_KEY
      || "";
    const secretKey = operationalStore.vastDatabase.secretKey
      || process.env.VAST_DB_SECRET_KEY
      || url.password
      || process.env.VAST_SECRET_KEY
      || "";
    const schemaPath = getVastDatabaseSchemaPath();
    return new TrinoClient({
      endpoint: `${url.protocol}//${url.host}`,
      accessKey,
      secretKey,
      schema: schemaPath,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerPlatformSettingsRoutes(
  app: FastifyInstance,
  prefixes: string[],
  store?: SettingsStore,
): Promise<void> {
  // Load persisted settings and IAM overrides on startup
  if (store) {
    settingsStoreRef = store;
    loadOperationalStore(store);
    const iamOverrides = store.get("platform.iam") as Partial<IamFeatureFlags> | null;
    if (iamOverrides) setIamRuntimeOverrides(iamOverrides);
  }

  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // ── GET /platform/settings ──────────────────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetPlatformSettings`,
          summary: "Get current platform configuration",
          description: "Returns the current service connection status and configuration for all platform services (VAST Database, Event Broker, DataEngine, S3, IAM, SCIM). Requires admin:system_config permission.",
          response: { 200: platformSettingsResponseSchema, 403: errorEnvelopeSchema },
        },
      },
      async (_request, reply) => {
        if (denyUnlessAdmin(_request, reply)) return;
        const iamFlags = resolveIamFlags();

        // VAST Database
        const dbUrl = getVastDatabaseUrl();
        const dbConfigured = !!dbUrl;
        let dbStatus: PlatformSettings["vastDatabase"]["status"] = "disconnected";
        let tablesDeployed = false;

        if (dbConfigured) {
          const trino = buildTrinoFromEnv();
          if (trino) {
            try {
              const health = await trino.healthCheck();
              dbStatus = health.reachable ? "connected" : "disconnected";

              if (health.reachable) {
                try {
                  const schema = getVastDatabaseSchemaPath();
                  await trino.query(`SELECT MAX(version) AS v FROM vast."${schema}".schema_version`);
                  tablesDeployed = true;
                } catch {
                  // schema_version table doesn't exist
                }
              }
            } catch {
              dbStatus = "error";
            }
          }
        }

        // VAST Event Broker
        const brokerUrl = getVastEventBrokerUrl();
        const brokerTopic = getVastEventBrokerTopic();
        const brokerConfigured = !!brokerUrl;

        // VAST DataEngine
        const dataEngineUrl = getVastDataEngineUrl();
        const deConfigured = !!dataEngineUrl;

        // S3 / Object Storage
        const s3Endpoint = process.env.SPACEHARBOR_S3_ENDPOINT ?? process.env.AWS_S3_ENDPOINT ?? null;
        const s3Bucket = process.env.SPACEHARBOR_S3_BUCKET ?? process.env.AWS_S3_BUCKET ?? null;
        const s3Configured = !!(s3Endpoint && s3Bucket);

        // Authentication
        const oidcIssuer = process.env.SPACEHARBOR_OIDC_ISSUER ?? null;
        const jwksUri = process.env.SPACEHARBOR_OIDC_JWKS_URI ?? null;
        const authMode = jwksUri ? "oidc" : "local";

        // SCIM
        const scimEnabled = iamFlags.enableScimSync;
        const scimConfigured = scimEnabled && !!process.env.SPACEHARBOR_SCIM_TOKEN;

        // Build S3 endpoints for response — strip secretAccessKey (never returned)
        const s3EndpointsForResponse = operationalStore.storage.endpoints.map(
          ({ secretAccessKey: _omit, ...rest }) => rest,
        );

        // Admin-only route: return full (unmasked) URLs so the settings
        // form can round-trip values without corruption.  Secrets (passwords,
        // secret keys) are still omitted — only URL strings are unmasked.
        const settings: PlatformSettings = {
          vastDatabase: {
            configured: dbConfigured,
            endpoint: dbUrl ?? null,
            status: dbConfigured ? dbStatus : "disconnected",
            tablesDeployed,
            vmsVip: operationalStore.vastDatabase.vmsVip,
            cnodeVips: operationalStore.vastDatabase.cnodeVips,
            accessKeyId: operationalStore.vastDatabase.accessKeyId,
            hasSecretKey: !!operationalStore.vastDatabase.secretKey,
            bucket: getVastDatabaseBucket(),
            schema: getVastDatabaseSchema(),
          },
          vastEventBroker: {
            configured: brokerConfigured,
            brokerUrl: brokerUrl ?? null,
            topic: brokerConfigured ? brokerTopic : null,
            status: brokerConfigured ? "connected" : "not_configured",
          },
          vastDataEngine: {
            configured: deConfigured,
            url: dataEngineUrl ?? null,
            status: deConfigured ? "connected" : "not_configured",
            tenant: operationalStore.vastDataEngine.tenant,
            username: operationalStore.vastDataEngine.username,
            hasPassword: !!operationalStore.vastDataEngine.password,
          },
          authentication: {
            mode: authMode,
            oidcIssuer: oidcIssuer,
            jwksUri: jwksUri,
            iamEnabled: iamFlags.iamEnabled,
            shadowMode: iamFlags.shadowMode,
            rolloutRing: iamFlags.rolloutRing,
          },
          storage: {
            s3Endpoint: s3Endpoint,
            s3Bucket: s3Bucket,
            configured: s3Configured,
            endpoints: s3EndpointsForResponse,
            nfsConnectors: operationalStore.storage.nfsConnectors,
            smbConnectors: operationalStore.storage.smbConnectors.map(
              ({ password: _omit, ...rest }) => rest,
            ),
          } as any,
          scim: {
            configured: scimConfigured,
            enabled: scimEnabled,
          },
          ldap: operationalStore.ldap
            ? {
                configured: true,
                enabled: operationalStore.ldap.enabled,
                host: operationalStore.ldap.host,
                port: operationalStore.ldap.port,
                baseDn: operationalStore.ldap.baseDn,
                bindDn: operationalStore.ldap.bindDn,
                useTls: operationalStore.ldap.useTls,
                userSearchFilter: operationalStore.ldap.userSearchFilter,
                groupSearchBase: operationalStore.ldap.groupSearchBase,
                groupSearchFilter: operationalStore.ldap.groupSearchFilter,
                syncIntervalMinutes: operationalStore.ldap.syncIntervalMinutes,
              }
            : { configured: false, enabled: false },
        };

        return reply.send(settings);
      },
    );

    // ── PUT /platform/settings ─────────────────────────────────────────
    app.put<{ Body: Record<string, unknown> }>(
      withPrefix(prefix, "/platform/settings"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}SavePlatformSettings`,
          summary: "Update platform configuration",
          description: "Persists updated service connection parameters. Supports partial updates — only the sections included in the body are modified. S3 storage supports multiple endpoint configurations. Requires admin:system_config permission.",
          body: savePlatformSettingsBodySchema,
          response: {
            200: platformSettingsResponseSchema,
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;

        const body = request.body as Record<string, unknown>;
        request.log.info({ update: body }, "Platform settings update requested");

        // Persist VAST Database operational fields
        const dbBody = body["vastDatabase"] as Record<string, unknown> | undefined;
        if (dbBody) {
          if (typeof dbBody["endpoint"] === "string" || dbBody["endpoint"] === null) {
            operationalStore.vastDatabase.url = (dbBody["endpoint"] as string | null) || null;
          }
          if (typeof dbBody["vmsVip"] === "string" || dbBody["vmsVip"] === null) {
            operationalStore.vastDatabase.vmsVip = (dbBody["vmsVip"] as string | null) || null;
          }
          if (typeof dbBody["cnodeVips"] === "string" || dbBody["cnodeVips"] === null) {
            operationalStore.vastDatabase.cnodeVips = (dbBody["cnodeVips"] as string | null) || null;
          }
          if (typeof dbBody["accessKeyId"] === "string" || dbBody["accessKeyId"] === null) {
            operationalStore.vastDatabase.accessKeyId = (dbBody["accessKeyId"] as string | null) || null;
          }
          // Only overwrite secretKey if a non-empty value is provided (write-only field)
          if (typeof dbBody["secretKey"] === "string" && dbBody["secretKey"] !== "") {
            operationalStore.vastDatabase.secretKey = dbBody["secretKey"];
          }
          if (typeof dbBody["bucket"] === "string" || dbBody["bucket"] === null) {
            operationalStore.vastDatabase.bucket = (dbBody["bucket"] as string | null) || null;
          }
          if (typeof dbBody["schema"] === "string" || dbBody["schema"] === null) {
            operationalStore.vastDatabase.schema = (dbBody["schema"] as string | null) || null;
          }
        }

        // Persist VAST Event Broker operational fields
        const brokerBody = body["vastEventBroker"] as Record<string, unknown> | undefined;
        if (brokerBody) {
          if (typeof brokerBody["brokerUrl"] === "string" || brokerBody["brokerUrl"] === null) {
            operationalStore.vastEventBroker.url = (brokerBody["brokerUrl"] as string | null) || null;
          }
          if (typeof brokerBody["topic"] === "string" || brokerBody["topic"] === null) {
            operationalStore.vastEventBroker.topic = (brokerBody["topic"] as string | null) || null;
          }
        }

        // Persist VAST DataEngine operational fields
        const deBody = body["vastDataEngine"] as Record<string, unknown> | undefined;
        if (deBody) {
          if (typeof deBody["url"] === "string" || deBody["url"] === null) {
            operationalStore.vastDataEngine.url = (deBody["url"] as string | null) || null;
          }
          if (typeof deBody["tenant"] === "string" || deBody["tenant"] === null) {
            operationalStore.vastDataEngine.tenant = (deBody["tenant"] as string | null) || null;
          }
          if (typeof deBody["username"] === "string" || deBody["username"] === null) {
            operationalStore.vastDataEngine.username = (deBody["username"] as string | null) || null;
          }
          // Only overwrite password if a non-empty value is provided (write-only field)
          if (typeof deBody["password"] === "string" && deBody["password"] !== "") {
            operationalStore.vastDataEngine.password = deBody["password"];
          }
        }

        // Persist S3 endpoints (merge secretAccessKey: keep existing value if not provided)
        const storageBody = body["storage"] as Record<string, unknown> | undefined;
        if (storageBody && Array.isArray(storageBody["endpoints"])) {
          const incoming = storageBody["endpoints"] as Array<Record<string, unknown>>;
          operationalStore.storage.endpoints = incoming.map((ep) => {
            const existing = operationalStore.storage.endpoints.find((e) => e.id === ep["id"]);
            return {
              id: String(ep["id"] ?? ""),
              label: String(ep["label"] ?? ""),
              endpoint: String(ep["endpoint"] ?? ""),
              bucket: String(ep["bucket"] ?? ""),
              accessKeyId: String(ep["accessKeyId"] ?? ""),
              // Use new value if provided; fall back to previously stored secret
              secretAccessKey:
                typeof ep["secretAccessKey"] === "string" && ep["secretAccessKey"] !== ""
                  ? ep["secretAccessKey"]
                  : (existing?.secretAccessKey ?? ""),
              region: String(ep["region"] ?? "us-east-1"),
              useSsl: ep["useSsl"] !== false,
              pathStyle: ep["pathStyle"] !== false,
            } satisfies S3EndpointStored;
          });
        }

        // Persist NFS connectors
        if (storageBody && Array.isArray(storageBody["nfsConnectors"])) {
          operationalStore.storage.nfsConnectors = (storageBody["nfsConnectors"] as Array<Record<string, unknown>>).map((c) => ({
            id: String(c["id"] ?? ""),
            label: String(c["label"] ?? ""),
            exportPath: String(c["exportPath"] ?? ""),
            mountPoint: String(c["mountPoint"] ?? ""),
            version: (["3", "4", "4.1"].includes(String(c["version"])) ? String(c["version"]) : "4.1") as "3" | "4" | "4.1",
            options: String(c["options"] ?? ""),
          }));
        }

        // Persist SMB connectors
        if (storageBody && Array.isArray(storageBody["smbConnectors"])) {
          operationalStore.storage.smbConnectors = (storageBody["smbConnectors"] as Array<Record<string, unknown>>).map((c) => {
            const existing = operationalStore.storage.smbConnectors.find((e) => e.id === c["id"]);
            return {
              id: String(c["id"] ?? ""),
              label: String(c["label"] ?? ""),
              sharePath: String(c["sharePath"] ?? ""),
              mountPoint: String(c["mountPoint"] ?? ""),
              domain: String(c["domain"] ?? ""),
              username: String(c["username"] ?? ""),
              password: typeof c["password"] === "string" && c["password"] !== "" ? c["password"] : (existing?.password ?? ""),
            };
          });
        }

        // Write all changes to persistent store
        persistOperationalStore();

        // Re-read current settings to return fresh state
        const iamFlags = resolveIamFlags();
        const dbUrl = getVastDatabaseUrl();
        const brokerUrl = getVastEventBrokerUrl();
        const brokerTopic = getVastEventBrokerTopic();
        const dataEngineUrl = getVastDataEngineUrl();
        const s3Endpoint = process.env.SPACEHARBOR_S3_ENDPOINT ?? process.env.AWS_S3_ENDPOINT ?? null;
        const s3Bucket = process.env.SPACEHARBOR_S3_BUCKET ?? process.env.AWS_S3_BUCKET ?? null;
        const oidcIssuer = process.env.SPACEHARBOR_OIDC_ISSUER ?? null;
        const jwksUri = process.env.SPACEHARBOR_OIDC_JWKS_URI ?? null;

        // Build S3 endpoint list for response — strip secretAccessKey
        const s3EndpointsForResponse = operationalStore.storage.endpoints.map(
          ({ secretAccessKey: _omit, ...rest }) => rest,
        );

        const settings: PlatformSettings = {
          vastDatabase: {
            configured: !!dbUrl,
            endpoint: dbUrl ?? null,
            status: dbUrl ? "connected" : "disconnected",
            tablesDeployed: false,
            vmsVip: operationalStore.vastDatabase.vmsVip,
            cnodeVips: operationalStore.vastDatabase.cnodeVips,
            accessKeyId: operationalStore.vastDatabase.accessKeyId,
            hasSecretKey: !!operationalStore.vastDatabase.secretKey,
            bucket: getVastDatabaseBucket(),
            schema: getVastDatabaseSchema(),
          },
          vastEventBroker: {
            configured: !!brokerUrl,
            brokerUrl: brokerUrl ?? null,
            topic: brokerUrl ? brokerTopic : null,
            status: brokerUrl ? "connected" : "not_configured",
          },
          vastDataEngine: {
            configured: !!dataEngineUrl,
            url: dataEngineUrl ?? null,
            status: dataEngineUrl ? "connected" : "not_configured",
            tenant: operationalStore.vastDataEngine.tenant,
            username: operationalStore.vastDataEngine.username,
            hasPassword: !!operationalStore.vastDataEngine.password,
          },
          authentication: {
            mode: jwksUri ? "oidc" : "local",
            oidcIssuer: oidcIssuer,
            jwksUri: jwksUri,
            iamEnabled: iamFlags.iamEnabled,
            shadowMode: iamFlags.shadowMode,
            rolloutRing: iamFlags.rolloutRing,
          },
          storage: {
            s3Endpoint: s3Endpoint,
            s3Bucket: s3Bucket,
            configured: !!(s3Endpoint && s3Bucket),
            endpoints: s3EndpointsForResponse,
            nfsConnectors: operationalStore.storage.nfsConnectors,
            smbConnectors: operationalStore.storage.smbConnectors.map(
              ({ password: _omit2, ...rest2 }) => rest2,
            ),
          } as any,
          scim: {
            configured: iamFlags.enableScimSync && !!process.env.SPACEHARBOR_SCIM_TOKEN,
            enabled: iamFlags.enableScimSync,
          },
          ldap: operationalStore.ldap
            ? {
                configured: true,
                enabled: operationalStore.ldap.enabled,
                host: operationalStore.ldap.host,
                port: operationalStore.ldap.port,
                baseDn: operationalStore.ldap.baseDn,
                bindDn: operationalStore.ldap.bindDn,
                useTls: operationalStore.ldap.useTls,
                userSearchFilter: operationalStore.ldap.userSearchFilter,
                groupSearchBase: operationalStore.ldap.groupSearchBase,
                groupSearchFilter: operationalStore.ldap.groupSearchFilter,
                syncIntervalMinutes: operationalStore.ldap.syncIntervalMinutes,
              }
            : { configured: false, enabled: false },
        };

        return reply.send(settings);
      },
    );

    // ── POST /platform/settings/test-connection ─────────────────────────
    app.post<{
      Body: { service: string };
    }>(
      withPrefix(prefix, "/platform/settings/test-connection"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}TestServiceConnection`,
          summary: "Test connectivity to a platform service",
          description: "Attempts to connect to the specified service. Use 's3:{endpointId}' to test a specific S3 endpoint. Requires admin:system_config permission.",
          body: {
            type: "object",
            required: ["service"],
            properties: {
              service: {
                type: "string",
                description: "Service to test: vast_database, event_broker, data_engine, s3, or s3:{endpointId}",
              },
            },
          },
          response: {
            200: connectionTestResponseSchema,
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const { service } = request.body;

        if (service === "vast_database") {
          const bucket = getVastDatabaseBucket();
          // Prefer VMS VIP (direct cluster endpoint) for database operations
          const vmsVip = operationalStore.vastDatabase.vmsVip;
          const dbUrl = vmsVip ? `http://${vmsVip}` : getVastDatabaseUrl();

          if (!dbUrl) {
            return reply.send({
              service,
              status: "error",
              message: "VAST Database endpoint is not configured. Set it in Settings or via VAST_DB_ENDPOINT env var.",
            } satisfies ConnectionTestResult);
          }
          if (!bucket) {
            return reply.send({
              service,
              status: "error",
              message: "Database bucket is not configured. Specify the Database-enabled S3 bucket in Settings.",
            } satisfies ConnectionTestResult);
          }

          // Test connectivity via S3 HeadBucket — VAST Database buckets are S3 buckets with DATABASE protocol
          try {
            const { setVastTlsSkip, restoreVastTls } = await import("../vast/vast-fetch.js");
            setVastTlsSkip();
            const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
            const accessKey = operationalStore.vastDatabase.accessKeyId
              || process.env.VAST_DB_ACCESS_KEY || process.env.VAST_ACCESS_KEY || "";
            const secretKey = operationalStore.vastDatabase.secretKey
              || process.env.VAST_DB_SECRET_KEY || process.env.VAST_SECRET_KEY || "";

            const s3 = new S3Client({
              endpoint: dbUrl,
              region: "us-east-1",
              credentials: accessKey && secretKey
                ? { accessKeyId: accessKey, secretAccessKey: secretKey }
                : undefined,
              forcePathStyle: true,
              requestHandler: { requestTimeout: 5000 } as never,
            });

            await s3.send(new HeadBucketCommand({ Bucket: bucket }));
            s3.destroy();
            restoreVastTls();
            const schema = getVastDatabaseSchema();
            return reply.send({
              service,
              status: "ok",
              message: `Connected to VAST Database — bucket "${bucket}" accessible (schema: ${schema})`,
            } satisfies ConnectionTestResult);
          } catch (err) {
            const { restoreVastTls: restore } = await import("../vast/vast-fetch.js");
            restore();
            const name = (err as { name?: string })?.name ?? "";
            const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

            if (statusCode === 403 || name === "AccessDenied" || name === "SignatureDoesNotMatch") {
              return reply.send({ service, status: "error", message: `Endpoint reachable but access denied for bucket "${bucket}" (check credentials)` } satisfies ConnectionTestResult);
            }
            if (statusCode === 404 || name === "NotFound" || name === "NoSuchBucket") {
              return reply.send({ service, status: "error", message: `Endpoint reachable but bucket "${bucket}" not found — create it with DATABASE protocol enabled` } satisfies ConnectionTestResult);
            }
            return reply.send({
              service,
              status: "error",
              message: `VAST Database connection failed: ${err instanceof Error ? err.message : String(err)}`,
            } satisfies ConnectionTestResult);
          }
        }

        if (service === "event_broker") {
          const brokerUrl = getVastEventBrokerUrl();
          return reply.send({
            service,
            status: brokerUrl ? "ok" : "error",
            message: brokerUrl
              ? "Event broker URL is configured"
              : "Event broker URL is not configured. Set it in Settings or via VAST_EVENT_BROKER_URL env var.",
          } satisfies ConnectionTestResult);
        }

        if (service === "data_engine") {
          const deUrl = getVastDataEngineUrl();
          if (!deUrl) {
            return reply.send({
              service,
              status: "error",
              message: "VAST_DATA_ENGINE_URL is not configured",
            } satisfies ConnectionTestResult);
          }

          const creds = getVastDataEngineCredentials();
          if (!creds) {
            return reply.send({
              service,
              status: "error",
              message: "VMS username and password are not configured. Set them in the DataEngine settings section.",
            } satisfies ConnectionTestResult);
          }

          // Actually test VMS authentication
          const { VmsTokenManager } = await import("../vast/vms-token-manager.js");
          const tokenManager = new VmsTokenManager(deUrl, creds);
          const result = await tokenManager.testConnection();
          return reply.send({
            service,
            status: result.ok ? "ok" : "error",
            message: result.message,
          } satisfies ConnectionTestResult);
        }

        if (service === "s3" || service.startsWith("s3:")) {
          // Find the endpoint to test: either from operational store (UI-configured)
          // or fall back to env vars for legacy single-endpoint config.
          const epId = service.startsWith("s3:") ? service.slice(3) : null;
          const stored = epId ? operationalStore.storage.endpoints.find((e) => e.id === epId) : null;

          const endpoint = stored?.endpoint || process.env.SPACEHARBOR_S3_ENDPOINT || process.env.AWS_S3_ENDPOINT;
          const bucket = stored?.bucket || process.env.SPACEHARBOR_S3_BUCKET || process.env.AWS_S3_BUCKET;
          const accessKey = stored?.accessKeyId || process.env.SPACEHARBOR_S3_ACCESS_KEY_ID || "";
          const secretKey = stored?.secretAccessKey || process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY || "";

          if (!endpoint || !bucket) {
            return reply.send({
              service,
              status: "error",
              message: "S3 endpoint or bucket is not configured",
            } satisfies ConnectionTestResult);
          }

          // Test connectivity with proper AWS SigV4 authentication via HeadBucket
          try {
            // Temporarily disable TLS verification for VAST self-signed certs
            const { setVastTlsSkip, restoreVastTls } = await import("../vast/vast-fetch.js");
            setVastTlsSkip();
            const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
            const useSsl = stored?.useSsl ?? endpoint.startsWith("https");
            const s3 = new S3Client({
              endpoint: endpoint,
              region: stored?.region || "us-east-1",
              credentials: accessKey && secretKey
                ? { accessKeyId: accessKey, secretAccessKey: secretKey }
                : undefined,
              forcePathStyle: stored?.pathStyle ?? true,
              tls: useSsl,
              requestHandler: { requestTimeout: 5000 } as never,
            });

            await s3.send(new HeadBucketCommand({ Bucket: bucket }));
            s3.destroy();
            restoreVastTls();
            return reply.send({ service, status: "ok", message: `Connected to ${endpoint} — bucket "${bucket}" accessible` } satisfies ConnectionTestResult);
          } catch (err) {
            const { restoreVastTls: restore } = await import("../vast/vast-fetch.js");
            restore();
            const msg = err instanceof Error ? err.message : String(err);
            const name = (err as { name?: string })?.name ?? "";
            const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

            if (statusCode === 403 || name === "AccessDenied" || name === "SignatureDoesNotMatch") {
              return reply.send({ service, status: "error", message: `Endpoint ${endpoint} reachable but access denied — bucket "${bucket}" returned 403 (check credentials)` } satisfies ConnectionTestResult);
            }
            if (statusCode === 404 || name === "NotFound" || name === "NoSuchBucket") {
              return reply.send({ service, status: "error", message: `Endpoint reachable but bucket "${bucket}" not found (404)` } satisfies ConnectionTestResult);
            }
            if (statusCode === 301 || name === "PermanentRedirect") {
              return reply.send({ service, status: "ok", message: `Endpoint ${endpoint} reachable — bucket "${bucket}" exists (redirected)` } satisfies ConnectionTestResult);
            }
            return reply.send({
              service,
              status: "error",
              message: `S3 test failed: ${err instanceof Error ? err.message : String(err)}`,
            } satisfies ConnectionTestResult);
          }
        }

        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: `Unknown service: ${service}`,
          requestId: request.id,
          details: null,
        });
      },
    );

    // ── POST /platform/settings/deploy-schema ───────────────────────────
    app.post(
      withPrefix(prefix, "/platform/settings/deploy-schema"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}DeploySchema`,
          summary: "Run database schema migrations",
          description: "Applies pending Trino/VAST DataBase migrations. Requires admin:system_config permission. This action cannot be undone.",
          response: {
            200: schemaDeployResponseSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (_request, reply) => {
        if (denyUnlessAdmin(_request, reply)) return;

        const bucket = getVastDatabaseBucket();
        const schema = getVastDatabaseSchema();

        // For vastdb SDK, prefer VMS VIP (direct cluster endpoint) over S3 gateway
        const vmsVip = operationalStore.vastDatabase.vmsVip;
        const dbUrl = vmsVip ? `http://${vmsVip}` : getVastDatabaseUrl();

        if (!dbUrl || !bucket) {
          return reply.status(503).send({
            code: "SERVICE_UNAVAILABLE",
            message: "VAST Database endpoint (VMS VIP) and bucket must be configured before deploying schema.",
            requestId: _request.id,
            details: null,
          });
        }

        const accessKey = operationalStore.vastDatabase.accessKeyId
          || process.env.VAST_DB_ACCESS_KEY || process.env.VAST_ACCESS_KEY || "";
        const secretKey = operationalStore.vastDatabase.secretKey
          || process.env.VAST_DB_SECRET_KEY || process.env.VAST_SECRET_KEY || "";

        if (!accessKey || !secretKey) {
          return reply.status(503).send({
            code: "SERVICE_UNAVAILABLE",
            message: "VAST Database access key and secret key must be configured.",
            requestId: _request.id,
            details: null,
          });
        }

        // Run the vastdb Python migration script
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);

          const scriptPath = new URL("../db/vast-migrate.py", import.meta.url).pathname;

          const { stdout, stderr } = await execFileAsync("python3", [
            scriptPath,
            "--endpoint", dbUrl,
            "--access-key", accessKey,
            "--secret-key", secretKey,
            "--bucket", bucket,
            "--schema", schema,
          ], {
            timeout: 120_000, // 2 minutes
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
          });

          if (stderr) {
            _request.log.info({ stderr: stderr.trim() }, "vast-migrate progress");
          }

          // Parse JSON output from the last line of stdout
          const lines = stdout.trim().split("\n");
          const lastLine = lines[lines.length - 1];
          let result: { status: string; message: string; tables_created?: number; tables_existing?: number };
          try {
            result = JSON.parse(lastLine);
          } catch {
            result = { status: "ok", message: stdout.trim() };
          }

          if (result.status === "error") {
            return reply.send({
              status: "error",
              migrationsApplied: 0,
              message: result.message,
            } satisfies SchemaDeployResult);
          }

          return reply.send({
            status: "ok",
            migrationsApplied: result.tables_created ?? 0,
            message: result.message,
          } satisfies SchemaDeployResult);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Include stderr if available (Python traceback)
          const stderr = (err as { stderr?: string })?.stderr;
          const detail = stderr ? `${msg}\n${stderr.trim()}` : msg;
          return reply.send({
            status: "error",
            migrationsApplied: 0,
            message: `Schema deployment failed: ${detail}`,
          } satisfies SchemaDeployResult);
        }
      },
    );

    // ── GET /platform/settings/schema-status ────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings/schema-status"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetSchemaStatus`,
          summary: "Get database schema migration status",
          description: "Returns the current schema version, available migrations, and any pending migrations.",
          response: {
            200: schemaStatusResponseSchema,
          },
        },
      },
      async (_request, reply) => {
        if (denyUnlessAdmin(_request, reply)) return;
        const trino = buildTrinoFromEnv();
        const totalMigrations = migrations.length;

        let currentVersion = 0;

        if (trino) {
          try {
            const schema = getVastDatabaseSchemaPath();
            const result = await trino.query(
              `SELECT MAX(version) AS max_ver FROM vast."${schema}".schema_version`,
            );
            if (result.data.length > 0 && result.data[0][0] != null) {
              currentVersion = result.data[0][0] as number;
            }
          } catch {
            // Table doesn't exist
          }
        }

        const pending = migrations
          .filter((m) => m.version > currentVersion)
          .map((m) => ({ version: m.version, description: m.description }));

        return reply.send({
          currentVersion,
          availableMigrations: totalMigrations,
          upToDate: pending.length === 0,
          pending,
        } satisfies SchemaStatus);
      },
    );

    // ── GET /platform/settings/iam ──────────────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings/iam"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetIamSettings`,
          summary: "Get IAM feature flag configuration",
          description: "Returns the merged IAM flags (env defaults + runtime overrides).",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const flags = resolveIamFlags();
        const overrides = getIamRuntimeOverrides();
        return reply.send({ flags, overrides });
      },
    );

    // ── PUT /platform/settings/iam ──────────────────────────────────────
    app.put<{ Body: Record<string, unknown> }>(
      withPrefix(prefix, "/platform/settings/iam"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}SaveIamSettings`,
          summary: "Update IAM feature flags at runtime",
          description: "Saves IAM flag overrides that take effect immediately without restart.",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const body = request.body as Partial<IamFeatureFlags>;
        const safe: Partial<IamFeatureFlags> = {};
        if (typeof body.shadowMode === "boolean") safe.shadowMode = body.shadowMode;
        if (typeof body.enforceReadScope === "boolean") safe.enforceReadScope = body.enforceReadScope;
        if (typeof body.enforceWriteScope === "boolean") safe.enforceWriteScope = body.enforceWriteScope;
        if (typeof body.enforceApprovalSod === "boolean") safe.enforceApprovalSod = body.enforceApprovalSod;
        if (typeof body.enableScimSync === "boolean") safe.enableScimSync = body.enableScimSync;
        if (typeof body.rolloutRing === "string") safe.rolloutRing = body.rolloutRing as any;
        setIamRuntimeOverrides(safe);
        if (settingsStoreRef) settingsStoreRef.set("platform.iam", safe as unknown as Record<string, unknown>);
        return reply.send({ status: "ok", flags: resolveIamFlags() });
      },
    );

    // ── GET /platform/settings/rbac-matrix ──────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings/rbac-matrix"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetRbacMatrix`,
          summary: "Get role-permission matrix",
          description: "Returns the full RBAC matrix showing which permissions each role has.",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const { PROJECT_ROLES } = await import("../iam/types.js");
        const { GLOBAL_ROLES } = await import("../iam/types.js");
        const allRoles = [...PROJECT_ROLES, ...GLOBAL_ROLES] as string[];
        const matrix: Record<string, string[]> = {};
        const allPermissions = new Set<string>();
        for (const role of allRoles) {
          const perms = getEffectivePermissions(role as any);
          matrix[role] = [...perms].sort();
          for (const p of perms) allPermissions.add(p);
        }
        return reply.send({
          roles: allRoles,
          permissions: [...allPermissions].sort(),
          matrix,
        });
      },
    );

    // ── GET /platform/settings/ldap ─────────────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings/ldap"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetLdapSettings`,
          summary: "Get LDAP/AD configuration",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        if (!operationalStore.ldap) {
          return reply.send({ configured: false, enabled: false });
        }
        const { bindPassword: _, ...safe } = operationalStore.ldap;
        return reply.send({ configured: true, ...safe });
      },
    );

    // ── PUT /platform/settings/ldap ─────────────────────────────────────
    app.put<{ Body: Record<string, unknown> }>(
      withPrefix(prefix, "/platform/settings/ldap"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}SaveLdapSettings`,
          summary: "Update LDAP/AD configuration",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const b = request.body as Record<string, unknown>;
        const existing = operationalStore.ldap;
        operationalStore.ldap = {
          enabled: b["enabled"] === true,
          host: String(b["host"] ?? existing?.host ?? ""),
          port: typeof b["port"] === "number" ? b["port"] : (existing?.port ?? 389),
          baseDn: String(b["baseDn"] ?? existing?.baseDn ?? ""),
          bindDn: String(b["bindDn"] ?? existing?.bindDn ?? ""),
          bindPassword: typeof b["bindPassword"] === "string" && b["bindPassword"] !== ""
            ? b["bindPassword"]
            : (existing?.bindPassword ?? ""),
          useTls: b["useTls"] !== false,
          userSearchFilter: String(b["userSearchFilter"] ?? existing?.userSearchFilter ?? "(objectClass=person)"),
          groupSearchBase: String(b["groupSearchBase"] ?? existing?.groupSearchBase ?? ""),
          groupSearchFilter: String(b["groupSearchFilter"] ?? existing?.groupSearchFilter ?? "(objectClass=group)"),
          syncIntervalMinutes: typeof b["syncIntervalMinutes"] === "number" ? b["syncIntervalMinutes"] : (existing?.syncIntervalMinutes ?? 60),
        };
        persistOperationalStore();
        const { bindPassword: _, ...safe } = operationalStore.ldap;
        return reply.send({ status: "ok", configured: true, ...safe });
      },
    );

    // ── POST /platform/settings/ldap/test ───────────────────────────────
    app.post(
      withPrefix(prefix, "/platform/settings/ldap/test"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}TestLdapConnection`,
          summary: "Test LDAP/AD connectivity",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        if (!operationalStore.ldap?.host) {
          return reply.send({ status: "error", message: "LDAP not configured" });
        }
        // Connection test: verify host:port is reachable via TCP.
        const { host, port, useTls } = operationalStore.ldap;
        const net = await import("node:net");
        return new Promise<void>((resolve) => {
          const sock = net.createConnection({ host, port, timeout: 5000 }, () => {
            sock.destroy();
            reply.send({ status: "ok", message: `Connected to ${host}:${port}${useTls ? " (TLS)" : ""}` });
            resolve();
          });
          sock.on("error", (err) => {
            sock.destroy();
            reply.send({ status: "error", message: `Connection failed: ${err.message}` });
            resolve();
          });
          sock.on("timeout", () => {
            sock.destroy();
            reply.send({ status: "error", message: "Connection timed out (5s)" });
            resolve();
          });
        });
      },
    );

    // ── GET /platform/settings/scim ─────────────────────────────────────
    app.get(
      withPrefix(prefix, "/platform/settings/scim"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GetScimSettings`,
          summary: "Get SCIM provisioning configuration",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const scimCfg = operationalStore.scim;
        const envToken = !!process.env.SPACEHARBOR_SCIM_TOKEN;
        return reply.send({
          enabled: scimCfg?.enabled ?? resolveIamFlags().enableScimSync,
          configured: envToken || !!scimCfg?.tokenHash,
          tokenSource: envToken ? "env" : (scimCfg?.tokenHash ? "settings" : "none"),
          defaultRole: scimCfg?.defaultRole ?? "viewer",
        });
      },
    );

    // ── PUT /platform/settings/scim ─────────────────────────────────────
    app.put<{ Body: Record<string, unknown> }>(
      withPrefix(prefix, "/platform/settings/scim"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}SaveScimSettings`,
          summary: "Update SCIM provisioning configuration",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const b = request.body as Record<string, unknown>;
        const existing = operationalStore.scim;
        operationalStore.scim = {
          enabled: b["enabled"] === true,
          tokenHash: existing?.tokenHash ?? "",
          defaultRole: String(b["defaultRole"] ?? existing?.defaultRole ?? "viewer"),
        };
        // Also update the IAM feature flag for SCIM
        if (typeof b["enabled"] === "boolean") {
          const overrides = getIamRuntimeOverrides();
          overrides.enableScimSync = b["enabled"] as boolean;
          setIamRuntimeOverrides(overrides);
          if (settingsStoreRef) settingsStoreRef.set("platform.iam", overrides as unknown as Record<string, unknown>);
        }
        persistOperationalStore();
        return reply.send({
          status: "ok",
          enabled: operationalStore.scim.enabled,
          configured: !!operationalStore.scim.tokenHash || !!process.env.SPACEHARBOR_SCIM_TOKEN,
          defaultRole: operationalStore.scim.defaultRole,
        });
      },
    );

    // ── POST /platform/settings/scim/generate-token ─────────────────────
    app.post(
      withPrefix(prefix, "/platform/settings/scim/generate-token"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${opPrefix}GenerateScimToken`,
          summary: "Generate a new SCIM bearer token",
          description: "Returns the plaintext token ONCE. Store it securely — it cannot be retrieved again.",
        },
      },
      async (request, reply) => {
        if (denyUnlessAdmin(request, reply)) return;
        const crypto = await import("node:crypto");
        const token = crypto.randomBytes(32).toString("base64url");
        const hash = crypto.createHash("sha256").update(token).digest("hex");
        if (!operationalStore.scim) {
          operationalStore.scim = { enabled: true, tokenHash: hash, defaultRole: "viewer" };
        } else {
          operationalStore.scim.tokenHash = hash;
        }
        persistOperationalStore();
        return reply.send({
          status: "ok",
          token, // plaintext — shown once
          message: "Copy this token now. You will not be able to see it again.",
        });
      },
    );
  }
}
