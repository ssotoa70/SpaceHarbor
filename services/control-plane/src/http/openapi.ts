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
        { name: "collections", description: "Playlists, selections, and deliverables" },
        { name: "provenance", description: "Asset provenance, lineage, and dependency tracking" },
        { name: "events", description: "SSE event stream and workflow notifications" },
        { name: "pipeline", description: "Pipeline monitoring, transcoding, and conformance" },
        { name: "dlq", description: "Dead-letter queue — failed job management and replay" },
        { name: "audit", description: "Authorization decision audit log" },
        { name: "scim", description: "SCIM 2.0 user and group provisioning" },
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
