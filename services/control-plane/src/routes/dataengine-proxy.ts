/**
 * DataEngine Proxy routes — forward CRUD requests to the real VAST DataEngine API.
 *
 * All routes require `admin:system_config` permission.
 * Existing local catalogue routes in dataengine.ts are preserved for offline/dev fallback.
 *
 * Route prefix: /api/v1/dataengine-proxy/*
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import { proxyToVast, type ProxyContext } from "../vast/dataengine-proxy.js";
import { VmsTokenManager } from "../vast/vms-token-manager.js";

interface DataEngineProxyConfig {
  getVastUrl: () => string | null;
  getCredentials: () => { username: string; password: string } | null;
}

/**
 * Guard that ensures VAST DataEngine is configured and returns a ProxyContext.
 * Returns null and sends an error reply if not configured.
 */
function getProxyContext(
  request: FastifyRequest,
  reply: FastifyReply,
  config: DataEngineProxyConfig,
  tokenManagerRef: { current: VmsTokenManager | null },
): ProxyContext | null {
  const vastUrl = config.getVastUrl();
  const creds = config.getCredentials();

  if (!vastUrl || !creds) {
    sendError(request, reply, 503, "NOT_CONFIGURED",
      "VAST DataEngine is not configured. Set the DataEngine URL and VMS credentials in Settings.");
    return null;
  }

  // Reuse or create token manager (recreate if credentials changed)
  if (!tokenManagerRef.current) {
    tokenManagerRef.current = new VmsTokenManager(vastUrl, creds);
  }

  return {
    tokenManager: tokenManagerRef.current,
    vastBaseUrl: vastUrl,
  };
}

type RouteSpec = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  vastPath: string;
  operationId: string;
  summary: string;
  hasParams?: boolean;
  hasBody?: boolean;
};

/**
 * All proxy route definitions.
 * Each maps a SpaceHarbor path to a VAST DataEngine API path.
 */
const ROUTE_SPECS: RouteSpec[] = [
  // Dashboard
  { method: "GET", path: "/dataengine-proxy/dashboard/stats", vastPath: "/api/latest/dataengine/dashboard/stats", operationId: "ProxyDashboardStats", summary: "Get DataEngine dashboard stats" },
  { method: "GET", path: "/dataengine-proxy/dashboard/events-stats", vastPath: "/api/latest/dataengine/dashboard/events-stats", operationId: "ProxyDashboardEventsStats", summary: "Get DataEngine events stats" },
  { method: "GET", path: "/dataengine-proxy/dashboard/execution-time", vastPath: "/api/latest/dataengine/dashboard/execution-time", operationId: "ProxyDashboardExecutionTime", summary: "Get DataEngine execution time stats" },

  // Functions
  { method: "GET", path: "/dataengine-proxy/functions", vastPath: "/api/latest/dataengine/functions/", operationId: "ProxyListFunctions", summary: "List VAST DataEngine functions" },
  { method: "POST", path: "/dataengine-proxy/functions", vastPath: "/api/latest/dataengine/functions/", operationId: "ProxyCreateFunction", summary: "Create a VAST DataEngine function", hasBody: true },
  { method: "PUT", path: "/dataengine-proxy/functions/:guid", vastPath: "/api/latest/dataengine/functions/{guid}", operationId: "ProxyUpdateFunction", summary: "Update a VAST DataEngine function", hasParams: true, hasBody: true },
  { method: "DELETE", path: "/dataengine-proxy/functions/:guid", vastPath: "/api/latest/dataengine/functions/{guid}", operationId: "ProxyDeleteFunction", summary: "Delete a VAST DataEngine function", hasParams: true },

  // Function Revisions
  { method: "GET", path: "/dataengine-proxy/function-revisions", vastPath: "/api/latest/dataengine/function-revisions/", operationId: "ProxyListFunctionRevisions", summary: "List function revisions" },
  { method: "POST", path: "/dataengine-proxy/function-revisions", vastPath: "/api/latest/dataengine/function-revisions/", operationId: "ProxyCreateFunctionRevision", summary: "Create a function revision", hasBody: true },
  { method: "POST", path: "/dataengine-proxy/function-revisions/:guid/publish", vastPath: "/api/latest/dataengine/function-revisions/{guid}/publish", operationId: "ProxyPublishFunctionRevision", summary: "Publish a function revision", hasParams: true },

  // Triggers
  { method: "GET", path: "/dataengine-proxy/triggers", vastPath: "/api/latest/dataengine/triggers/", operationId: "ProxyListTriggers", summary: "List VAST DataEngine triggers" },
  { method: "POST", path: "/dataengine-proxy/triggers", vastPath: "/api/latest/dataengine/triggers/", operationId: "ProxyCreateTrigger", summary: "Create a VAST DataEngine trigger", hasBody: true },
  { method: "PUT", path: "/dataengine-proxy/triggers/:guid", vastPath: "/api/latest/dataengine/triggers/{guid}", operationId: "ProxyUpdateTrigger", summary: "Update a VAST DataEngine trigger", hasParams: true, hasBody: true },
  { method: "DELETE", path: "/dataengine-proxy/triggers/:guid", vastPath: "/api/latest/dataengine/triggers/{guid}", operationId: "ProxyDeleteTrigger", summary: "Delete a VAST DataEngine trigger", hasParams: true },

  // Pipelines
  { method: "GET", path: "/dataengine-proxy/pipelines", vastPath: "/api/latest/dataengine/pipelines", operationId: "ProxyListPipelines", summary: "List VAST DataEngine pipelines" },
  { method: "GET", path: "/dataengine-proxy/pipelines/:id", vastPath: "/api/latest/dataengine/pipelines/{id}", operationId: "ProxyGetPipeline", summary: "Get a VAST DataEngine pipeline", hasParams: true },
  { method: "POST", path: "/dataengine-proxy/pipelines", vastPath: "/api/latest/dataengine/pipelines/", operationId: "ProxyCreatePipeline", summary: "Create a VAST DataEngine pipeline", hasBody: true },
  { method: "PUT", path: "/dataengine-proxy/pipelines/:id", vastPath: "/api/latest/dataengine/pipelines/{id}", operationId: "ProxyUpdatePipeline", summary: "Update a VAST DataEngine pipeline", hasParams: true, hasBody: true },
  { method: "DELETE", path: "/dataengine-proxy/pipelines/:id", vastPath: "/api/latest/dataengine/pipelines/{id}", operationId: "ProxyDeletePipeline", summary: "Delete a VAST DataEngine pipeline", hasParams: true },
  { method: "POST", path: "/dataengine-proxy/pipelines/:id/deploy", vastPath: "/api/latest/dataengine/pipeline/{id}/deploy", operationId: "ProxyDeployPipeline", summary: "Deploy a VAST DataEngine pipeline", hasParams: true },

  // Pipeline Revisions
  { method: "GET", path: "/dataengine-proxy/pipeline-revisions", vastPath: "/api/latest/dataengine/pipeline-revisions/", operationId: "ProxyListPipelineRevisions", summary: "List pipeline revisions" },

  // Supporting Resources
  { method: "GET", path: "/dataengine-proxy/container-registries", vastPath: "/api/latest/dataengine/container-registries/", operationId: "ProxyListContainerRegistries", summary: "List container registries" },
  { method: "GET", path: "/dataengine-proxy/kubernetes-clusters", vastPath: "/api/latest/dataengine/kubernetes-clusters/", operationId: "ProxyListKubernetesClusters", summary: "List Kubernetes clusters" },
  { method: "POST", path: "/dataengine-proxy/kubernetes-secrets", vastPath: "/api/latest/dataengine/kubernetes-secrets", operationId: "ProxyCreateKubernetesSecret", summary: "Create a Kubernetes secret", hasBody: true },
  { method: "GET", path: "/dataengine-proxy/topics", vastPath: "/api/latest/dataengine/topics/", operationId: "ProxyListTopics", summary: "List Event Broker topics" },
  { method: "POST", path: "/dataengine-proxy/topics", vastPath: "/api/latest/dataengine/topics/", operationId: "ProxyCreateTopic", summary: "Create an Event Broker topic", hasBody: true },

  // Telemetry
  { method: "GET", path: "/dataengine-proxy/telemetries/traces", vastPath: "/api/latest/dataengine/telemetries/traces", operationId: "ProxyListTraces", summary: "List DataEngine traces" },
  { method: "GET", path: "/dataengine-proxy/telemetries/trace-tree", vastPath: "/api/latest/dataengine/telemetries/trace-tree", operationId: "ProxyGetTraceTree", summary: "Get trace span tree" },
  { method: "GET", path: "/dataengine-proxy/telemetries/logs", vastPath: "/api/latest/dataengine/telemetries/logs", operationId: "ProxyListLogs", summary: "List DataEngine logs" },
  { method: "GET", path: "/dataengine-proxy/telemetries/span-logs", vastPath: "/api/latest/dataengine/telemetries/span-logs", operationId: "ProxyGetSpanLogs", summary: "Get logs for a specific span" },
];

