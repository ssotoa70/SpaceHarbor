import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerAuditRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(withPrefix(prefix, "/audit"), async () => ({
      events: persistence.getAuditEvents()
    }));
  }
}
