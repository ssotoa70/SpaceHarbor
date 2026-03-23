import test from "node:test";
import assert from "node:assert/strict";
import { TrinoClient, TrinoQueryError } from "../src/db/trino-client.js";
import type { TrinoQueryResult } from "../src/db/trino-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeClient(overrides?: Partial<ConstructorParameters<typeof TrinoClient>[0]>): TrinoClient {
  return new TrinoClient({
    endpoint: "http://trino.local:8080",
    accessKey: "myAccessKey",
    secretKey: "mySecretKey",
    ...overrides
  });
}

function withMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    return handler(urlStr, init);
  }) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("TrinoClient: auth header is correct Base64", () => {
  const client = makeClient();
  const expected = `Basic ${Buffer.from("myAccessKey:mySecretKey").toString("base64")}`;
  assert.equal(client.authorization, expected);
});

// ---------------------------------------------------------------------------
// query() — nextUri polling
// ---------------------------------------------------------------------------

test("TrinoClient: follows nextUri chain (3 hops)", () =>
  withMockFetch(
    async (url) => {
      if (!url.includes("/q1/")) {
        return jsonResponse({
          id: "q1",
          nextUri: "http://trino.local:8080/v1/statement/q1/1",
          stats: { state: "RUNNING" }
        });
      }
      if (url.endsWith("/q1/1")) {
        return jsonResponse({
          nextUri: "http://trino.local:8080/v1/statement/q1/2",
          columns: [
            { name: "id", type: "varchar" },
            { name: "name", type: "varchar" }
          ],
          stats: { state: "RUNNING" }
        });
      }
      if (url.endsWith("/q1/2")) {
        return jsonResponse({
          nextUri: "http://trino.local:8080/v1/statement/q1/3",
          data: [["1", "alpha"]],
          stats: { state: "RUNNING" }
        });
      }
      // Final response
      return jsonResponse({
        columns: [
          { name: "id", type: "varchar" },
          { name: "name", type: "varchar" }
        ],
        data: [["2", "beta"]],
        stats: { state: "FINISHED" }
      });
    },
    async () => {
      const result: TrinoQueryResult = await makeClient().query("SELECT id, name FROM projects");
      assert.equal(result.rowCount, 2);
      assert.deepEqual(result.columns, [
        { name: "id", type: "varchar" },
        { name: "name", type: "varchar" }
      ]);
      assert.deepEqual(result.data, [
        ["1", "alpha"],
        ["2", "beta"]
      ]);
    }
  ));

// ---------------------------------------------------------------------------
// query() — error in polling chain
// ---------------------------------------------------------------------------

test("TrinoClient: throws TrinoQueryError on FAILED state", () =>
  withMockFetch(
    async (url) => {
      if (!url.includes("/q2/")) {
        return jsonResponse({
          id: "q2",
          nextUri: "http://trino.local:8080/v1/statement/q2/1",
          stats: { state: "QUEUED" }
        });
      }
      return jsonResponse({
        id: "q2",
        error: { message: 'Table "bogus" does not exist', errorCode: 1 },
        stats: { state: "FAILED" }
      });
    },
    async () => {
      await assert.rejects(
        () => makeClient().query("SELECT * FROM bogus"),
        (err: unknown) => {
          assert.ok(err instanceof TrinoQueryError);
          assert.ok(err.message.includes("does not exist"));
          assert.equal(err.queryId, "q2");
          return true;
        }
      );
    }
  ));

// ---------------------------------------------------------------------------
// query() — HTTP error on initial POST
// ---------------------------------------------------------------------------

test("TrinoClient: throws on non-OK HTTP response", () =>
  withMockFetch(
    async () => new Response("Unauthorized", { status: 401 }),
    async () => {
      await assert.rejects(
        () => makeClient().query("SELECT 1"),
        (err: unknown) => {
          assert.ok(err instanceof TrinoQueryError);
          assert.ok(err.message.includes("401"));
          return true;
        }
      );
    }
  ));

