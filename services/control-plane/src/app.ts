import Fastify, { type FastifyInstance } from "fastify";

import { resolveCorrelationId } from "./http/correlation.js";
import { attachAuditHooks, attachLimitTripwire, attachMetricsHooks } from "./http/hooks.js";
import { registerOpenApi } from "./http/openapi.js";
import { createPersistenceAdapter } from "./persistence/factory.js";
import type { PersistenceAdapter } from "./persistence/types.js";
import { FileSettingsStore } from "./persistence/settings-store.js";
import { createLeaseReapingRunner } from "./reaping/lease-reaping.js";
import { createAuditRetentionRunner } from "./retention/audit-retention.js";
import { registerAssetsRoute } from "./routes/assets.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerDlqRoute } from "./routes/dlq.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerIncidentRoute } from "./routes/incident.js";
import { registerIngestRoute } from "./routes/ingest.js";
import { registerJobsRoute } from "./routes/jobs.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerOutboxRoute } from "./routes/outbox.js";
import { registerApprovalRoutes } from "./routes/approval.js";
import { registerDccRoute } from "./routes/dcc.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerReviewSessionRoutes } from "./routes/review-sessions.js";
import { registerQueueRoute } from "./routes/queue.js";
import { registerVastEventsRoute } from "./routes/vast-events.js";
import { registerMaterialsRoute } from "./routes/materials.js";
import { registerTimelinesRoute } from "./routes/timelines.js";
import { registerEventsStreamRoute } from "./routes/events-stream.js";
import { registerUploadRoute } from "./routes/upload.js";
import { registerHierarchyRoute } from "./routes/hierarchy.js";
import { registerCommentRoutes } from "./routes/comments.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerPlaylistRoutes } from "./routes/playlists.js";
import { registerVersionComparisonRoutes } from "./routes/version-comparisons.js";
import { registerProvenanceRoutes } from "./routes/provenance.js";
import { registerDependencyRoutes } from "./routes/dependencies.js";
import { registerCapacityRoutes } from "./routes/capacity.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerLineageRoutes } from "./routes/lineage.js";
import { registerAuditDecisionsRoute } from "./routes/audit-decisions.js";
import { registerIamMetricsRoute } from "./routes/iam-metrics.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerPlatformSettingsRoutes } from "./routes/platform-settings.js";
import { registerVersionDetailRoute } from "./routes/version-detail.js";
import { registerWorkRoutes } from "./routes/work.js";
import { registerShotRoutes } from "./routes/shots.js";
import { registerDeliveryRoutes } from "./routes/delivery.js";
import { registerNavBadgeRoutes } from "./routes/nav-badges.js";
import { registerStorageBrowseRoutes } from "./routes/storage-browse.js";
import { registerStorageMetadataRoutes } from "./routes/storage-metadata.js";
import { registerAssetMetadataRoute } from "./routes/asset-metadata.js";
import { registerAssetStatsRoute } from "./routes/asset-stats.js";
import { registerAssetIntegrityRoute } from "./routes/asset-integrity.js";
import { registerDataEnginePipelineRoutes } from "./routes/dataengine-pipelines.js";
import { registerDataEnginePipelineDefaultsRoute } from "./routes/dataengine-pipelines-defaults.js";
import { registerMetadataLookupProxyRoute } from "./routes/metadata-lookup-proxy.js";
import { registerStorageProcessRoutes } from "./routes/storage-process.js";
import { registerAssetActionRoutes } from "./routes/asset-actions.js";
import { registerCustomFieldsRoute } from "./routes/custom-fields.js";
import { registerCheckinRoute } from "./routes/checkin.js";
import { registerTriggersRoute } from "./routes/triggers.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkflowsRoute } from "./routes/workflows.js";
import { registerNamingTemplatesRoute } from "./routes/naming-templates.js";
import { registerPluginsRoute } from "./routes/plugins.js";
import { registerScannerIngestRoute } from "./routes/scanner-ingest.js";
import { registerBreakersRoute } from "./routes/breakers.js";
import { registerDispatchesRoute } from "./routes/dispatches.js";
import { registerPromMetricsRoute } from "./routes/prom-metrics.js";
import { registerAuditVerifyRoute } from "./routes/audit-verify.js";
import { TriggerConsumer } from "./automation/trigger-consumer.js";
import { DataEngineDispatchService, DispatchPollingDetector } from "./automation/dataengine-dispatch.js";
import { createConfluentKafkaClient } from "./events/confluent-kafka.js";
import { VastEventSubscriber } from "./events/vast-event-subscriber.js";
import { TrinoClient } from "./db/trino-client.js";
import { resolveIamFlags, validateIamInsecureMode } from "./iam/feature-flags.js";
import { resolveAuth, resolveValidApiKeys, isValidApiKey, setRoleBindingService } from "./iam/auth-plugin.js";
import { evaluateRouteAuthz } from "./iam/authz-engine.js";
import { createAuthzLogger } from "./iam/authz-logger.js";
import { AuthRateLimiter } from "./iam/rate-limiter.js";
import { registerSecurityHeaders } from "./iam/security-headers.js";
import { PersistentRoleBindingService } from "./iam/persistent-role-binding.js";
import { RoleBindingService } from "./iam/role-binding.js";
import { registerIamRoutes, passwordStore } from "./routes/iam.js";
import { registerDeviceAuthRoutes } from "./routes/device-auth.js";
import { registerScimRoutes } from "./routes/scim.js";
import { hashPassword } from "./iam/local-auth.js";
import { csrfHook } from "./iam/csrf.js";
import { FunctionRegistry, ExrInspectorFunction, OiioProxyFunction } from "./data-engine/index.js";
import { registerDataEngineRoutes } from "./routes/dataengine.js";
import { registerDataEngineProxyRoutes } from "./routes/dataengine-proxy.js";
import { getVastDataEngineUrl, getVastDataEngineCredentials, getVastDataEngineTenant, buildTrinoFromSettings } from "./routes/platform-settings.js";

