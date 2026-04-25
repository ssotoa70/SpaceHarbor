import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { registerFunctionConfigsRoutes } from "../src/routes/function-configs.js";
import type { FunctionConfigsStore, FunctionConfig } from "../src/config/function-configs-store.js";
import { NotFoundError, ValidationError } from "../src/config/function-configs-store.js";

const ADMIN_PERM = "admin:system_config";

function mkStore(rows: FunctionConfig[] = []): FunctionConfigsStore & { writes: any[] } {
  const writes: any[] = [];
  return {
    writes,
    async getScope(scope: string) {
      return rows.filter((r) => r.scope === scope);
    },
    async getValue<T>(scope: string, key: string) {
      const r = rows.find((x) => x.scope === scope && x.key === key);
      if (!r) throw new NotFoundError(scope, key);
      return r.value as T;
    },
    async setValue(scope: string, key: string, value: unknown, actor: string) {
      const r = rows.find((x) => x.scope === scope && x.key === key);
      if (!r) throw new NotFoundError(scope, key);
      if (typeof value === "number" && r.max !== undefined && value > r.max) {
        throw new ValidationError(`value must be <= ${r.max}`);
      }
      writes.push({ scope, key, value, actor });
      r.value = value;
      r.lastEditedBy = actor;
      r.lastEditedAt = new Date().toISOString();
      return r;
    },
    async resetToDefault(scope: string, key: string, actor: string) {
      const r = rows.find((x) => x.scope === scope && x.key === key);
      if (!r) throw new NotFoundError(scope, key);
      r.value = r.default;
      r.lastEditedBy = actor;
      r.lastEditedAt = new Date().toISOString();
      return r;
    },
    invalidateScope() {
      // no-op for tests
    },
  } as any;
}

function mkApp(opts: {
  store: FunctionConfigsStore;
  permissions?: Set<string>;
  actor?: string;
  audit?: (row: any) => void;
  notImplemented?: boolean;
}): FastifyInstance {
  const app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.iamContext = {
      permissions: opts.permissions ?? new Set<string>(),
      subject: { id: opts.actor ?? "admin@x" },
    };
  });
  registerFunctionConfigsRoutes(app, opts.store, ["/api/v1"], {
    writeAudit: opts.audit ?? (() => {}),
    notImplemented: opts.notImplemented,
  });
  return app;
}

test("GET no permission: 403", async () => {
  const app = mkApp({ store: mkStore(), permissions: new Set<string>() });
  const res = await app.inject({ method: "GET", url: "/api/v1/function-configs/asset-integrity" });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("GET with permission: returns rows", async () => {
  const rows: FunctionConfig[] = [
    {
      scope: "asset-integrity",
      key: "k",
      valueType: "int",
      value: 5,
      default: 4,
      min: 1,
      max: 10,
      description: "d",
      label: "L",
      category: "Hashing",
      lastEditedBy: null,
      lastEditedAt: null,
    },
  ];
  const app = mkApp({ store: mkStore(rows), permissions: new Set([ADMIN_PERM]) });
  const res = await app.inject({ method: "GET", url: "/api/v1/function-configs/asset-integrity" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.configs.length, 1);
  assert.equal(body.configs[0].key, "k");
  assert.equal(body.configs[0].value, 5);
  await app.close();
});

test("PUT valid: 200, row returned, audit fired", async () => {
  const rows: FunctionConfig[] = [
    {
      scope: "asset-integrity",
      key: "k",
      valueType: "int",
      value: 5,
      default: 4,
      min: 1,
      max: 10,
      description: "d",
      label: "L",
      category: "Hashing",
      lastEditedBy: null,
      lastEditedAt: null,
    },
  ];
  const auditCalls: any[] = [];
  const app = mkApp({
    store: mkStore(rows),
    permissions: new Set([ADMIN_PERM]),
    audit: (row) => auditCalls.push(row),
  });
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/k",
    payload: { value: 7 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.config.value, 7);
  assert.equal(auditCalls.length, 1);
  await app.close();
});

test("PUT out-of-range: 400 VALIDATION_ERROR", async () => {
  const rows: FunctionConfig[] = [
    {
      scope: "asset-integrity",
      key: "k",
      valueType: "int",
      value: 5,
      default: 4,
      min: 1,
      max: 10,
      description: "d",
      label: "L",
      category: "Hashing",
      lastEditedBy: null,
      lastEditedAt: null,
    },
  ];
  const app = mkApp({ store: mkStore(rows), permissions: new Set([ADMIN_PERM]) });
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/k",
    payload: { value: 99 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.match(body.message, /10/);
  await app.close();
});

test("PUT unknown key: 404 CONFIG_KEY_NOT_FOUND", async () => {
  const app = mkApp({ store: mkStore([]), permissions: new Set([ADMIN_PERM]) });
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/zz",
    payload: { value: 1 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 404);
  assert.equal((res.json() as any).code, "CONFIG_KEY_NOT_FOUND");
  await app.close();
});

test("PUT no permission: 403", async () => {
  const app = mkApp({ store: mkStore([]), permissions: new Set<string>() });
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/k",
    payload: { value: 1 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("PUT writes audit row", async () => {
  const rows: FunctionConfig[] = [
    {
      scope: "asset-integrity",
      key: "k",
      valueType: "int",
      value: 5,
      default: 4,
      min: 1,
      max: 10,
      description: "d",
      label: "L",
      category: "Hashing",
      lastEditedBy: null,
      lastEditedAt: null,
    },
  ];
  const auditCalls: any[] = [];
  const app = mkApp({
    store: mkStore(rows),
    permissions: new Set([ADMIN_PERM]),
    audit: (row) => auditCalls.push(row),
  });
  await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/k",
    payload: { value: 7 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].message, "function_config.updated");
  assert.equal(auditCalls[0].scope, "asset-integrity");
  assert.equal(auditCalls[0].key, "k");
  await app.close();
});

test("notImplemented=true: GET returns 503 NOT_IMPLEMENTED for admin", async () => {
  const app = mkApp({
    store: mkStore(),
    permissions: new Set([ADMIN_PERM]),
    notImplemented: true,
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/function-configs/asset-integrity" });
  assert.equal(res.statusCode, 503);
  assert.equal((res.json() as { code: string }).code, "NOT_IMPLEMENTED");
  await app.close();
});

test("notImplemented=true: PUT returns 503 NOT_IMPLEMENTED for admin (not a misleading 404)", async () => {
  const app = mkApp({
    store: mkStore(),
    permissions: new Set([ADMIN_PERM]),
    notImplemented: true,
  });
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/function-configs/asset-integrity/k",
    payload: { value: 7 },
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 503);
  assert.equal((res.json() as { code: string }).code, "NOT_IMPLEMENTED");
  await app.close();
});

test("notImplemented=true: non-admin still gets 403 first", async () => {
  const app = mkApp({
    store: mkStore(),
    permissions: new Set<string>(),
    notImplemented: true,
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/function-configs/asset-integrity" });
  assert.equal(res.statusCode, 403);
  await app.close();
});