// ---------------------------------------------------------------------------
// query() — single-response (no nextUri)
// ---------------------------------------------------------------------------

test("TrinoClient: handles immediate result (no nextUri)", () =>
  withMockFetch(
    async () =>
      jsonResponse({
        id: "q3",
        columns: [{ name: "result", type: "integer" }],
        data: [[1]],
        stats: { state: "FINISHED" }
      }),
    async () => {
      const result = await makeClient().query("SELECT 1");
      assert.equal(result.rowCount, 1);
      assert.deepEqual(result.data, [[1]]);
    }
  ));

// ---------------------------------------------------------------------------
// query() — timeout (abort signal handling)
// ---------------------------------------------------------------------------

test("TrinoClient: wraps AbortError as timeout TrinoQueryError", () =>
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
        }
      );
    }
  ));

// ---------------------------------------------------------------------------
// query() — error in final response (no nextUri)
// ---------------------------------------------------------------------------

test("TrinoClient: detects error in final response", () =>
  withMockFetch(
    async () =>
      jsonResponse({
        id: "q4",
        error: { message: "Syntax error at line 1" },
        stats: { state: "FAILED" }
      }),
    async () => {
      await assert.rejects(
        () => makeClient().query("SELEC 1"),
        (err: unknown) => {
          assert.ok(err instanceof TrinoQueryError);
          assert.ok(err.message.includes("Syntax error"));
          return true;
        }
      );
    }
  ));

// ---------------------------------------------------------------------------
// query() — sends correct headers
// ---------------------------------------------------------------------------

test("TrinoClient: sends correct catalog/schema/user headers", () => {
  let capturedHeaders: Record<string, string> = {};

  return withMockFetch(
    async (_url, init) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h?.["X-Trino-User"]) capturedHeaders = { ...h };
      return jsonResponse({ id: "q5", columns: [], data: [], stats: { state: "FINISHED" } });
    },
    async () => {
      const client = makeClient({ user: "testuser", schema: "myschema", catalog: "mycatalog" });
      await client.query("SELECT 1");
      assert.equal(capturedHeaders["X-Trino-User"], "testuser");
      assert.equal(capturedHeaders["X-Trino-Catalog"], "mycatalog");
      assert.equal(capturedHeaders["X-Trino-Schema"], "myschema");
    }
  );
});

// ---------------------------------------------------------------------------
// healthCheck()
// ---------------------------------------------------------------------------

test("TrinoClient: healthCheck returns version on success", () =>
  withMockFetch(
    async () => jsonResponse({ nodeVersion: { version: "442" }, environment: "production" }),
    async () => {
      const result = await makeClient().healthCheck();
      assert.equal(result.reachable, true);
      assert.equal(result.version, "442");
    }
  ));

test("TrinoClient: healthCheck returns unreachable on network error", () =>
  withMockFetch(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    async () => {
      const result = await makeClient().healthCheck();
      assert.equal(result.reachable, false);
      assert.equal(result.version, undefined);
    }
  ));

test("TrinoClient: healthCheck returns unreachable on non-OK status", () =>
  withMockFetch(
    async () => new Response("Forbidden", { status: 403 }),
    async () => {
      const result = await makeClient().healthCheck();
      assert.equal(result.reachable, false);
    }
  ));

// ---------------------------------------------------------------------------
// DDL queries (no result data)
// ---------------------------------------------------------------------------

test("TrinoClient: handles DDL statement with empty result", () =>
  withMockFetch(
    async (url) => {
      if (!url.includes("/q6/")) {
        return jsonResponse({
          id: "q6",
          nextUri: "http://trino.local:8080/v1/statement/q6/1",
          stats: { state: "RUNNING" }
        });
      }
      return jsonResponse({ stats: { state: "FINISHED" } });
    },
    async () => {
      const result = await makeClient().query("CREATE TABLE IF NOT EXISTS foo (id VARCHAR)");
      assert.equal(result.rowCount, 0);
      assert.deepEqual(result.data, []);
    }
  ));