// Augment Fastify request with identity
declare module "fastify" {
  interface FastifyRequest {
    identity: string | null;
  }
}

interface BuildAppOptions {
  persistenceAdapter?: PersistenceAdapter;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const persistence = options.persistenceAdapter ?? createPersistenceAdapter();
  persistence.reset();
  const auditRetention = createAuditRetentionRunner(persistence);
  const triggerConsumer = new TriggerConsumer(persistence);
  const dispatchService = new DataEngineDispatchService(persistence);
  const dispatchPoller = new DispatchPollingDetector(persistence);
  const leaseReaping = createLeaseReapingRunner(persistence);
  const prefixes = ["", "/api/v1"];

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // Phase 8: IAM feature flags & authz decision logger
  const iamFlags = resolveIamFlags();

  // Phase 1 (secure-by-default): validate IAM insecure-mode gating at construction
  // time so misconfigured deployments fail before registering any routes.
  validateIamInsecureMode(iamFlags.iamEnabled);

  const authzLogger = createAuthzLogger();
  const rateLimiter = new AuthRateLimiter();

  // Decorate request with identity (must happen before hooks run)
  app.decorateRequest("identity", null);
  // `rawBody` is populated by the JSON content-type parser below for
  // routes that need to verify signatures against the exact request bytes
  // (inbound webhooks HMAC check).
  app.decorateRequest("rawBody", null);

