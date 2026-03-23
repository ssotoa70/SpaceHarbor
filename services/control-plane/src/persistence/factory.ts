import { resolveOutboundConfig } from "../integrations/outbound/config.js";
import { WebhookOutboundNotifier } from "../integrations/outbound/webhook-notifier.js";
import { LocalPersistenceAdapter } from "./adapters/local-persistence.js";
import { VastPersistenceAdapter } from "./adapters/vast-persistence.js";
import type { PersistenceAdapter, PersistenceBackend } from "./types.js";
import { TrinoClient } from "../db/trino-client.js";
import { VastWorkflowClientImpl } from "./vast/vast-workflow-client.js";

const SUPPORTED_BACKENDS: PersistenceBackend[] = ["local", "vast"];

export function resolveVastFallbackToLocal(rawValue: string | undefined): boolean {
  // Default to false — production must opt in to silent fallback explicitly
  return rawValue?.trim().toLowerCase() === "true";
}

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

export function createPersistenceAdapter(rawBackend = process.env.SPACEHARBOR_PERSISTENCE_BACKEND): PersistenceAdapter {
  const backend = resolvePersistenceBackend(rawBackend);
  const outboundConfig = resolveOutboundConfig(process.env);
  const outboundNotifier =
    outboundConfig.targets.length > 0 ? new WebhookOutboundNotifier(outboundConfig.signingSecret) : null;

  if (backend === "vast") {
    const strict = process.env.SPACEHARBOR_VAST_STRICT?.toLowerCase() === "true";
    const fallbackToLocal = resolveVastFallbackToLocal(process.env.SPACEHARBOR_VAST_FALLBACK_TO_LOCAL);

    let workflowClient: VastWorkflowClientImpl | undefined;
    const dbUrl = process.env.VAST_DATABASE_URL;
    if (dbUrl) {
      const url = new URL(dbUrl);
      const trinoClient = new TrinoClient({
        endpoint: `${url.protocol}//${url.host}`,
        accessKey: url.username || process.env.VAST_ACCESS_KEY || "",
        secretKey: url.password || process.env.VAST_SECRET_KEY || ""
      });
      workflowClient = new VastWorkflowClientImpl(trinoClient);
    } else {
      console.warn(
        "WARNING: VAST persistence backend selected but workflow client not available " +
        "— falling back to in-memory storage for workflow operations"
      );
    }

    return new VastPersistenceAdapter({
      databaseUrl: process.env.VAST_DATABASE_URL,
      eventBrokerUrl: process.env.VAST_EVENT_BROKER_URL,
      dataEngineUrl: process.env.VAST_DATAENGINE_URL,
      strict,
      fallbackToLocal
    }, undefined, workflowClient, outboundConfig, outboundNotifier ?? undefined);
  }

  return new LocalPersistenceAdapter(outboundConfig, outboundNotifier);
}
