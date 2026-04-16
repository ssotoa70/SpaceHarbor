/**
 * OpenTelemetry auto-instrumentation bootstrap.
 *
 * Gated by OTEL_EXPORTER_OTLP_ENDPOINT — if unset, tracing is a no-op so
 * dev machines and air-gapped deploys incur no overhead. When set, spans
 * are exported to the given OTLP HTTP endpoint (Tempo, Jaeger, Honeycomb,
 * Grafana Cloud, etc.) via the standard OTLP/HTTP protocol.
 *
 * Instruments Fastify (HTTP server spans), the global fetch client
 * (outbound webhook + DataEngine calls), and pg/http via
 * auto-instrumentations-node.
 *
 * Must be `import`ed BEFORE any other instrumented module so the
 * monkey-patching catches the initial require of those libraries.
 * server.ts does this by importing this file first.
 *
 * Standard env vars (read directly by the SDK):
 *   OTEL_EXPORTER_OTLP_ENDPOINT          https://otel.example.com/v1/traces
 *   OTEL_EXPORTER_OTLP_HEADERS           "authorization=Basic ...,x-api-key=..."
 *   OTEL_SERVICE_NAME                    defaults to "spaceharbor-control-plane"
 *   OTEL_RESOURCE_ATTRIBUTES             "deployment.environment=prod,..."
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let started = false;
let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (started) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    // OTel not configured — keep tracing entirely out of the hot path.
    return;
  }

  // Verbose SDK logs only when explicitly requested, to avoid noise at boot.
  if (process.env.OTEL_LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "spaceharbor-control-plane";
  const serviceVersion = process.env.npm_package_version ?? "0.1.0";

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({
      // If the env contains a trailing /v1/traces the exporter uses it as-is.
      // If it's a bare host (otel.example.com:4318), the SDK appends the path.
      url: endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/$/, "")}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy/verbose defaults that don't help for SpaceHarbor.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // DNS spans flood traces with tiny durations; skip unless debugging.
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    started = true;
    // eslint-disable-next-line no-console
    console.log(`[tracing] OpenTelemetry started — exporter=${endpoint} service=${serviceName}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[tracing] failed to start OpenTelemetry SDK", err);
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try { await sdk.shutdown(); } catch { /* swallow — we're exiting */ }
}
