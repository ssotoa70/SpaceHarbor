import Fastify, { type FastifyInstance } from "fastify";

import { resolveCorrelationId } from "./http/correlation.js";
import { createPersistenceAdapter } from "./persistence/factory.js";
import { registerAssetsRoute } from "./routes/assets.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerDlqRoute } from "./routes/dlq.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerIngestRoute } from "./routes/ingest.js";
import { registerJobsRoute } from "./routes/jobs.js";
import { registerOutboxRoute } from "./routes/outbox.js";
import { registerQueueRoute } from "./routes/queue.js";

export function buildApp(): FastifyInstance {
  const persistence = createPersistenceAdapter();
  persistence.reset();
  const prefixes = ["", "/api/v1"];

  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-correlation-id", resolveCorrelationId(request));
  });

  void registerHealthRoute(app);
  void registerAssetsRoute(app, persistence, prefixes);
  void registerAuditRoute(app, persistence, prefixes);
  void registerIngestRoute(app, persistence, prefixes);
  void registerEventsRoute(app, persistence, prefixes);
  void registerJobsRoute(app, persistence, prefixes);
  void registerQueueRoute(app, persistence);
  void registerOutboxRoute(app, persistence);
  void registerDlqRoute(app, persistence);

  return app;
}
