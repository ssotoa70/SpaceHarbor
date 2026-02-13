import Fastify, { type FastifyInstance } from "fastify";

import { resolveCorrelationId } from "./http/correlation.js";
import { registerOpenApi } from "./http/openapi.js";
import { createPersistenceAdapter } from "./persistence/factory.js";
import type { PersistenceAdapter } from "./persistence/types.js";
import { registerAssetsRoute } from "./routes/assets.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerDlqRoute } from "./routes/dlq.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerIngestRoute } from "./routes/ingest.js";
import { registerJobsRoute } from "./routes/jobs.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerOutboxRoute } from "./routes/outbox.js";
import { registerQueueRoute } from "./routes/queue.js";

interface BuildAppOptions {
  persistenceAdapter?: PersistenceAdapter;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const persistence = options.persistenceAdapter ?? createPersistenceAdapter();
  persistence.reset();
  const prefixes = ["", "/api/v1"];

  const app = Fastify({ logger: false });

  registerOpenApi(app);

  app.addHook("onRequest", async (request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header("x-correlation-id", correlationId);

    const configuredApiKey = process.env.ASSETHARBOR_API_KEY?.trim();
    const isWriteMethod = request.method === "POST" || request.method === "PUT" || request.method === "PATCH" || request.method === "DELETE";

    if (!configuredApiKey || !isWriteMethod) {
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

    if (providedApiKey !== configuredApiKey) {
      reply.status(403).send({
        code: "FORBIDDEN",
        message: "invalid API key",
        requestId: request.id,
        details: null
      });
      return;
    }
  });

  app.setErrorHandler(async (_error, request, reply) => {
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "internal server error",
      requestId: request.id,
      details: null
    });
  });

  app.after(() => {
    void registerHealthRoute(app);
    void registerAssetsRoute(app, persistence, prefixes);
    void registerAuditRoute(app, persistence, prefixes);
    void registerIngestRoute(app, persistence, prefixes);
    void registerEventsRoute(app, persistence, prefixes);
    void registerJobsRoute(app, persistence, prefixes);
    void registerQueueRoute(app, persistence);
    void registerOutboxRoute(app, persistence);
    void registerDlqRoute(app, persistence);
    void registerMetricsRoute(app, persistence);
  });

  return app;
}
