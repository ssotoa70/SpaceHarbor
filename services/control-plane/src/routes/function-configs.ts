/**
 * GET /api/v1/function-configs/:scope — list configs in a scope.
 * PUT /api/v1/function-configs/:scope/:key — write a single config value.
 *
 * Admin-gated via `admin:system_config`. Writes emit an audit row via
 * the injected writeAudit callback (wired to recordRequestAudit in app.ts).
 *
 * Spec: docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md
 * Plan: docs/superpowers/plans/2026-04-19-phase-6.0-asset-integrity.md (C3)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendError } from "../http/errors.js";
import {
  type FunctionConfigsStore,
  type FunctionConfig,
  NotFoundError,
  ValidationError,
} from "../config/function-configs-store.js";

export interface FunctionConfigsDeps {
  writeAudit: (row: {
    message: string;
    scope: string;
    key: string;
    actor: string;
    previous: unknown;
    next: unknown;
  }) => void | Promise<void>;
  /**
   * When true, both routes short-circuit with 503 NOT_IMPLEMENTED. Set by
   * the wiring layer when the store is backed by an in-memory stub
   * (no real DB queryScope/upsertValue), so admins get an unambiguous
   * "not yet wired" signal instead of a misleading 404 CONFIG_KEY_NOT_FOUND
   * (which would otherwise fire because the stub returns an empty scope
   * and setValue's NotFoundError surfaces).
   */
  notImplemented?: boolean;
}

const ADMIN_PERM = "admin:system_config";

function denyUnlessAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const ctx = (request as any).iamContext as { permissions?: Set<string> } | undefined;
  if (!ctx?.permissions?.has(ADMIN_PERM)) {
    sendError(request, reply, 403, "FORBIDDEN", `${ADMIN_PERM} permission required`);
    return true;
  }
  return false;
}

function getActor(request: FastifyRequest): string {
  const ctx = (request as any).iamContext as { subject?: { id?: string } } | undefined;
  return ctx?.subject?.id ?? "unknown";
}

export function registerFunctionConfigsRoutes(
  app: FastifyInstance,
  store: FunctionConfigsStore,
  prefixes: string[],
  deps: FunctionConfigsDeps,
): void {
  const v1Prefix = prefixes.find((p) => p === "/api/v1") ?? "/api/v1";

  app.get(
    `${v1Prefix}/function-configs/:scope`,
    {
      schema: {
        tags: ["admin"],
        operationId: "listFunctionConfigs",
        summary: "List typed runtime configs for a scope",
        params: {
          type: "object",
          required: ["scope"],
          properties: { scope: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (denyUnlessAdmin(request, reply)) return;
      if (deps.notImplemented) {
        return sendError(request, reply, 503, "NOT_IMPLEMENTED",
          "function_configs store is not yet wired to the database");
      }
      const { scope } = request.params as { scope: string };
      try {
        const configs = await store.getScope(scope);
        return reply.send({ configs: configs.map(serializeConfig) });
      } catch (err) {
        request.log.error({ err, scope }, "function_configs read failed");
        return sendError(request, reply, 503, "DB_UNREACHABLE", "config store unreachable");
      }
    },
  );

  app.put(
    `${v1Prefix}/function-configs/:scope/:key`,
    {
      schema: {
        tags: ["admin"],
        operationId: "setFunctionConfig",
        summary: "Write a typed runtime config value",
        params: {
          type: "object",
          required: ["scope", "key"],
          properties: {
            scope: { type: "string" },
            key: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["value"],
          properties: { value: {} },
        },
      },
    },
    async (request, reply) => {
      if (denyUnlessAdmin(request, reply)) return;
      if (deps.notImplemented) {
        return sendError(request, reply, 503, "NOT_IMPLEMENTED",
          "function_configs store is not yet wired to the database");
      }
      const { scope, key } = request.params as { scope: string; key: string };
      const { value } = request.body as { value: unknown };
      const actor = getActor(request);

      let previous: unknown;
      try {
        previous = await store.getValue(scope, key);
      } catch {
        previous = null;
      }

      try {
        const updated = await store.setValue(scope, key, value, actor);
        try {
          await Promise.resolve(
            deps.writeAudit({
              message: "function_config.updated",
              scope,
              key,
              actor,
              previous,
              next: updated.value,
            }),
          );
        } catch (auditErr) {
          request.log.warn({ err: auditErr }, "audit write failed (non-fatal)");
        }
        return reply.send({ config: serializeConfig(updated) });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendError(request, reply, 404, err.code, err.message);
        }
        if (err instanceof ValidationError) {
          return sendError(request, reply, 400, err.code, err.message);
        }
        request.log.error({ err, scope, key }, "function_config write failed");
        return sendError(request, reply, 503, "DB_UNREACHABLE", "config store unreachable");
      }
    },
  );
}

function serializeConfig(c: FunctionConfig): Record<string, unknown> {
  return {
    scope: c.scope,
    key: c.key,
    valueType: c.valueType,
    value: c.value,
    default: c.default,
    min: c.min ?? null,
    max: c.max ?? null,
    description: c.description,
    label: c.label,
    category: c.category,
    lastEditedBy: c.lastEditedBy,
    lastEditedAt: c.lastEditedAt,
  };
}
