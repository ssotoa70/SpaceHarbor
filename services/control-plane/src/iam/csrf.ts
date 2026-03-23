// ---------------------------------------------------------------------------
// Phase 3.2: CSRF Protection
// ---------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

// In-memory store: sessionId (refresh token hash) -> csrfToken
const csrfTokenStore = new Map<string, string>();

/**
 * Generate a random 32-byte hex CSRF token.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Store a CSRF token for a session.
 */
export function storeCsrfToken(sessionId: string, token: string): void {
  csrfTokenStore.set(sessionId, token);
}

/**
 * Validate a CSRF token for a session.
 */
export function validateCsrfToken(sessionId: string, token: string): boolean {
  const stored = csrfTokenStore.get(sessionId);
  if (!stored) return false;
  // Use constant-time comparison to prevent timing attacks
  if (token.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(stored));
}

/**
 * Remove a CSRF token (on logout/revocation).
 */
export function removeCsrfToken(sessionId: string): void {
  csrfTokenStore.delete(sessionId);
}

/**
 * Fastify onRequest hook that enforces CSRF protection for cookie-based auth.
 *
 * - Skips GET/HEAD/OPTIONS requests (safe methods)
 * - Skips requests using Bearer token auth (API clients)
 * - For cookie-based auth: requires X-CSRF-Token header matching stored token
 * - Returns 403 if missing or mismatched
 */
export async function csrfHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip safe methods
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  // Skip if request uses Bearer token auth (API clients don't need CSRF)
  const authHeader = request.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return;
  }

  // Skip if request uses API key or service token
  if (request.headers["x-api-key"] || request.headers["x-service-token"]) {
    return;
  }

  // For cookie-based or session-based auth, require CSRF token
  const iamContext = (request as any).iamContext;
  if (!iamContext || iamContext.authStrategy === "anonymous") {
    return;
  }

  // Get the session ID from the request context (stored during login)
  const sessionId = (request as any).sessionId;
  if (!sessionId) {
    // No session tracking — skip CSRF (Bearer token flow)
    return;
  }

  const csrfToken = request.headers["x-csrf-token"];
  if (!csrfToken || typeof csrfToken !== "string") {
    reply.status(403).send({
      code: "CSRF_REQUIRED",
      message: "CSRF token required for state-changing requests",
      requestId: request.id,
      details: null,
    });
    return;
  }

  if (!validateCsrfToken(sessionId, csrfToken)) {
    reply.status(403).send({
      code: "CSRF_INVALID",
      message: "invalid CSRF token",
      requestId: request.id,
      details: null,
    });
    return;
  }
}

/** Reset all CSRF state (for tests). */
export function resetCsrfState(): void {
  csrfTokenStore.clear();
}

export { csrfTokenStore };
