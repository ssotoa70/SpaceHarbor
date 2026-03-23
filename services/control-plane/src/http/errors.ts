import type { FastifyReply, FastifyRequest } from "fastify";

export interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  details: Record<string, unknown> | null;
}

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details: Record<string, unknown> | null = null
): FastifyReply {
  const payload: ErrorEnvelope = {
    code,
    message,
    requestId: request.id,
    details
  };

  return reply.status(statusCode).send(payload);
}
