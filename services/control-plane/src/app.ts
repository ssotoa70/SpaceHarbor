import Fastify, { type FastifyInstance } from "fastify";

import { createPersistenceAdapter } from "./persistence/factory.js";
import { registerAssetsRoute } from "./routes/assets.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerIngestRoute } from "./routes/ingest.js";
import { registerJobsRoute } from "./routes/jobs.js";

export function buildApp(): FastifyInstance {
  const persistence = createPersistenceAdapter();
  persistence.reset();
  const prefixes = ["", "/api/v1"];

  const app = Fastify({ logger: false });

  void registerHealthRoute(app);
  void registerAssetsRoute(app, persistence, prefixes);
  void registerAuditRoute(app, persistence, prefixes);
  void registerIngestRoute(app, persistence, prefixes);
  void registerEventsRoute(app, persistence, prefixes);
  void registerJobsRoute(app, persistence, prefixes);

  return app;
}