  // Replace Fastify's default JSON parser with one that stashes the raw
  // string onto request.rawBody before parsing. Other routes keep seeing
  // `request.body` as the parsed object.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      (request as unknown as { rawBody: string | null }).rawBody = body as string;
      if (!body || (body as string).length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Phase 1.3: Security response headers (HSTS, X-Content-Type-Options, X-Frame-Options)
  registerSecurityHeaders(app);

  registerOpenApi(app);

  // Framework-enforced request hooks (attached directly so they apply
  // globally — Fastify plugin encapsulation would scope hooks only to
  // routes registered inside the plugin).
  //  - attachLimitTripwire caps pathological `?limit=...` values at
  //    SPACEHARBOR_MAX_LIST_LIMIT (default 500) before route handlers see them.
  //  - attachAuditHooks runs after persistence is resolved (see below).
  attachLimitTripwire(app);
  attachMetricsHooks(app);

  // CORS support for cross-origin browser requests (web-ui on different port/host)
  const allowedOrigins = new Set([
    "http://localhost:4173",
    "http://localhost:4174",
    "http://localhost:5173",
    ...(process.env.SPACEHARBOR_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
      reply.header("access-control-allow-headers", "content-type, authorization, x-api-key, x-user-identity, x-csrf-token");
      reply.header("access-control-expose-headers", "x-correlation-id");
    }
    if (request.method === "OPTIONS") {
      reply.header("access-control-max-age", "86400");
      return reply.status(204).send();
    }
  });

  // Phase 4: TLS enforcement — checked on every request via X-Forwarded-Proto.
  // Enabled by default in non-dev environments; override with SPACEHARBOR_REQUIRE_TLS=false.
  const nodeEnvForTls = process.env.NODE_ENV?.trim();
  const isDevMode = nodeEnvForTls === "development";
  const tlsEnforced = isDevMode
    ? (process.env.SPACEHARBOR_REQUIRE_TLS === "true")
    : (process.env.SPACEHARBOR_REQUIRE_TLS !== "false");

  if (tlsEnforced) {
    app.log.info("TLS enforcement: enabled (trusting X-Forwarded-Proto header)");
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!tlsEnforced) return;

    const proto = request.headers["x-forwarded-proto"];
    if (!proto) {
      // Header absent — proxy may not set it; allow but log once per request
      app.log.debug({ url: request.url }, "TLS: X-Forwarded-Proto absent — allowing request");
      return;
    }

    // Normalize multi-value header (some proxies send "https, http")
    const firstProto = (Array.isArray(proto) ? proto[0] : proto).split(",")[0].trim().toLowerCase();
    if (firstProto !== "https") {
      const remoteIp = request.ip ?? "";
      const isLocalhost =
        remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
      if (!isLocalhost) {
        reply.status(421).send({
          code: "HTTPS_REQUIRED",
          message: "HTTPS required",
          requestId: request.id,
          details: null,
        });
        return;
      }
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header("x-correlation-id", correlationId);

    // --- Identity propagation (always runs) ---
    const identityHeader = request.headers["x-user-identity"];
    if (typeof identityHeader === "string" && identityHeader.trim()) {
      request.identity = identityHeader.trim();
    }

    // Phase 8: When IAM is enabled, use the new auth plugin for identity resolution
    if (iamFlags.iamEnabled) {
      try {
        // Public endpoints that don't require authentication.
        // NOTE: /.well-known/openid-configuration is intentionally NOT listed here.
        // SpaceHarbor is an OIDC consumer — it validates incoming JWTs via JWKS but does
        // not serve an OIDC discovery document. Bypassing auth for that path would leak
        // server info and expose a 404 to OIDC clients expecting a provider endpoint.
        const urlPath = request.url.split("?")[0];
        if (
          urlPath.endsWith("/health") ||
          urlPath.endsWith("/health/ready") ||
          urlPath.endsWith("/auth/login") ||
          urlPath.endsWith("/auth/refresh") ||
          urlPath.endsWith("/events/stream") ||
          urlPath.endsWith("/device/code") ||
          urlPath.endsWith("/device/token") ||
          urlPath.endsWith("/openapi.json") ||
          urlPath.startsWith("/api/docs") ||
          // Prometheus /metrics — OpenMetrics convention is unauthenticated.
          // Most scrapers don't support bearer auth; scrape from inside the
          // cluster network or front it with nginx basic-auth if needed.
          urlPath === "/metrics" ||
          // Inbound webhook handler (/webhooks/:id + /api/v1/webhooks/:id).
          // Auth is the HMAC signature — a missing/bad signature returns 401
          // from the route handler, not from this hook.
          /^(\/api\/v1)?\/webhooks\/[^/]+$/.test(urlPath) ||
          // Scanner ingest forwarder — same HMAC-only model as inbound
          // webhooks. Secret is SPACEHARBOR_SCANNER_SECRET; the Python
          // forwarder in services/scanner-function/ POSTs here.
          /^(\/api\/v1)?\/scanner\/ingest$/.test(urlPath)
        ) {
          return;
        }

        // Fail-closed: when IAM is enabled, requests without credentials must be denied.
        // Route handlers must NOT decide access for unauthenticated requests.
        const authHeader = request.headers.authorization;
        const apiKey = request.headers["x-api-key"];
        const serviceToken = request.headers["x-service-token"];
        const hasCredentials = !!(authHeader || apiKey || serviceToken);

        if (!hasCredentials) {
          reply.status(401).send({
            code: "UNAUTHORIZED",
            message: "authentication required",
            requestId: request.id,
            details: null,
          });
          return;
        }

        // Validate provided credentials
        const authResult = await resolveAuth(
          request.headers as Record<string, string | string[] | undefined>,
          iamFlags,
        );

        if (!authResult.ok) {
          reply.status(authResult.statusCode).send({
            code: authResult.code,
            message: "authentication failed",
            requestId: request.id,
            details: null,
          });
          return;
        }

        // Auth succeeded — attach context to request
        (request as any).iamContext = authResult.context;

        // Shadow/enforcement authz evaluation
        const authzResult = evaluateRouteAuthz(
          authResult.context,
          request.method,
          request.url.split("?")[0],
          iamFlags,
        );
        if (authzResult?.decision === "deny") {
          authzLogger.logDecision(authzResult);
          reply.status(403).send({
            code: "FORBIDDEN",
            message: `insufficient permissions: ${authzResult.permission}`,
            requestId: request.id,
            details: { reason: authzResult.reason },
          });
          return;
        }
        if (authzResult) {
          authzLogger.logDecision(authzResult);
        }
      } catch (hookError) {
        // Fail-closed: auth errors must not let requests through unauthenticated
        console.error("[auth-hook] unexpected error — denying request:", (hookError as Error)?.message);
        reply.status(500).send({
          code: "INTERNAL_ERROR",
          message: "internal server error",
          requestId: request.id,
          details: null,
        });
        return;
      }
      return;
    }

    // Legacy auth: identity enforcement + API key check (pre-Phase 8)
    const identityMode = process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT ?? "relaxed";
    const isWriteMethod = request.method === "POST" || request.method === "PUT" || request.method === "PATCH" || request.method === "DELETE";

    if (identityMode === "strict" && isWriteMethod && !request.identity) {
      reply.status(401).send({
        code: "IDENTITY_REQUIRED",
        message: "x-user-identity header is required for write operations",
        requestId: request.id,
        details: null
      });
      return;
    }

    // --- API key enforcement ---
    // Supports per-service credentials via SPACEHARBOR_API_KEYS (comma-separated)
    // with backward compat for single SPACEHARBOR_API_KEY.
    const validKeys = resolveValidApiKeys();

    if (validKeys.length === 0 || !isWriteMethod) {
      return;
    }

    const providedApiKey = request.headers["x-api-key"];
    if (!providedApiKey || typeof providedApiKey !== "string") {
      reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "missing API key",
        requestId: request.id,
        details: null
      });
      return;
    }