/**
 * Resolve a VAST path template with route params.
 * e.g. "/api/latest/dataengine/functions/{guid}" + { guid: "abc" }
 *    → "/api/latest/dataengine/functions/abc"
 */
function resolveVastPath(template: string, params: Record<string, string>): string {
  let resolved = template;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(value));
  }
  return resolved;
}

export async function registerDataEngineProxyRoutes(
  app: FastifyInstance,
  prefixes: string[],
  config: DataEngineProxyConfig,
): Promise<void> {
  // Shared token manager reference — created lazily on first request
  const tokenManagerRef: { current: VmsTokenManager | null } = { current: null };

  // Invalidate token manager when credentials change
  app.addHook("onRequest", async (request) => {
    // Check if this is a settings update that might change VMS credentials
    if (
      request.method === "POST" &&
      request.url.includes("/platform/settings") &&
      tokenManagerRef.current
    ) {
      // Will be recreated on next proxy request with fresh credentials
      tokenManagerRef.current.clear();
      tokenManagerRef.current = null;
    }
  });

  for (const prefix of prefixes) {
    for (const spec of ROUTE_SPECS) {
      const fullPath = withPrefix(prefix, spec.path);
      const opPrefix = prefix.replace(/\W/g, "") || "root";

      const schema = {
        tags: ["dataengine-proxy"],
        operationId: `${opPrefix}${spec.operationId}`,
        summary: spec.summary,
        ...(spec.hasParams
          ? {
              params: {
                type: "object" as const,
                properties: {
                  guid: { type: "string" as const },
                  id: { type: "string" as const },
                },
              },
            }
          : {}),
      };

      const handler = async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = getProxyContext(request, reply, config, tokenManagerRef);
        if (!ctx) return; // Error already sent

        const params = (request.params ?? {}) as Record<string, string>;
        const vastPath = resolveVastPath(spec.vastPath, params);

        return proxyToVast(request, reply, spec.method, vastPath, ctx);
      };

      switch (spec.method) {
        case "GET":
          app.get(fullPath, { schema }, handler);
          break;
        case "POST":
          app.post(fullPath, { schema }, handler);
          break;
        case "PUT":
          app.put(fullPath, { schema }, handler);
          break;
        case "DELETE":
          app.delete(fullPath, { schema }, handler);
          break;
      }
    }
  }
}
