import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createVastFunctionFetcher,
  pickFirstMatch,
  type VastFetcherContext,
} from "../src/data-engine/vast-function-fetcher.js";
import { VmsTokenManager } from "../src/vast/vms-token-manager.js";

// Real-ish VAST response shape captured from the live /dataengine-proxy
const vastResponse = {
  pagination: { next_cursor: null, previous_cursor: null },
  data: [
    {
      default_revision_number: null,
      name: "frame-metadata-extractor",
      description: "Multi-format VFX frame metadata extractor",
      tags: null,
      id: 7449940102744113000,
      guid: "1be09ba0-ba18-4483-a930-1cd96c0a57c5",
      tenant_guid: "d3670cd1-0709-4473-8e29-969c71b24d13",
      owner: { id: "262", id_type: "vid", name: "Sergio Soto" },
      created_at: "2026-04-14T22:02:13.688000Z",
      updated_at: "2026-04-14T22:02:13.688000Z",
      vrn: "vast:dataengine:functions:frame-metadata-extractor",
      last_revision_number: 1,
      container_registry_vrn: "vast:dataengine:container-registries:selab-docker",
    },
  ],
};

describe("pickFirstMatch", () => {
  it("extracts a matching record from a valid VAST response", () => {
    const result = pickFirstMatch(vastResponse, "frame-metadata-extractor");
    assert.ok(result);
    assert.equal(result?.guid, "1be09ba0-ba18-4483-a930-1cd96c0a57c5");
    assert.equal(result?.name, "frame-metadata-extractor");
    assert.equal(result?.description, "Multi-format VFX frame metadata extractor");
    assert.equal(result?.owner?.name, "Sergio Soto");
    assert.equal(result?.createdAt, "2026-04-14T22:02:13.688000Z");
    assert.equal(result?.vrn, "vast:dataengine:functions:frame-metadata-extractor");
    assert.equal(result?.lastRevisionNumber, 1);
  });

  it("returns null when data array is empty", () => {
    assert.equal(pickFirstMatch({ pagination: {}, data: [] }, "whatever"), null);
  });

  it("returns null when no record matches the requested name", () => {
    assert.equal(pickFirstMatch(vastResponse, "other-function"), null);
  });

  it("returns null when data field is missing", () => {
    assert.equal(pickFirstMatch({ pagination: {} }, "frame-metadata-extractor"), null);
  });

  it("returns null on invalid envelope", () => {
    assert.equal(pickFirstMatch(null, "x"), null);
    assert.equal(pickFirstMatch(undefined, "x"), null);
    assert.equal(pickFirstMatch("not an object", "x"), null);
    assert.equal(pickFirstMatch([], "x"), null);
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = { data: [{ name: "x", guid: "g1" }] };
    const result = pickFirstMatch(minimal, "x");
    assert.equal(result?.guid, "g1");
    assert.equal(result?.name, "x");
    assert.equal(result?.description, "");
    assert.equal(result?.owner, null);
    assert.equal(result?.createdAt, null);
  });
});

describe("createVastFunctionFetcher — HTTP orchestration", () => {
  /** Fake token manager — returns a fixed token, never hits the network.
   *  Tracks state across forceRefresh() so that subsequent getToken() calls
   *  return the refreshed value (required because the retry wrapper calls
   *  fn() fresh on each attempt, which calls getToken() fresh). */
  function fakeTokenManager(token = "fake-access-token"): VmsTokenManager {
    const mgr = Object.create(VmsTokenManager.prototype) as VmsTokenManager;
    let current = token;
    (mgr as unknown as { getToken: () => Promise<string> }).getToken = async () => current;
    (mgr as unknown as { forceRefresh: () => Promise<string> }).forceRefresh = async () => {
      current = token + "-refreshed";
      return current;
    };
    return mgr;
  }

  const baseContext: VastFetcherContext = {
    vastBaseUrl: "https://vast.example.com",
    tenant: "test-tenant",
    tokenManager: fakeTokenManager(),
  };

  it("issues the expected GET with Bearer token and X-Tenant-Name header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(vastResponse), { status: 200 });
    };

    const fetcher = createVastFunctionFetcher(() => baseContext, fakeFetch);
    const result = await fetcher.fetchByName("frame-metadata-extractor");

    assert.ok(capturedUrl.includes("/api/latest/dataengine/functions/"));
    assert.ok(capturedUrl.includes("name=frame-metadata-extractor"));
    assert.equal(capturedHeaders.Authorization, "Bearer fake-access-token");
    assert.equal(capturedHeaders["X-Tenant-Name"], "test-tenant");
    assert.equal(result?.guid, "1be09ba0-ba18-4483-a930-1cd96c0a57c5");
  });

  it("omits X-Tenant-Name header when tenant is null", async () => {
    let headers: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(vastResponse), { status: 200 });
    };

    const fetcher = createVastFunctionFetcher(
      () => ({ ...baseContext, tenant: null }),
      fakeFetch,
    );
    await fetcher.fetchByName("frame-metadata-extractor");
    assert.equal(headers["X-Tenant-Name"], undefined);
  });

  it("retries once on 401 with a refreshed token", async () => {
    const tokens: string[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      tokens.push((init?.headers as Record<string, string>).Authorization ?? "");
      return new Response("", { status: tokens.length === 1 ? 401 : 200, ...(tokens.length === 1 ? {} : { headers: { "content-type": "application/json" } }) });
    };

    // Second call returns 200 + valid body
    let callCount = 0;
    const fakeFetch2: typeof fetch = async (_url, init) => {
      callCount += 1;
      const auth = (init?.headers as Record<string, string>).Authorization ?? "";
      tokens.push(auth);
      if (callCount === 1) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify(vastResponse), { status: 200 });
    };

    const fetcher = createVastFunctionFetcher(() => baseContext, fakeFetch2);
    const result = await fetcher.fetchByName("frame-metadata-extractor");
    assert.equal(result?.name, "frame-metadata-extractor");
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], "Bearer fake-access-token");
    assert.equal(tokens[1], "Bearer fake-access-token-refreshed");
  });

  it("throws when VAST returns 5xx", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("server broke", { status: 500 });

    const fetcher = createVastFunctionFetcher(() => baseContext, fakeFetch);
    await assert.rejects(
      () => fetcher.fetchByName("frame-metadata-extractor"),
      /HTTP 500/,
    );
  });

  it("throws when the context provider returns null (VAST not configured)", async () => {
    const fetcher = createVastFunctionFetcher(() => null, fetch);
    await assert.rejects(
      () => fetcher.fetchByName("x"),
      /not configured/,
    );
  });

  it("throws when network fails", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const fetcher = createVastFunctionFetcher(() => baseContext, fakeFetch);
    await assert.rejects(
      () => fetcher.fetchByName("x"),
      /unreachable.*ECONNREFUSED/,
    );
  });

  it("returns null when VAST returns 200 with empty results (function-not-found)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 });
    const fetcher = createVastFunctionFetcher(() => baseContext, fakeFetch);
    const result = await fetcher.fetchByName("nonexistent");
    assert.equal(result, null);
  });

  it("calls contextProvider on every lookup so settings changes are picked up", async () => {
    let callCount = 0;
    const provider = () => {
      callCount += 1;
      return baseContext;
    };
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(vastResponse), { status: 200 });
    const fetcher = createVastFunctionFetcher(provider, fakeFetch);
    await fetcher.fetchByName("frame-metadata-extractor");
    await fetcher.fetchByName("frame-metadata-extractor");
    assert.equal(callCount, 2);
  });
});
