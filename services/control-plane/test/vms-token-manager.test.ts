import test from "node:test";
import assert from "node:assert/strict";
import { VmsTokenManager } from "../src/vast/vms-token-manager.js";

// ── Mock helpers ──

/** Create a minimal JWT with the given exp (Unix seconds). */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.sig`;
}

/** Create a mock fetch that returns token pairs. */
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
      headers: new Headers({ "content-type": "application/json" }),
    } as unknown as Response;
  };

  return { fn: fn as unknown as typeof fetch, calls };
}

// ── Tests ──

test("VmsTokenManager: login fetches access + refresh tokens", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600; // 1h from now
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "refresh-tok" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "admin",
    password: "secret",
  }, fn);

  const token = await tm.getToken();
  assert.ok(token.includes("."), "should return a JWT");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("/api/latest/token/"));
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.username, "admin");
  assert.equal(body.password, "secret");
});

test("VmsTokenManager: caches token on second call", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  const t1 = await tm.getToken();
  const t2 = await tm.getToken();
  assert.equal(t1, t2);
  assert.equal(calls.length, 1, "should only call login once");
});

test("VmsTokenManager: refreshes when token is about to expire", async () => {
  // Token that expires in 30 seconds (within the 60s buffer)
  const exp = Math.floor(Date.now() / 1000) + 30;
  const freshExp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
    { status: 200, body: { access: makeJwt(freshExp) } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  // First call — login
  await tm.getToken();
  assert.equal(calls.length, 1);

  // Second call — should trigger refresh because token is expiring soon
  await tm.getToken();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes("/api/latest/token/refresh/"));
});

test("VmsTokenManager: forceRefresh clears and re-logs in", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
    { status: 200, body: { access: makeJwt(exp), refresh: "r2" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  await tm.getToken();
  await tm.forceRefresh();
  assert.equal(calls.length, 2);
  // Both calls should be to /token/ (login), not /token/refresh/
  assert.ok(calls[0].url.includes("/api/latest/token/"));
  assert.ok(calls[1].url.includes("/api/latest/token/"));
});

test("VmsTokenManager: login failure throws", async () => {
  const { fn } = mockFetch([
    { status: 401, body: { detail: "Invalid credentials" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "bad",
    password: "bad",
  }, fn);

  await assert.rejects(tm.getToken(), /VMS login failed/);
});

test("VmsTokenManager: testConnection returns ok on success", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  const result = await tm.testConnection();
  assert.equal(result.ok, true);
  assert.ok(result.message.includes("successful"));
});

test("VmsTokenManager: testConnection returns error on 401", async () => {
  const { fn } = mockFetch([
    { status: 401, body: {} },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  const result = await tm.testConnection();
  assert.equal(result.ok, false);
  assert.ok(result.message.includes("Invalid VMS credentials"));
});

test("VmsTokenManager: concurrent getToken calls share one login", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  // Fire 5 concurrent getToken calls
  const results = await Promise.all([
    tm.getToken(),
    tm.getToken(),
    tm.getToken(),
    tm.getToken(),
    tm.getToken(),
  ]);

  assert.equal(calls.length, 1, "only one login request");
  assert.ok(results.every((t) => t === results[0]), "all return same token");
});

test("VmsTokenManager: clear invalidates cached tokens", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
    { status: 200, body: { access: makeJwt(exp), refresh: "r2" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com", {
    username: "u",
    password: "p",
  }, fn);

  await tm.getToken();
  tm.clear();
  await tm.getToken();
  assert.equal(calls.length, 2, "should login again after clear");
});

test("VmsTokenManager: strips trailing slash from base URL", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { fn, calls } = mockFetch([
    { status: 200, body: { access: makeJwt(exp), refresh: "r" } },
  ]);

  const tm = new VmsTokenManager("https://vast.example.com///", {
    username: "u",
    password: "p",
  }, fn);

  await tm.getToken();
  assert.ok(!calls[0].url.includes("///"));
  assert.ok(calls[0].url.startsWith("https://vast.example.com/api/"));
});
