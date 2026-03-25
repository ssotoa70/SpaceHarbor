import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import { isValidApiKey, resolveValidApiKeys } from "../iam/auth-plugin.js";

interface SseClient {
  id: string;
  reply: { raw: { write: (data: string) => boolean; end: () => void; on: (event: string, cb: () => void) => void } };
}

const clients = new Set<SseClient>();

const MAX_SSE_CONNECTIONS = 100;

export function broadcastEvent(eventType: string, data: unknown): void {
  const payload = `data: ${JSON.stringify({ type: eventType, ...data as object })}\n\n`;
  for (const client of clients) {
    try {
      client.reply.raw.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function registerEventsStreamRoute(
  app: FastifyInstance,
  _persistence: PersistenceAdapter,
  prefixes: string[] = [""]
): void {
  for (const prefix of prefixes) {
    app.get(`${prefix}/events/stream`, {
      schema: {
        tags: ["events"],
        operationId: prefix ? "v1GetEventsStream" : "legacyGetEventsStream",
        summary: "Server-Sent Events stream for real-time workflow notifications",
        description:
          "Opens a persistent SSE connection. Events include job status changes, " +
          "nav badge updates, and workflow notifications. Requires API key when " +
          "SPACEHARBOR_API_KEY is configured. Max 100 concurrent connections.",
        security: [],
        response: {
          200: { type: "string", description: "SSE text/event-stream" },
          401: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          503: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    }, async (request, reply) => {
      // --- API key authentication (supports per-service credentials) ---
      const hasKeys = resolveValidApiKeys().length > 0;
      if (hasKeys) {
        const providedKey = request.headers["x-api-key"];
        if (!providedKey || typeof providedKey !== "string") {
          return reply.status(401).send({ error: "API key required" });
        }
        if (!isValidApiKey(providedKey)) {
          return reply.status(401).send({ error: "invalid API key" });
        }
      }

      // --- Connection limit ---
      if (clients.size >= MAX_SSE_CONNECTIONS) {
        return reply.status(503).send({ error: "too many SSE connections" });
      }

      // --- Configurable CORS origin ---
      const corsOrigin = process.env.SPACEHARBOR_CORS_ORIGIN ?? "http://localhost:4173";

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": corsOrigin,
      });

      const client: SseClient = {
        id: request.id,
        reply: reply as unknown as SseClient["reply"],
      };

      clients.add(client);

      // Send initial connection event
      reply.raw.write(`data: ${JSON.stringify({ type: "connected", clientId: request.id })}\n\n`);

      // Keep-alive ping every 30s
      const keepAlive = setInterval(() => {
        try {
          reply.raw.write(`: ping\n\n`);
        } catch {
          clearInterval(keepAlive);
          clients.delete(client);
        }
      }, 30_000);

      request.raw.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(client);
      });

      // Don't call reply.send() — the connection stays open
      await reply;
    });
  }
}

export function getConnectedClientCount(): number {
  return clients.size;
}

// ---------------------------------------------------------------------------
// Badge SSE broadcast — debounced to 5 seconds (Phase 7.3)
// ---------------------------------------------------------------------------

let badgeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const BADGE_DEBOUNCE_MS = 5_000;

/**
 * Schedule a debounced broadcast of nav:badges data over SSE.
 * Multiple calls within 5 seconds are coalesced into a single broadcast.
 */
export function scheduleBadgeBroadcast(badgeCounts: {
  queue: number;
  assignments: number;
  approvals: number;
  feedback: number;
  dlq: number;
}): void {
  if (badgeDebounceTimer) {
    clearTimeout(badgeDebounceTimer);
  }
  badgeDebounceTimer = setTimeout(() => {
    badgeDebounceTimer = null;
    broadcastEvent("nav:badges", badgeCounts);
  }, BADGE_DEBOUNCE_MS);
}

/**
 * Cancel any pending badge broadcast (used in tests / cleanup).
 */
export function cancelPendingBadgeBroadcast(): void {
  if (badgeDebounceTimer) {
    clearTimeout(badgeDebounceTimer);
    badgeDebounceTimer = null;
  }
}
