/**
 * Prometheus metrics registry.
 *
 * Exposed at GET /metrics (unauthenticated — per the OpenMetrics convention
 * and because most scrapers don't support bearer auth cleanly). The endpoint
 * returns text/plain in the standard prom exposition format.
 *
 * Three categories:
 *   1. Default Node metrics (event loop lag, GC, heap, fd count)
 *   2. HTTP RED metrics — one histogram per route+method+status
 *   3. Business counters — domain-specific metrics (checkins, dispatches,
 *      triggers, webhook deliveries, workflow states, circuit breaker state)
 *
 * The registry is a singleton so all modules share the same counters.
 * Module-level constants are exported so domain code can inc()/observe()
 * without reaching through a registry indirection.
 */

import client from "prom-client";

// ---------------------------------------------------------------------------
// Registry + defaults
// ---------------------------------------------------------------------------

export const registry = new client.Registry();

// Default Node metrics: process_cpu_*, process_resident_memory_bytes,
// nodejs_eventloop_lag_seconds, nodejs_heap_size_total_bytes, etc.
client.collectDefaultMetrics({
  register: registry,
  prefix: "spaceharbor_",
});

// ---------------------------------------------------------------------------
// HTTP RED metrics
// ---------------------------------------------------------------------------

// Histogram buckets chosen for web-ui + API use cases:
//   fast: 1 ms, 5 ms, 10 ms (cached reads, tiny handlers)
//   normal: 50 ms, 100 ms, 250 ms, 500 ms
//   slow: 1 s, 2.5 s, 5 s, 10 s (presigned-url gen, S3 roundtrips, cold queries)
const HTTP_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestDuration = new client.Histogram({
  name: "spaceharbor_http_request_duration_seconds",
  help: "HTTP request duration by route + method + status",
  labelNames: ["method", "route", "status"] as const,
  buckets: HTTP_BUCKETS,
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "spaceharbor_http_requests_total",
  help: "Total HTTP requests by route + method + status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business counters — atomic check-in
// ---------------------------------------------------------------------------

export const checkinReserveTotal = new client.Counter({
  name: "spaceharbor_checkin_reserve_total",
  help: "Atomic check-ins reserved (reached state=reserved)",
  registers: [registry],
});

export const checkinCommitTotal = new client.Counter({
  name: "spaceharbor_checkin_commit_total",
  help: "Atomic check-ins committed successfully",
  registers: [registry],
});

export const checkinAbortTotal = new client.Counter({
  name: "spaceharbor_checkin_abort_total",
  help: "Atomic check-ins aborted (client or failure path)",
  labelNames: ["reason"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business counters — DataEngine dispatch
// ---------------------------------------------------------------------------

export const dispatchCreatedTotal = new client.Counter({
  name: "spaceharbor_dispatch_created_total",
  help: "DataEngine dispatch rows created",
  labelNames: ["file_kind", "expected_function"] as const,
  registers: [registry],
});

export const dispatchCompletedTotal = new client.Counter({
  name: "spaceharbor_dispatch_completed_total",
  help: "DataEngine dispatches that reached completed state",
  labelNames: ["file_kind"] as const,
  registers: [registry],
});

export const dispatchAbandonedTotal = new client.Counter({
  name: "spaceharbor_dispatch_abandoned_total",
  help: "DataEngine dispatches that exceeded their deadline without completion",
  labelNames: ["file_kind"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business counters — triggers + webhooks + workflows
// ---------------------------------------------------------------------------

export const triggerFiredTotal = new client.Counter({
  name: "spaceharbor_trigger_fired_total",
  help: "Triggers that matched and dispatched an action",
  labelNames: ["action_kind"] as const,
  registers: [registry],
});

export const webhookDeliveryTotal = new client.Counter({
  name: "spaceharbor_webhook_delivery_total",
  help: "Outbound webhook delivery attempts",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const workflowInstanceTotal = new client.Counter({
  name: "spaceharbor_workflow_instance_total",
  help: "Workflow instances started, by definition name",
  labelNames: ["definition_name"] as const,
  registers: [registry],
});

export const workflowTransitionTotal = new client.Counter({
  name: "spaceharbor_workflow_transition_total",
  help: "Workflow node transitions by target state",
  labelNames: ["to_state"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business gauges — queue + circuit breaker state
// ---------------------------------------------------------------------------

export const jobQueueDepth = new client.Gauge({
  name: "spaceharbor_job_queue_depth",
  help: "Current workflow job queue depth by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const dispatchPendingGauge = new client.Gauge({
  name: "spaceharbor_dispatch_pending",
  help: "Number of DataEngine dispatches currently in pending state",
  registers: [registry],
});

export const circuitBreakerState = new client.Gauge({
  name: "spaceharbor_circuit_breaker_state",
  help: "Circuit breaker state: 0=closed, 1=half-open, 2=open",
  labelNames: ["breaker"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a Fastify URL to a low-cardinality route label.
 * Replaces path params with placeholders so `GET /assets/abc123`
 * and `GET /assets/def456` share the same label.
 *
 * Fastify exposes `request.routeOptions.url` when the route matched;
 * this function is a fallback for unmatched routes (404s).
 */
export function normalizeRouteLabel(url: string): string {
  const path = url.split("?")[0];
  return path
    // UUIDv4 pattern
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    // Generic numeric IDs
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    // Long hex ids
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:id");
}
