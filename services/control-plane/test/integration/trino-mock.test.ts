/**
 * Trino client mock-based integration tests.
 *
 * These tests intercept the fetch layer to simulate a real Trino cluster
 * response cycle: initial POST /v1/statement → nextUri polling chain → final
 * result. They run in CI without any running infrastructure.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { TrinoClient, TrinoQueryError } from "../../src/db/trino-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function withMockFetch(handler: FetchHandler, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const urlStr =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : (url as Request).url;
    return handler(urlStr, init);
  }) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function makeClient(overrides?: Partial<ConstructorParameters<typeof TrinoClient>[0]>): TrinoClient {
  return new TrinoClient({
    endpoint: "http://trino.test:8080",
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    pollIntervalMs: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Auth header tests
// ---------------------------------------------------------------------------

describe("TrinoClient mock integration — auth headers", () => {
  it("includes Basic auth header derived from access+secret key", () => {
    const client = makeClient({ accessKey: "AKID", secretKey: "SKID" });
    const expected = `Basic ${Buffer.from("AKID:SKID").toString("base64")}`;
    assert.equal(client.authorization, expected);
  });

  it("sends X-Trino-User, X-Trino-Catalog, X-Trino-Schema on every POST", () =>
    withMockFetch(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["X-Trino-User"], "svcaccount");
        assert.equal(headers["X-Trino-Catalog"], "vast");
        assert.equal(headers["X-Trino-Schema"], "spaceharbor/production");
        return jsonResponse({ id: "qH", columns: [], data: [], stats: { state: "FINISHED" } });
      },
      async () => {
        const client = makeClient({
          user: "svcaccount",
          catalog: "vast",
          schema: "spaceharbor/production",
        });
        await client.query("SELECT 1");
      },
    ));

  it("sends Authorization header on nextUri GET requests", () => {
    const authHeadersSeen: string[] = [];

    return withMockFetch(
      async (url, init) => {
        const h = init?.headers as Record<string, string>;
        if (h?.["Authorization"]) authHeadersSeen.push(h["Authorization"]);

        if (!url.includes("/next/")) {
          return jsonResponse({
            id: "qAuth",
            nextUri: "http://trino.test:8080/v1/statement/qAuth/next/1",
          });
        }
        return jsonResponse({ data: [["ok"]], columns: [{ name: "v", type: "varchar" }], stats: { state: "FINISHED" } });
      },
      async () => {
        await makeClient().query("SELECT 1");
        // Both the POST and the GET to nextUri must carry auth
        assert.ok(authHeadersSeen.length >= 2, "Expected auth on initial POST and at least one GET");
        assert.ok(authHeadersSeen.every((h) => h.startsWith("Basic ")), "All requests must carry Basic auth");
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Request/response cycle — nextUri chain
// ---------------------------------------------------------------------------

describe("TrinoClient mock integration — nextUri polling", () => {
  it("follows a two-hop nextUri chain and assembles data from all pages", () =>
    withMockFetch(
      async (url) => {
        if (!url.includes("/page/")) {
          return jsonResponse({
            id: "qPage",
            nextUri: "http://trino.test:8080/v1/statement/qPage/page/1",
            columns: [{ name: "id", type: "varchar" }],
          });
        }
        if (url.endsWith("/page/1")) {
          return jsonResponse({
            nextUri: "http://trino.test:8080/v1/statement/qPage/page/2",
            data: [["row-A"]],
            stats: { state: "RUNNING" },
          });
        }
        // Final page
        return jsonResponse({
          data: [["row-B"], ["row-C"]],
          columns: [{ name: "id", type: "varchar" }],
          stats: { state: "FINISHED" },
        });
      },
      async () => {
        const result = await makeClient().query("SELECT id FROM assets");
        assert.equal(result.rowCount, 3);
        assert.deepEqual(result.data, [["row-A"], ["row-B"], ["row-C"]]);
        assert.deepEqual(result.columns, [{ name: "id", type: "varchar" }]);
      },
    ));

  it("returns empty result set for DDL with no data pages", () =>
    withMockFetch(
      async (url) => {
        if (!url.includes("/ddl/")) {
          return jsonResponse({
            id: "qDDL",
            nextUri: "http://trino.test:8080/v1/statement/qDDL/ddl/1",
          });
        }
        return jsonResponse({ stats: { state: "FINISHED" } });
      },
      async () => {
        const result = await makeClient().query("CREATE TABLE IF NOT EXISTS assets (id VARCHAR)");
        assert.equal(result.rowCount, 0);
        assert.deepEqual(result.data, []);
      },
    ));

  it("resolves columns from a later page when initial response omits them", () =>
    withMockFetch(
      async (url) => {
        if (!url.includes("/col/")) {
          return jsonResponse({
            id: "qCol",
            nextUri: "http://trino.test:8080/v1/statement/qCol/col/1",
          });
        }
        return jsonResponse({
          columns: [{ name: "status", type: "varchar" }],
          data: [["active"]],
          stats: { state: "FINISHED" },
        });
      },
      async () => {
        const result = await makeClient().query("SELECT status FROM projects");
        assert.deepEqual(result.columns, [{ name: "status", type: "varchar" }]);
        assert.equal(result.rowCount, 1);
      },
    ));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("TrinoClient mock integration — error handling", () => {
  it("throws TrinoQueryError when POST returns non-200 status", () =>
    withMockFetch(
      async () => new Response("Unauthorized", { status: 401 }),
      async () => {
        await assert.rejects(
          () => makeClient().query("SELECT 1"),
          (err: unknown) => {
            assert.ok(err instanceof TrinoQueryError);
            assert.ok(err.message.includes("401"));
            return true;
          },
        );
      },
    ));

  it("throws TrinoQueryError with queryId when Trino reports error in polling chain", () =>
    withMockFetch(
      async (url) => {
        if (!url.includes("/err/")) {
          return jsonResponse({
            id: "qErr",
            nextUri: "http://trino.test:8080/v1/statement/qErr/err/1",
          });
        }
        return jsonResponse({
          id: "qErr",
          error: { message: "Syntax error near SELECT", errorCode: 1 },
          stats: { state: "FAILED" },
        });
      },
      async () => {
        await assert.rejects(
          () => makeClient().query("SELEC 1"),
          (err: unknown) => {
            assert.ok(err instanceof TrinoQueryError);
            assert.ok(err.message.includes("Syntax error"));
            assert.equal(err.queryId, "qErr");
            return true;
          },
        );
      },
    ));

  it("throws TrinoQueryError when error appears in the final response (no nextUri)", () =>
    withMockFetch(
      async () =>
        jsonResponse({
          id: "qFinal",
          error: { message: 'Table "bogus" does not exist', errorCode: 2 },
          stats: { state: "FAILED" },
        }),
      async () => {
        await assert.rejects(
          () => makeClient().query("SELECT * FROM bogus"),
          (err: unknown) => {
            assert.ok(err instanceof TrinoQueryError);
            assert.ok(err.message.includes("bogus"));
            return true;
          },
        );
      },
    ));

  it("wraps AbortError as a timeout TrinoQueryError", () =>
    withMockFetch(
      async () => {
        throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
      },
      async () => {
        await assert.rejects(
          () => makeClient().query("SELECT 1"),
          (err: unknown) => {
            assert.ok(err instanceof TrinoQueryError);
            assert.ok(err.message.includes("timed out"));
            return true;
          },
        );
      },
    ));

  it("wraps unexpected network errors as TrinoQueryError", () =>
    withMockFetch(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        await assert.rejects(
          () => makeClient().query("SELECT 1"),
          (err: unknown) => {
            assert.ok(err instanceof TrinoQueryError);
            assert.ok(err.message.includes("ECONNREFUSED"));
            return true;
          },
        );
      },
    ));
});

// ---------------------------------------------------------------------------
// healthCheck()
// ---------------------------------------------------------------------------

describe("TrinoClient mock integration — healthCheck", () => {
  it("returns reachable=true with version on GET /v1/info success", () =>
    withMockFetch(
      async () =>
        jsonResponse({ nodeVersion: { version: "442" }, environment: "production" }),
      async () => {
        const result = await makeClient().healthCheck();
        assert.equal(result.reachable, true);
        assert.equal(result.version, "442");
      },
    ));

  it("returns reachable=false on non-OK /v1/info response", () =>
    withMockFetch(
      async () => new Response("Service Unavailable", { status: 503 }),
      async () => {
        const result = await makeClient().healthCheck();
        assert.equal(result.reachable, false);
        assert.equal(result.version, undefined);
      },
    ));

  it("returns reachable=false on network error", () =>
    withMockFetch(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        const result = await makeClient().healthCheck();
        assert.equal(result.reachable, false);
      },
    ));

  it("returns reachable=true when /v1/info omits nodeVersion", () =>
    withMockFetch(
      async () => jsonResponse({ environment: "test" }),
      async () => {
        const result = await makeClient().healthCheck();
        assert.equal(result.reachable, true);
        assert.equal(result.version, undefined);
      },
    ));
});

// ---------------------------------------------------------------------------
// fetchWithRetry — 5xx backoff
// ---------------------------------------------------------------------------

describe("TrinoClient mock integration — 5xx retry on nextUri", () => {
  it("retries on 503 and succeeds on subsequent attempt", () => {
    let callCount = 0;

    return withMockFetch(
      async (url) => {
        if (!url.includes("/retry/")) {
          return jsonResponse({
            id: "qRetry",
            nextUri: "http://trino.test:8080/v1/statement/qRetry/retry/1",
          });
        }
        callCount++;
        if (callCount === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return jsonResponse({
          data: [["retried"]],
          columns: [{ name: "v", type: "varchar" }],
          stats: { state: "FINISHED" },
        });
      },
      async () => {
        const result = await makeClient({ maxRetries: 3 }).query("SELECT 1");
        assert.equal(result.rowCount, 1);
        assert.ok(callCount >= 2, "Should have retried at least once on 503");
      },
    );
  });
});
