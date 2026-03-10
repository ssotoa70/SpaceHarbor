import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, install } from "../src/db/installer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
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

// Suppress console output during tests
function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const err = console.error;
  const write = process.stdout.write;
  console.log = () => {};
  console.error = () => {};
  process.stdout.write = (() => true) as typeof process.stdout.write;
  return fn().finally(() => {
    console.log = log;
    console.error = err;
    process.stdout.write = write;
  });
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: extracts all flags correctly", () => {
  const args = parseArgs([
    "--trino-endpoint",
    "http://trino:8080",
    "--access-key",
    "ak",
    "--secret-key",
    "sk",
    "--target-version",
    "3",
    "--dry-run",
    "--schema",
    "myschema"
  ]);

  assert.equal(args.trinoEndpoint, "http://trino:8080");
  assert.equal(args.accessKey, "ak");
  assert.equal(args.secretKey, "sk");
  assert.equal(args.targetVersion, 3);
  assert.equal(args.dryRun, true);
  assert.equal(args.schema, "myschema");
});

test("parseArgs: defaults work correctly", () => {
  const args = parseArgs([]);
  assert.equal(args.trinoEndpoint, "");
  assert.equal(args.dryRun, false);
  assert.equal(args.schema, "assetharbor/production");
  assert.equal(args.targetVersion, undefined);
});

test("parseArgs: --help flag", () => {
  const args = parseArgs(["--help"]);
  assert.equal(args.help, true);
});

// ---------------------------------------------------------------------------
// install — dry-run mode
// ---------------------------------------------------------------------------

test("install: dry-run prints SQL without executing queries", () =>
  withMockFetch(
    async (url) => {
      // Only healthCheck should be called
      if (url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }
      throw new Error(`Unexpected fetch in dry-run: ${url}`);
    },
    () =>
      silenced(async () => {
        const result = await install({
          trinoEndpoint: "http://trino:8080",
          accessKey: "ak",
          secretKey: "sk",
          dryRun: true,
          schema: "assetharbor/production",
          help: false
        });
        // All 5 migrations should be "applied" in dry-run
        assert.equal(result.applied, 5);
        assert.equal(result.currentVersion, 5);
      })
  ));

// ---------------------------------------------------------------------------
// install — version gating
// ---------------------------------------------------------------------------

test("install: skips already-applied migrations", () =>
  withMockFetch(
    async (url, init) => {
      if (url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }

      const body = typeof init?.body === "string" ? init.body : "";

      // Auth check: SELECT 1
      if (body === "SELECT 1") {
        return jsonResponse({ columns: [], data: [[1]], stats: { state: "FINISHED" } });
      }

      // Schema version query — return version 3
      if (body.includes("MAX(version)")) {
        return jsonResponse({
          columns: [{ name: "max_ver", type: "integer" }],
          data: [[3]],
          stats: { state: "FINISHED" }
        });
      }

      // Migrations 4 and 5 DDL statements
      return jsonResponse({ stats: { state: "FINISHED" } });
    },
    () =>
      silenced(async () => {
        const result = await install({
          trinoEndpoint: "http://trino:8080",
          accessKey: "ak",
          secretKey: "sk",
          dryRun: false,
          schema: "assetharbor/production",
          help: false
        });
        // Only migrations 4 and 5 should apply
        assert.equal(result.applied, 2);
        assert.equal(result.currentVersion, 5);
      })
  ));

test("install: target-version limits migrations", () =>
  withMockFetch(
    async (url) => {
      if (url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }
      return jsonResponse({ stats: { state: "FINISHED" } });
    },
    () =>
      silenced(async () => {
        const result = await install({
          trinoEndpoint: "http://trino:8080",
          accessKey: "ak",
          secretKey: "sk",
          targetVersion: 2,
          dryRun: true,
          schema: "assetharbor/production",
          help: false
        });
        assert.equal(result.applied, 2);
        assert.equal(result.currentVersion, 2);
      })
  ));

// ---------------------------------------------------------------------------
// install — error handling
// ---------------------------------------------------------------------------

test("install: unreachable endpoint throws", () =>
  withMockFetch(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    () =>
      silenced(async () => {
        await assert.rejects(
          () =>
            install({
              trinoEndpoint: "http://trino:8080",
              accessKey: "ak",
              secretKey: "sk",
              dryRun: false,
              schema: "assetharbor/production",
              help: false
            }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes("not reachable"));
            return true;
          }
        );
      })
  ));

test("install: migration failure stops execution", () => {
  let queryCount = 0;

  return withMockFetch(
    async (url, init) => {
      if (url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }

      const body = typeof init?.body === "string" ? init.body : "";

      if (body === "SELECT 1") {
        return jsonResponse({ columns: [], data: [[1]], stats: { state: "FINISHED" } });
      }

      if (body.includes("MAX(version)")) {
        return jsonResponse({
          columns: [{ name: "max_ver", type: "integer" }],
          data: [[0]],
          stats: { state: "FINISHED" }
        });
      }

      queryCount++;
      // Fail on the 2nd DDL statement
      if (queryCount === 2) {
        return jsonResponse({
          error: { message: "Simulated table creation failure" },
          stats: { state: "FAILED" }
        });
      }
      return jsonResponse({ stats: { state: "FINISHED" } });
    },
    () =>
      silenced(async () => {
        await assert.rejects(
          () =>
            install({
              trinoEndpoint: "http://trino:8080",
              accessKey: "ak",
              secretKey: "sk",
              dryRun: false,
              schema: "assetharbor/production",
              help: false
            }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes("Migration 1 failed"));
            return true;
          }
        );
      })
  );
});

// ---------------------------------------------------------------------------
// install — up to date (no-op)
// ---------------------------------------------------------------------------

test("install: no migrations when already at latest", () =>
  withMockFetch(
    async (url, init) => {
      if (url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }

      const body = typeof init?.body === "string" ? init.body : "";

      if (body === "SELECT 1") {
        return jsonResponse({ columns: [], data: [[1]], stats: { state: "FINISHED" } });
      }

      if (body.includes("MAX(version)")) {
        return jsonResponse({
          columns: [{ name: "max_ver", type: "integer" }],
          data: [[5]],
          stats: { state: "FINISHED" }
        });
      }

      return jsonResponse({ stats: { state: "FINISHED" } });
    },
    () =>
      silenced(async () => {
        const result = await install({
          trinoEndpoint: "http://trino:8080",
          accessKey: "ak",
          secretKey: "sk",
          dryRun: false,
          schema: "assetharbor/production",
          help: false
        });
        assert.equal(result.applied, 0);
        assert.equal(result.currentVersion, 5);
      })
  ));
