import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      info: {
        title: "AssetHarbor API",
        description: "AssetHarbor control-plane contracts",
        version: "1.0.0"
      },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "x-api-key"
          }
        }
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    app.register(swaggerUi, {
      routePrefix: "/docs",
      staticCSP: true,
      uiConfig: {
        docExpansion: "list",
        deepLinking: true
      }
    });
  }

  app.get("/openapi.json", async () => app.swagger());
}
