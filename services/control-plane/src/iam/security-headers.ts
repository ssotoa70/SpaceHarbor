// ---------------------------------------------------------------------------
// Phase 1.3: Security Response Headers (Fastify plugin)
// Phase 3.3: Data Classification Headers
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Data classification resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the data classification level for a request path.
 * - confidential: user/auth/SCIM endpoints (PII)
 * - restricted: audit endpoints (compliance-sensitive)
 * - internal: everything else
 */
export function resolveDataClassification(path: string): "confidential" | "restricted" | "internal" {
  const normalized = path.split("?")[0];
  if (
    normalized.includes("/users") ||
    normalized.includes("/auth/") ||
    normalized.includes("/scim/")
  ) {
    return "confidential";
  }
  if (normalized.includes("/audit/")) {
    return "restricted";
  }
  return "internal";
}

/**
 * Register security response headers on all responses:
 * - Strict-Transport-Security (HSTS): enforce HTTPS for 1 year
 * - X-Content-Type-Options: prevent MIME-type sniffing
 * - X-Frame-Options: prevent clickjacking
 * - X-Data-Classification: data sensitivity label (Phase 3.3)
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Data-Classification", resolveDataClassification(request.url));
  });
}
