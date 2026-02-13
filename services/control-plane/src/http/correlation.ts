import type { FastifyRequest } from "fastify";

export function resolveCorrelationId(request: FastifyRequest): string {
  const raw = request.headers["x-correlation-id"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  return request.id;
}
