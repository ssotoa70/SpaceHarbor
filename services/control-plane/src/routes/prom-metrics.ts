/**
 * Prometheus /metrics endpoint.
 *
 * Unauthenticated — that's the OpenMetrics convention and most scrapers
 * don't cleanly support bearer tokens. If you need auth in production,
 * run the scraper inside the cluster network or put it behind an nginx
 * basic-auth in front of the control-plane (the existing TLS gate
 * already blocks internet egress unless `X-Forwarded-Proto: https`).
 *
 * Separate from the existing JSON `/api/v1/metrics` route (which returns
 * business-level snapshots for the web-UI analytics dashboard).
 */

import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  registry,
  jobQueueDepth,
  dispatchPendingGauge,
  circuitBreakerState,
} from "../infra/metrics.js";
import { listBreakers } from "../infra/circuit-breaker.js";

/** Update gauge values right before scraping so they're fresh. */
async function refreshGauges(persistence: PersistenceAdapter): Promise<void> {
  try {
    const stats = await persistence.getWorkflowStats();
    jobQueueDepth.set({ status: "pending" }, stats.jobs?.pending ?? 0);
    jobQueueDepth.set({ status: "processing" }, stats.jobs?.processing ?? 0);
    jobQueueDepth.set({ status: "completed" }, stats.jobs?.completed ?? 0);
    jobQueueDepth.set({ status: "failed" }, stats.jobs?.failed ?? 0);
  } catch {
    // Gauges stay at whatever value they were last scraped — not fatal.
  }

  try {
    const dispatches = await persistence.listDataEngineDispatches({ status: "pending", limit: 1000 });
    dispatchPendingGauge.set(dispatches.length);
  } catch {
    /* leave gauge stale */
  }

  // Circuit breaker state — 0=closed, 1=half-open, 2=open
  for (const b of listBreakers()) {
    circuitBreakerState.set(
      { breaker: b.name },
      b.state === "closed" ? 0 : b.state === "half-open" ? 1 : 2,
    );
  }
}

export async function registerPromMetricsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
): Promise<void> {
  app.get("/metrics", {
    schema: {
      tags: ["platform"],
      operationId: "getPromMetrics",
      summary: "Prometheus /metrics — OpenMetrics text format (unauthenticated)",
      security: [],
      response: {
        200: { type: "string" },
      },
    },
  }, async (_request, reply) => {
    await refreshGauges(persistence);
    const body = await registry.metrics();
    reply
      .type(registry.contentType)
      .send(body);
  });
}
