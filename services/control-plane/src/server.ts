// Accept self-signed VAST cluster certificates.
// Must be set before any fetch/TLS calls. Controlled by SPACEHARBOR_VAST_SKIP_TLS.
if (process.env.SPACEHARBOR_VAST_SKIP_TLS !== "false" && process.env.SPACEHARBOR_VAST_SKIP_TLS !== "0") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

// Drain timeout: how long to wait for in-flight requests + Fastify onClose
// hooks (subscriber.stop(), timer.stop(), outbox flush) before the process
// exits regardless. Matches typical Kubernetes terminationGracePeriodSeconds.
const shutdownTimeoutMs = Number.parseInt(
  process.env.SPACEHARBOR_SHUTDOWN_TIMEOUT_MS ?? "30000",
  10,
);

const app = buildApp();

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    app.log.warn(`[server] ${signal} received during shutdown; forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;

  app.log.info(`[server] ${signal} received — draining in-flight requests`);

  const killTimer = setTimeout(() => {
    app.log.error(
      `[server] drain timeout (${shutdownTimeoutMs}ms) exceeded — forcing exit`,
    );
    process.exit(1);
  }, shutdownTimeoutMs);
  killTimer.unref();

  try {
    await app.close();
    clearTimeout(killTimer);
    app.log.info("[server] shutdown complete");
    process.exit(0);
  } catch (err) {
    clearTimeout(killTimer);
    app.log.error({ err }, "[server] error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

app.listen({ port, host }).catch((error) => {
  console.error("[server] fatal startup error:", error);
  process.exit(1);
});
