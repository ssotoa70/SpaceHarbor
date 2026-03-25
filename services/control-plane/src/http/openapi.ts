import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      info: {
        title: "SpaceHarbor API",
        description: "SpaceHarbor control-plane — VFX/Media Asset Management API",
        version: "1.0.0"
      },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "x-api-key",
            description: "Legacy API key for automation and backward compatibility"
          },
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "JWT bearer token from OIDC identity provider (Phase 8)"
          },
          ServiceTokenAuth: {
            type: "apiKey",
            in: "header",
            name: "x-service-token",
            description: "Machine-to-machine service token for internal services"
          },
          ScimTokenAuth: {
            type: "http",
            scheme: "bearer",
            description: "SCIM 2.0 bearer token (SPACEHARBOR_SCIM_TOKEN env var) for IdP provisioning"
          }
        }
      },
      tags: [
        { name: "assets", description: "Asset lifecycle — ingest, browse, detail, metadata" },
        { name: "platform", description: "Platform configuration, service connections, schema management" },
        { name: "iam", description: "Identity, authentication, and role management" },
        { name: "review", description: "Review sessions, submissions, comments, and approvals" },
        { name: "review-sessions", description: "Review session management — create, list, close, submit" },
        { name: "comments", description: "Review comments and annotation threads" },
        { name: "collections", description: "Playlists, selections, and deliverables" },
        { name: "playlists", description: "Curated playlists for review and delivery" },
        { name: "provenance", description: "Asset provenance, lineage, and dependency tracking" },
        { name: "lineage", description: "Asset lineage graph traversal" },
        { name: "dependencies", description: "Asset dependency management and impact analysis" },
        { name: "events", description: "SSE event stream and workflow notifications" },
        { name: "pipeline", description: "Pipeline monitoring, transcoding, and conformance" },
        { name: "dlq", description: "Dead-letter queue — failed job management and replay" },
        { name: "audit", description: "Authorization decision audit log" },
        { name: "scim", description: "SCIM 2.0 user and group provisioning" },
        { name: "hierarchy", description: "VFX hierarchy — projects, sequences, shots" },
        { name: "materials", description: "MaterialX shader and look management" },
        { name: "timelines", description: "Editorial timelines and OTIO conformance" },
        { name: "dcc", description: "DCC integration endpoints (deprecated)" },
        { name: "versions", description: "Asset version comparison and detail" },
        { name: "capacity", description: "Storage capacity, footprint, and forecast" },
        { name: "catalog", description: "VAST catalog — views, buckets, schemas" },
        { name: "analytics", description: "Dashboard analytics and reporting" },
        { name: "dataengine", description: "VAST DataEngine function registry" },
        { name: "observability", description: "Metrics, counters, and monitoring" },
        { name: "operations", description: "Incident coordination and operational workflows" },
        { name: "workflow", description: "Approval workflows and routing" },
        { name: "work", description: "Work assignments, shot tasks, and delivery tracking" },
        { name: "production", description: "Production management and shot delivery" },
        { name: "navigation", description: "UI navigation badges and counters" },
        { name: "admin", description: "Administrative and privileged operations" },
        { name: "dev", description: "Development-only helper endpoints" },
      ],
      security: [{ BearerAuth: [] }]
    }
  });

  // Swagger UI — available at /api in all environments
  app.register(swaggerUi, {
    routePrefix: "/api",
    staticCSP: true,
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      tryItOutEnabled: true,
    }
  });

  app.get("/openapi.json", async () => app.swagger());
}