    if (!isValidApiKey(providedApiKey)) {
      reply.status(403).send({
        code: "FORBIDDEN",
        message: "invalid API key",
        requestId: request.id,
        details: null
      });
      return;
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    // Fastify validation errors and empty-body errors carry a statusCode — respect it
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      app.log.error(error, "unhandled route error");
    } else {
      app.log.warn(error, "client error");
    }
    reply.status(status).send({
      code: status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
      message: status >= 500 ? "internal server error" : (error.message || "bad request"),
      requestId: request.id,
      details: null,
    });
  });

  // Framework-enforced audit trail. Attaches the onResponse hook globally
  // so every mutation emits an audit row.
  attachAuditHooks(app, persistence);

  app.after(() => {
    void registerHealthRoute(app, persistence, { iamFlags });
    void registerApprovalRoutes(app, persistence, prefixes);
    void registerAssetsRoute(app, persistence, prefixes);
    void registerAssetActionRoutes(app, persistence, prefixes);
    void registerCustomFieldsRoute(app, persistence, prefixes);
    void registerCheckinRoute(app, persistence, prefixes);
    void registerTriggersRoute(app, persistence, prefixes);
    void registerWebhookRoutes(app, persistence, prefixes);
    void registerWorkflowsRoute(app, persistence, prefixes);
    void registerNamingTemplatesRoute(app, persistence, prefixes);
    void registerPluginsRoute(app, persistence, prefixes);
    void registerScannerIngestRoute(app, persistence, prefixes);
    void registerBreakersRoute(app, prefixes);
    void registerDispatchesRoute(app, persistence, dispatchPoller, prefixes);
    void registerPromMetricsRoute(app, persistence);
    void registerAuditVerifyRoute(app, persistence, prefixes);
    void registerAuditRoute(app, persistence, prefixes);
    void registerIncidentRoute(app, persistence, prefixes);
    void registerIngestRoute(app, persistence, prefixes);
    void registerEventsRoute(app, persistence, prefixes);
    void registerVastEventsRoute(app, persistence, prefixes);
    void registerJobsRoute(app, persistence, prefixes);
    void registerQueueRoute(app, persistence);
    void registerOutboxRoute(app, persistence);
    void registerDccRoute(app, persistence, prefixes);
    void registerReviewRoutes(app, persistence, prefixes);
    void registerReviewSessionRoutes(app, persistence, prefixes);
    void registerDlqRoute(app, persistence);
    void registerMetricsRoute(app, persistence);
    void registerMaterialsRoute(app, persistence);
    void registerTimelinesRoute(app, persistence);
    void registerEventsStreamRoute(app, persistence, prefixes);
    void registerUploadRoute(app, prefixes);
    void registerHierarchyRoute(app, persistence, prefixes);
    void registerCommentRoutes(app, persistence, prefixes);
    void registerCollectionRoutes(app, persistence, prefixes);
    void registerPlaylistRoutes(app, persistence, prefixes);
    void registerVersionComparisonRoutes(app, persistence, prefixes);
    void registerProvenanceRoutes(app, persistence, prefixes);
    void registerDependencyRoutes(app, persistence);
    void registerCapacityRoutes(app, persistence, prefixes);
    void registerLineageRoutes(app, persistence, prefixes);
    void registerVersionDetailRoute(app, persistence, prefixes);
    void registerWorkRoutes(app, persistence, prefixes);
    void registerShotRoutes(app, persistence, prefixes);
    void registerDeliveryRoutes(app, persistence, prefixes);
    void registerNavBadgeRoutes(app, persistence, prefixes);

    // S3 storage browse — direct file discovery without Trino
    void registerStorageBrowseRoutes(app, prefixes);

    // S3 single-file sidecar reader — powers dynamic metadata panel in web-ui
    void registerStorageMetadataRoutes(app, prefixes);

    // DataEngine pipelines — live merge of Settings + VAST function records
    void registerDataEnginePipelineRoutes(app, prefixes);
    void registerDataEnginePipelineDefaultsRoute(app, prefixes);
    void registerMetadataLookupProxyRoute(app, prefixes);

    // Storage processing trigger — S3 copy-in-place to fire element triggers
    void registerStorageProcessRoutes(app, prefixes);

    // DataEngine function catalogue + pipeline listing
    void registerDataEngineRoutes(app, functionRegistry, prefixes);

    // DataEngine proxy — forward CRUD requests to VAST DataEngine API
    void registerDataEngineProxyRoutes(app, prefixes, {
      getVastUrl: getVastDataEngineUrl,
      getCredentials: getVastDataEngineCredentials,
      getTenant: getVastDataEngineTenant,
    });

    // Platform settings (admin configuration UI) — backed by file-based settings store
    const settingsStore = new FileSettingsStore();
    void registerPlatformSettingsRoutes(app, prefixes, settingsStore);

    // Phase 3.3: IAM metrics endpoint
    void registerIamMetricsRoute(app, () => authzLogger, prefixes);

    // C.10: VAST Catalog routes (read-only, require VAST Database connection)
    // Phase 1.2: Wire IAM persistence — use PersistentRoleBindingService when VAST DB is available
    // Uses buildTrinoFromSettings() which checks: platform settings store > env vars.
    // This allows the admin to configure VAST Database via the Settings UI without
    // requiring env var changes and container restarts.
    const catalogTrino = buildTrinoFromSettings();
    void registerCatalogRoutes(app, catalogTrino, prefixes);

    // Unified asset metadata reader (DB + sidecar, dependency-injectable)
    void registerAssetMetadataRoute(app, persistence, prefixes);

    // Phase 6.0 (C1): authoritative catalog-wide counters for <KpiCounterStrip>
    void registerAssetStatsRoute(app, persistence, prefixes);

    // Phase 6.0 (C2): per-asset hashes + keyframes reader for INTEGRITY tab
    void registerAssetIntegrityRoute(app, persistence, prefixes);

    // Phase: Analytics dashboard endpoints (cached, fallback to in-memory)
    void registerAnalyticsRoutes(app, persistence, catalogTrino, prefixes);

    // Phase 3.1: Audit decisions endpoint (requires Trino for persistence queries)
    void registerAuditDecisionsRoute(app, catalogTrino, prefixes);

    // Phase: SQL Query Console endpoints (restricted, JWT-only, audited)
    void registerQueryRoutes(app, catalogTrino, prefixes);

    // Phase 1.2: Select IAM role binding backend
    // Use a getter from app so the onReady fallback can swap to in-memory.
    const initialRoleBindingService = catalogTrino
      ? new PersistentRoleBindingService(catalogTrino)
      : new RoleBindingService();
    (app as any).roleBindingService = initialRoleBindingService;
    (app as any).roleBindingType = catalogTrino ? "persistent" : "in-memory";
    const getRoleBinding = () => (app as any).roleBindingService as RoleBindingService | PersistentRoleBindingService;

    // Phase 2: Local Auth & User Management
    void registerIamRoutes(app, getRoleBinding, prefixes);

    // Phase 2.2: Wire role binding service for JIT user provisioning
    setRoleBindingService(initialRoleBindingService);

    // Phase 2.5: SCIM inbound endpoints
    void registerScimRoutes(app, getRoleBinding);

    // Phase 3.5: Device Authorization Grant (DCC plugins)
    void registerDeviceAuthRoutes(app, getRoleBinding, prefixes);

    // Phase 3.2: CSRF protection hook (registered after routes)
    app.addHook("onRequest", csrfHook);
  });

  // Expose internals for test scaffolding
  (app as any).persistence = persistence;
  (app as any).iamFlags = iamFlags;
  (app as any).authzLogger = authzLogger;

  // Phase 1.1: DataEngine function registry — register all known functions at startup.
  // The registry is the single source of truth for functions available to the pipeline.
  //
  // Executable TypeScript stubs are registered via register(). Functions that run as
  // Python containers inside VAST DataEngine are registered via registerMetadata() so
  // they appear in the API catalogue without a local execute() stub.
  const functionRegistry = new FunctionRegistry();

  // --- Executable stubs (TypeScript, local dev + VAST DataEngine proxy) ---
  functionRegistry.register(new ExrInspectorFunction());
  functionRegistry.register(new OiioProxyFunction());

  // --- Catalogue metadata for all 9 canonical DataEngine functions ---
  // exr-inspector and oiio-proxy-generator metadata is provided here so the
  // API returns rich names/categories; the executable stubs above handle execution.

  functionRegistry.registerMetadata({
    id: "exr_inspector",
    name: "EXR Inspector",
    description:
      "Extract technical metadata from OpenEXR sequences: resolution, channels, colorspace, " +
      "frame range, pixel aspect ratio, display/data windows, compression type, and file integrity checksum.",
    category: "VFX Processing",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["EXR", "DPX"],
    outputs: ["metadata:JSON"],
    status: "active",
    dbSchema: "exr_metadata",
    queryBridge: "vastdb-query:8070",
  });

  functionRegistry.registerMetadata({
    id: "oiio_proxy_generator",
    name: "OIIO Proxy Generator",
    description:
      "Generate JPEG thumbnails (256×256) and H.264 review proxies (1920×1080) from EXR or DPX " +
      "source frames using OpenImageIO. Writes output paths back to the asset record.",
    category: "VFX Processing",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["EXR", "DPX"],
    outputs: ["JPEG", "H264"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "ffmpeg_transcoder",
    name: "FFmpeg Transcoder",
    description:
      "Transcode video assets to delivery formats (ProRes 4444, H.264, AV1) with optional " +
      "LUT application and burn-in overlays (timecode, slate, watermark). Supports multi-pass encoding.",
    category: "Delivery & Transcoding",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["MOV", "MXF", "MP4", "EXR"],
    outputs: ["ProRes", "H264", "AV1"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "otio_parser",
    name: "OpenTimelineIO Parser",
    description:
      "Parse OpenTimelineIO editorial timelines to extract cut information, clip references, " +
      "transitions, markers, and metadata for conforming against the shot database.",
    category: "Editorial",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["OTIO", "EDL", "XML"],
    outputs: ["timeline:JSON"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "mtlx_parser",
    name: "MaterialX Parser",
    description:
      "Parse MaterialX shader definitions to extract node graphs, texture references, " +
      "shader parameters, and look definitions for integration into the asset dependency graph.",
    category: "Metadata & Provenance",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["MTLX"],
    outputs: ["material:JSON"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "provenance_recorder",
    name: "Provenance Recorder",
    description:
      "Record file creation provenance at ingest time: originating DCC application, artist identity, " +
      "source host, render job ID, and pipeline stage. Writes immutable provenance records to VastDB.",
    category: "Metadata & Provenance",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["any"],
    outputs: ["provenance:JSON"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "storage_metrics_collector",
    name: "Storage Metrics Collector",
    description:
      "Collect per-project and per-sequence storage metrics from VAST S3 views: object count, " +
      "total bytes, average object size, and growth rate over configurable time windows.",
    category: "Storage",
    language: "Python",
    trigger: "schedule",
    inputs: ["S3:prefix"],
    outputs: ["metrics:JSON"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "dependency_graph_builder",
    name: "Dependency Graph Builder",
    description:
      "Build asset dependency graphs by resolving MaterialX texture references, USD layer stacks, " +
      "and OTIO clip sources into a directed acyclic graph stored in VastDB for lineage queries.",
    category: "Metadata & Provenance",
    language: "Python",
    trigger: "on:tag",
    inputs: ["MTLX", "USD", "OTIO"],
    outputs: ["graph:JSON"],
    status: "active",
  });

  functionRegistry.registerMetadata({
    id: "timeline_conformer",
    name: "Timeline Conformer",
    description:
      "Conform editorial timelines against the shot database: verify clip handles, resolve missing " +
      "media, flag frame-range mismatches, and produce a conformance report with per-cut pass/fail status.",
    category: "Editorial",
    language: "Python",
    trigger: "on:ingest",
    inputs: ["OTIO", "EDL"],
    outputs: ["report:JSON"],
    status: "active",
  });

  (app as any).functionRegistry = functionRegistry;
  console.info(
    `[data-engine] Registered ${functionRegistry.size} executable function(s) and ` +
    `${functionRegistry.listFunctions().length} catalogue entries.`
  );

  // Wire VAST Event Broker subscriber — only when VAST_EVENT_BROKER_URL is configured
  const brokerUrl = process.env.VAST_EVENT_BROKER_URL;
  const topic = process.env.VAST_EVENT_BROKER_TOPIC ?? "spaceharbor.dataengine.completed";
  const groupId = process.env.VAST_EVENT_BROKER_GROUP ?? "spaceharbor-control-plane";

  let subscriber: VastEventSubscriber | null = null;

  if (brokerUrl) {
    // Guard against placeholder URLs that would cause indefinite DNS hangs
    const brokerHost = brokerUrl.replace(/^.*:\/\//, "").split(":")[0];
    if (brokerHost.includes("example") || brokerHost.startsWith("<") || brokerHost.endsWith(">")) {
      console.warn(
        `[kafka] VAST_EVENT_BROKER_URL looks like a placeholder ("${brokerUrl}") — skipping event subscriber. ` +
        "Clear the variable or set a real broker address."
      );
    } else {
      const saslUsername = process.env.VAST_EVENT_BROKER_SASL_USERNAME;
      const saslPassword = process.env.VAST_EVENT_BROKER_SASL_PASSWORD;
      const saslMechanism = (process.env.VAST_EVENT_BROKER_SASL_MECHANISM ?? "plain").toLowerCase() as "plain" | "scram-sha-256" | "scram-sha-512";

      const kafkaClient = createConfluentKafkaClient({
        clientId: "spaceharbor-control-plane",
        brokers: [brokerUrl],
        ssl: process.env.VAST_EVENT_BROKER_SSL === "true",
        ...(saslUsername && saslPassword ? {
          sasl: { mechanism: saslMechanism, username: saslUsername, password: saslPassword },
        } : {}),
      });
      subscriber = new VastEventSubscriber(persistence, kafkaClient, topic, groupId);
    }
  }

  app.addHook("onReady", async () => {
    // -------------------------------------------------------------------------
    // Phase 3: Determine execution mode.
    // Dev mode is ONLY NODE_ENV === "development" — undefined/empty/"staging"/etc.
    // are treated as production.
    // -------------------------------------------------------------------------
    const nodeEnvRaw = process.env.NODE_ENV?.trim();
    const isDev = nodeEnvRaw === "development";
    const persistenceBackend = process.env.SPACEHARBOR_PERSISTENCE_BACKEND?.trim().toLowerCase();
    const fallbackToLocal = process.env.SPACEHARBOR_VAST_FALLBACK_TO_LOCAL?.trim().toLowerCase();

    // Phase 3: Print dev mode banner (only in true dev mode)
    if (isDev) {
      console.warn(
        "\n" +
        "╔══════════════════════════════════════════════════╗\n" +
        "║  INSECURE DEV MODE — NOT FOR PRODUCTION USE     ║\n" +
        "║  IAM enforcement may be relaxed                  ║\n" +
        "║  In-memory persistence (data lost on restart)    ║\n" +
        "║  Bootstrap credentials active                    ║\n" +
        "╚══════════════════════════════════════════════════╝\n"
      );
    }

    // -------------------------------------------------------------------------
    // Phase 2: Fail-closed startup gates
    // -------------------------------------------------------------------------

    // Gate 1: JWT secret strength (all environments except development)
    const jwtSecret = process.env.SPACEHARBOR_JWT_SECRET?.trim() ?? "";
    const hasJwksUri = !!process.env.SPACEHARBOR_OIDC_JWKS_URI?.trim();
    if (!isDev) {
      if (!hasJwksUri && jwtSecret.length < 32) {
        throw new Error(
          "SPACEHARBOR_JWT_SECRET must be set (minimum 32 characters) for secure token issuance. " +
          "Generate one with: openssl rand -base64 32. " +
          "Alternatively, set SPACEHARBOR_OIDC_JWKS_URI to delegate token verification to an external IdP."
        );
      }
    } else if (!hasJwksUri && jwtSecret.length < 32) {
      app.log.warn(
        "[startup] SPACEHARBOR_JWT_SECRET is not set or too short — " +
        "this is only acceptable in development mode."
      );
    }

    // Gate 2: Shadow mode must be off in non-dev environments
    if (!isDev && iamFlags.iamEnabled && iamFlags.shadowMode) {
      throw new Error(
        "Shadow mode is enabled — RBAC decisions are logged but NOT enforced. " +
        "Set SPACEHARBOR_IAM_SHADOW_MODE=false for production."
      );
    }

    if (isDev && iamFlags.iamEnabled && iamFlags.shadowMode) {
      app.log.warn(
        "[startup] IAM shadow mode is active — authorization decisions are logged but NOT enforced."
      );
    }

    // Gate 3 (Phase 5): In-memory persistence outside development requires explicit opt-in
    const vastDbUrl = process.env.VAST_DATABASE_URL?.trim();
    if (!vastDbUrl && !isDev) {
      app.log.warn(
        "WARNING: No VAST_DATABASE_URL configured. Using in-memory persistence. " +
        "ALL DATA WILL BE LOST ON RESTART."
      );
      const allowInsecure = process.env.SPACEHARBOR_ALLOW_INSECURE_MODE === "true";
      if (!allowInsecure) {
        throw new Error(
          "In-memory persistence is not allowed outside development mode. " +
          "Set VAST_DATABASE_URL or SPACEHARBOR_ALLOW_INSECURE_MODE=true."
        );
      }
    }

    // Existing gate: VAST backend connectivity check
    if (persistenceBackend === "vast" && fallbackToLocal === "false") {
      if (vastDbUrl) {
        const url = new URL(vastDbUrl);
        const trino = new TrinoClient({
          endpoint: `${url.protocol}//${url.host}`,
          accessKey: url.username || process.env.VAST_ACCESS_KEY || "",
          secretKey: url.password || process.env.VAST_SECRET_KEY || ""
        });
        const health = await trino.healthCheck();
        if (!health.reachable) {
          throw new Error(
            `VAST persistence required but Trino unreachable at ${url.protocol}//${url.host}. ` +
            `Set SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=true to allow local fallback.`
          );
        }
      }
    }

    // Phase 2.3.1: Startup bootstrap — auto-create super_admin if users table is empty
    // Wrapped in try/catch: if Trino is unreachable or tables don't exist yet,
    // fall back to in-memory role binding and continue startup.
    const adminEmail = process.env.SPACEHARBOR_ADMIN_EMAIL?.trim();
    let roleBindingSvc = (app as any).roleBindingService as RoleBindingService | PersistentRoleBindingService;

    // In-memory IAM fallback is gated by SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK.
    // In dev, it defaults to true (first-boot before "Deploy Schema" runs). In
    // production the default is false — a Trino hiccup MUST NOT silently wipe
    // durable role bindings, which creates a lock-out hazard on next restart.
    const allowInMemoryIamFallback =
      process.env.SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK === "true" ||
      (isDev && process.env.SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK !== "false");

    if (adminEmail && roleBindingSvc) {
      let existingUsers: unknown[] = [];
      let trinoAvailable = true;
      try {
        existingUsers = await Promise.resolve(roleBindingSvc.listUsers());
      } catch (trinoErr) {
        trinoAvailable = false;
        const errMsg = (trinoErr as Error)?.message ?? String(trinoErr);
        if (!allowInMemoryIamFallback) {
          app.log.error(
            `[bootstrap] Trino query failed during startup and in-memory fallback is disabled. ` +
            `Error: ${errMsg}. ` +
            `Set SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK=true to allow fallback (dangerous: ` +
            `wipes durable role bindings), or ensure VAST Database is reachable and ` +
            `"Deploy Schema" has been run.`
          );
          throw new Error(
            `IAM persistence unavailable (${errMsg}) and fallback disabled — aborting startup`
          );
        }
        app.log.error(
          `[bootstrap] Trino query failed during startup — falling back to in-memory IAM. ` +
          `Error: ${errMsg}. ` +
          `Run "Deploy Schema" in Settings to create IAM tables.`
        );
        // Fall back to in-memory role binding (dev only, or explicitly opted-in prod)
        const fallback = new RoleBindingService();
        (app as any).roleBindingService = fallback;
        (app as any).roleBindingType = "in-memory";
        roleBindingSvc = fallback;
        setRoleBindingService(fallback);
      }
      // Expose IAM reachability on readiness probe — ops dashboards can alert
      // when persistenceType flips to "in-memory" unexpectedly.
      (app as any).iamTrinoAvailable = trinoAvailable;
      if (existingUsers.length === 0) {
        const { randomBytes: rb } = await import("node:crypto");
        let adminPassword = process.env.SPACEHARBOR_ADMIN_PASSWORD?.trim() || "";
        let generated = false;
        if (!adminPassword) {
          adminPassword = rb(18).toString("base64url").slice(0, 24);
          generated = true;
        }

        const user = await Promise.resolve(roleBindingSvc.createUser({
          email: adminEmail,
          displayName: "Super Admin",
          status: "active",
        }));

        const hash = await hashPassword(adminPassword);
        passwordStore.set(user.id, { hash, mustChangePassword: true, authMethod: "local" });
        await Promise.resolve(roleBindingSvc.grantGlobalRole(user.id, "super_admin", "startup-bootstrap"));

        if (generated) {
          console.log(`[bootstrap] super_admin created: email=${adminEmail} password=${adminPassword}`);
        } else {
          console.log(`[bootstrap] super_admin created: email=${adminEmail} (password from env)`);
        }
      }
    }

    // Phase 3: Dev bootstrap credentials only created in true development mode
    if (!adminEmail && isDev && roleBindingSvc) {
      let existingUsers: unknown[] = [];
      try {
        existingUsers = await Promise.resolve(roleBindingSvc.listUsers());
      } catch {
        // Trino tables not ready — fall back handled above
      }
      if (existingUsers.length === 0) {
        const devEmail = "admin@spaceharbor.dev";
        const devPassword = "Admin1234!dev";
        const user = await Promise.resolve(roleBindingSvc.createUser({
          email: devEmail,
          displayName: "Dev Admin",
          status: "active",
        }));
        const hash = await hashPassword(devPassword);
        passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });
        await Promise.resolve(roleBindingSvc.grantGlobalRole(user.id, "super_admin", "dev-bootstrap"));
        console.log(`[dev-bootstrap] Default admin created — email: ${devEmail} / password: ${devPassword}`);
      }
    }

    // Background-worker gate: SPACEHARBOR_BACKGROUND_WORKER controls whether
    // this replica runs the periodic/event-driven background runners. In a
    // single-replica deployment (docker compose dev) the default is true.
    // In a multi-replica prod deployment set it to "true" on exactly one
    // replica and "false" on the rest to prevent double-firing of timers
    // and duplicate Kafka consumption.
    //
    // A proper leader-election primitive (Trino advisory lock or Redis lease)
    // lands in Phase 4; the env-gate is the simplest safe default today.
    const isBackgroundWorker =
      process.env.SPACEHARBOR_BACKGROUND_WORKER !== "false";

    // dispatchService is a bus subscriber — it fires on checkin.committed
    // regardless of worker role. Every replica that receives the event
    // writes dispatch rows (idempotent: multiple replicas writing the same
    // checkin is prevented by the bus only firing locally). Keep it ON.
    dispatchService.start();

    if (isBackgroundWorker) {
      auditRetention.start();
      leaseReaping.start();
      rateLimiter.start();
      triggerConsumer.start();
      dispatchPoller.start();
      if (subscriber) {
        await subscriber.start();
      }
      app.log.info(
        { backgroundWorker: true },
        "[startup] background runners started (audit-retention, lease-reap, rate-limit, triggers, dispatch-poller, kafka)",
      );
    } else {
      app.log.info(
        { backgroundWorker: false },
        "[startup] background runners DISABLED (SPACEHARBOR_BACKGROUND_WORKER=false)",
      );
    }
  });

  app.addHook("onClose", async () => {
    const isBackgroundWorker = process.env.SPACEHARBOR_BACKGROUND_WORKER !== "false";
    dispatchService.stop();
    if (isBackgroundWorker) {
      auditRetention.stop();
      leaseReaping.stop();
      rateLimiter.stop();
      triggerConsumer.stop();
      dispatchPoller.stop();
      if (subscriber) {
        await subscriber.stop();
      }
    }
  });

  return app;
}
