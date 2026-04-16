/**
 * Webhooks — outbound endpoint registry + inbound webhook handler.
 *
 *   GET    /webhook-endpoints                list (optional ?direction)
 *   GET    /webhook-endpoints/:id
 *   POST   /webhook-endpoints                create (returns plaintext secret ONCE)
 *   DELETE /webhook-endpoints/:id            revoke
 *   GET    /webhook-deliveries?webhookId=... list delivery attempts
 *   POST   /webhooks/:id                     INBOUND handler — HMAC-verified
 *
 * Inbound webhooks emit a synthetic event (`webhook.inbound.<name>`) onto
 * the internal event bus so triggers can subscribe to external systems
 * (Frame.io, GitHub, Airtable, etc.) using the same event-selector model
 * as internal events.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter, WebhookDirection } from "../persistence/types.js";
import { cacheWebhookSecret, verifyInboundSignature, invalidateWebhookSecret } from "../automation/outbound-webhook.js";
import { eventBus } from "../events/bus.js";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateSecret(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    hash: hashSecret(plaintext),
    prefix: plaintext.slice(0, 8),
  };
}

const endpointSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    direction: { type: "string" },
    url: { type: ["string", "null"] },
    secretPrefix: { type: "string" },
    signingAlgorithm: { type: "string" },
    allowedEventTypes: { type: ["array", "null"], items: { type: "string" } },
    description: { type: ["string", "null"] },
    createdBy: { type: "string" },
    createdAt: { type: "string" },
    lastUsedAt: { type: ["string", "null"] },
    revokedAt: { type: ["string", "null"] },
  },
} as const;

function redactSecret<T extends { secretHash: string }>(rec: T): Omit<T, "secretHash"> {
  const { secretHash: _h, ...rest } = rec;
  void _h;
  return rest;
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    // ── List endpoints ──
    app.get<{ Querystring: { direction?: WebhookDirection; include_revoked?: string } }>(
      withPrefix(prefix, "/webhook-endpoints"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}ListWebhookEndpoints`,
          summary: "List webhook endpoints",
          querystring: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["inbound", "outbound"] },
              include_revoked: { type: "string" },
            },
          },
          response: {
            200: { type: "object", properties: { endpoints: { type: "array", items: endpointSchema } } },
          },
        },
      },
      async (request) => {
        const rows = await persistence.listWebhookEndpoints({
          direction: request.query.direction,
          includeRevoked: request.query.include_revoked === "true",
        });
        return { endpoints: rows.map(redactSecret) };
      },
    );

    // ── Get endpoint ──
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/webhook-endpoints/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}GetWebhookEndpoint`,
          summary: "Get a webhook endpoint",
          response: { 200: { type: "object", properties: { endpoint: endpointSchema } }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const ep = await persistence.getWebhookEndpoint(request.params.id);
        if (!ep) return sendError(request, reply, 404, "NOT_FOUND", `Endpoint not found: ${request.params.id}`);
        return { endpoint: redactSecret(ep) };
      },
    );

    // ── Create endpoint (plaintext secret returned ONCE) ──
    app.post<{ Body: {
      name: string;
      direction: WebhookDirection;
      url?: string;
      allowedEventTypes?: string[];
      description?: string;
    } }>(
      withPrefix(prefix, "/webhook-endpoints"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}CreateWebhookEndpoint`,
          summary: "Create a webhook endpoint — plaintext secret returned ONCE",
          body: {
            type: "object",
            required: ["name", "direction"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 128 },
              direction: { type: "string", enum: ["inbound", "outbound"] },
              url: { type: "string", maxLength: 2048 },
              allowedEventTypes: { type: "array", items: { type: "string" } },
              description: { type: "string", maxLength: 1000 },
            },
          },
          response: {
            201: {
              type: "object",
              properties: {
                endpoint: endpointSchema,
                secret: {
                  type: "object",
                  properties: {
                    plaintext: { type: "string" },
                    prefix: { type: "string" },
                    warning: { type: "string" },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        if (body.direction === "outbound" && !body.url) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "url is required for outbound webhooks");
        }
        const secret = generateSecret();
        const ep = await persistence.createWebhookEndpoint(
          {
            name: body.name,
            direction: body.direction,
            url: body.url,
            secretHash: secret.hash,
            secretPrefix: secret.prefix,
            signingAlgorithm: "hmac-sha256",
            allowedEventTypes: body.allowedEventTypes,
            description: body.description,
            createdBy: request.identity ?? "unknown",
          },
          { correlationId: request.id, now: new Date().toISOString() },
        );
        // Cache the plaintext in-process so outbound deliveries + inbound
        // verification can sign/check HMAC immediately.
        cacheWebhookSecret(ep.id, secret.plaintext);

        return reply.status(201).send({
          endpoint: redactSecret(ep),
          secret: {
            plaintext: secret.plaintext,
            prefix: secret.prefix,
            warning: "Save this secret NOW — it will not be shown again. For inbound webhooks, the caller must sign payloads with HMAC-SHA256 using this secret.",
          },
        });
      },
    );

    // ── Revoke endpoint ──
    app.delete<{ Params: { id: string } }>(
      withPrefix(prefix, "/webhook-endpoints/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}RevokeWebhookEndpoint`,
          summary: "Revoke a webhook endpoint (soft-delete)",
          response: { 204: { type: "null" }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const ok = await persistence.revokeWebhookEndpoint(request.params.id, {
          correlationId: request.id,
          now: new Date().toISOString(),
        });
        if (!ok) return sendError(request, reply, 404, "NOT_FOUND", `Endpoint not found or already revoked`);
        invalidateWebhookSecret(request.params.id);
        return reply.status(204).send();
      },
    );

    // ── Delivery log ──
    app.get<{ Querystring: { webhookId?: string; status?: string; limit?: string } }>(
      withPrefix(prefix, "/webhook-deliveries"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}ListWebhookDeliveries`,
          summary: "List outbound webhook delivery attempts",
          querystring: {
            type: "object",
            properties: {
              webhookId: { type: "string" },
              status: { type: "string" },
              limit: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                deliveries: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const limit = request.query.limit ? Math.min(500, parseInt(request.query.limit, 10) || 100) : 100;
        const rows = await persistence.listWebhookDeliveries({
          webhookId: request.query.webhookId,
          status: request.query.status,
          limit,
        });
        return { deliveries: rows };
      },
    );

    // ── INBOUND webhook handler ──
    // This route is UNAUTHENTICATED (security=[]) — HMAC signature IS the auth.
    app.post<{ Params: { id: string } }>(
      withPrefix(prefix, "/webhooks/:id"),
      {
        // Keep the raw body so HMAC verification signs the exact bytes sent.
        // Fastify by default auto-parses JSON; we read the raw body via a
        // dedicated content-type-parser.
        schema: {
          tags: ["automation"],
          operationId: `${op}InboundWebhook`,
          summary: "Inbound webhook endpoint (HMAC-SHA256 verified)",
          security: [],
          response: {
            200: { type: "object", properties: { accepted: { type: "boolean" }, eventType: { type: "string" } } },
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const endpoint = await persistence.getWebhookEndpoint(request.params.id);
        if (!endpoint || endpoint.direction !== "inbound" || endpoint.revokedAt) {
          return sendError(request, reply, 404, "NOT_FOUND", `Inbound webhook not found or revoked`);
        }
        const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
        const sig = request.headers["x-spaceharbor-signature"] as string | undefined;
        if (!verifyInboundSignature(endpoint.id, rawBody, sig)) {
          return sendError(request, reply, 401, "INVALID_SIGNATURE", "HMAC-SHA256 signature mismatch");
        }

        await persistence.recordWebhookUsed(endpoint.id, {
          correlationId: request.id,
          now: new Date().toISOString(),
        });

        // Parse the body (best-effort — if it's not JSON, still emit the event)
        let data: unknown;
        try { data = JSON.parse(rawBody); } catch { data = { raw: rawBody }; }

        const eventType = `webhook.inbound.${endpoint.name}`;
        eventBus.publish({
          type: eventType,
          subject: `webhook:${endpoint.id}`,
          data,
          actor: null,
          correlationId: request.id,
        });

        return reply.send({ accepted: true, eventType });
      },
    );
  }
}
