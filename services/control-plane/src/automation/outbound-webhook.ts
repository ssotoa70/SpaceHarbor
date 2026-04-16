/**
 * Outbound webhook delivery.
 *
 * Contract:
 *   - Caller supplies a webhook_endpoints row (direction='outbound', has URL
 *     + secret_hash). We don't know the plaintext secret here — only the
 *     hash — so we can't HMAC-sign. To make HMAC work we need the plaintext
 *     secret. The secret is returned ONCE at creation time; for outbound
 *     webhooks we therefore allow callers to pass the plaintext explicitly
 *     (typically read from env or a secret store keyed on secret_prefix).
 *
 * Signing:
 *   X-SpaceHarbor-Signature: sha256=<hex hmac of raw body>
 *   X-SpaceHarbor-Delivery: <delivery row id>
 *   X-SpaceHarbor-Event-Type: <event.type>
 *   X-SpaceHarbor-Event-Id:  <randomUUID per delivery>
 *
 * Retry policy:
 *   exponential backoff with jitter, 5 attempts total, capped at 60s.
 *   Each attempt writes its own delivery log row so the timeline is visible.
 *
 * On final failure we leave the delivery row in status='failed'.
 * Re-delivery is a separate admin action (not implemented here — Phase 3).
 */

import { createHmac, randomUUID } from "node:crypto";
import type { PersistenceAdapter, WebhookEndpointRecord, WebhookDeliveryStatus } from "../persistence/types.js";
import type { PlatformEvent } from "../events/bus.js";
import { webhookDeliveryTotal } from "../infra/metrics.js";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;

/**
 * Secrets are plaintext per (webhookId). In a production deployment these
 * come from a secret manager; in SpaceHarbor today they're stored in-memory
 * at creation time. We do NOT persist plaintext to the DB.
 */
const secretCache = new Map<string, string>();

export function cacheWebhookSecret(webhookId: string, secret: string): void {
  secretCache.set(webhookId, secret);
}

export function invalidateWebhookSecret(webhookId: string): void {
  secretCache.delete(webhookId);
}

export async function deliverWebhook(
  persistence: PersistenceAdapter,
  webhook: WebhookEndpointRecord,
  event: PlatformEvent,
  triggerId: string | null = null,
): Promise<void> {
  if (webhook.direction !== "outbound") return;
  if (webhook.revokedAt) return;
  if (!webhook.url) return;

  const eventTypeAllowed =
    !webhook.allowedEventTypes || webhook.allowedEventTypes.length === 0 ||
    webhook.allowedEventTypes.some((pat) =>
      pat === "*" || pat === event.type || (pat.endsWith(".*") && event.type.startsWith(pat.slice(0, -1))),
    );
  if (!eventTypeAllowed) return;

  const deliveryId = randomUUID();
  const payload = JSON.stringify(event);
  const signature = signPayload(webhook.id, payload);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = new Date().toISOString();
    let status: WebhookDeliveryStatus = "in_flight";
    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let lastError: string | undefined;

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": "SpaceHarbor/1.0 (+atomic-checkin)",
        "x-spaceharbor-delivery": deliveryId,
        "x-spaceharbor-event-type": event.type,
        "x-spaceharbor-event-id": randomUUID(),
        "x-spaceharbor-attempt": String(attempt),
      };
      if (signature) {
        headers["x-spaceharbor-signature"] = `sha256=${signature}`;
      }
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      responseStatus = res.status;
      const text = await res.text().catch(() => "");
      responseBody = text.slice(0, 2000);
      status = res.ok ? "succeeded" : "failed";
      if (!res.ok) lastError = `HTTP ${res.status}`;
    } catch (err) {
      status = "failed";
      lastError = err instanceof Error ? err.message : String(err);
    }

    await persistence.createWebhookDelivery({
      webhookId: webhook.id,
      triggerId: triggerId ?? null,
      eventType: event.type,
      eventPayload: payload.slice(0, 8000),
      requestUrl: webhook.url,
      requestHeaders: JSON.stringify({ signing: signature ? "hmac-sha256" : "none" }),
      responseStatus,
      responseBody,
      status,
      attemptNumber: attempt,
      lastError,
      startedAt,
      completedAt: new Date().toISOString(),
    });

    webhookDeliveryTotal.inc({ status });
    if (status === "succeeded") {
      await persistence.recordWebhookUsed(webhook.id, { correlationId: deliveryId, now: new Date().toISOString() });
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      const backoff = Math.min(60_000, BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
  // All attempts exhausted — the last log row is status=failed, no further retry.
}

function signPayload(webhookId: string, payload: string): string | null {
  const secret = secretCache.get(webhookId);
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify an incoming webhook signature (for inbound POST /webhooks/:id).
 * Expects the `x-spaceharbor-signature` header in the form `sha256=<hex>`.
 * Returns true if the HMAC matches.
 */
export function verifyInboundSignature(
  webhookId: string,
  rawBody: string,
  headerValue: string | undefined,
): boolean {
  if (!headerValue) return false;
  const secret = secretCache.get(webhookId);
  if (!secret) return false;
  const [algo, hex] = headerValue.split("=", 2);
  if (algo !== "sha256" || !hex) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Constant-time compare via Buffer equality
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
