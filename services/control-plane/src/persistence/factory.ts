import { LocalPersistenceAdapter } from "./adapters/local-persistence.js";
import { VastPersistenceAdapter } from "./adapters/vast-persistence.js";
import type { PersistenceAdapter, PersistenceBackend } from "./types.js";

const SUPPORTED_BACKENDS: PersistenceBackend[] = ["local", "vast"];

export function resolvePersistenceBackend(rawBackend: string | undefined): PersistenceBackend {
  const normalized = rawBackend?.trim().toLowerCase();
  if (!normalized) {
    return "local";
  }

  if (!SUPPORTED_BACKENDS.includes(normalized as PersistenceBackend)) {
    throw new Error(`unsupported persistence backend: ${rawBackend}`);
  }

  return normalized as PersistenceBackend;
}

export function createPersistenceAdapter(rawBackend = process.env.ASSETHARBOR_PERSISTENCE_BACKEND): PersistenceAdapter {
  const backend = resolvePersistenceBackend(rawBackend);

  if (backend === "vast") {
    return new VastPersistenceAdapter({
      databaseUrl: process.env.VAST_DATABASE_URL,
      eventBrokerUrl: process.env.VAST_EVENT_BROKER_URL,
      dataEngineUrl: process.env.VAST_DATAENGINE_URL
    });
  }

  return new LocalPersistenceAdapter();
}
