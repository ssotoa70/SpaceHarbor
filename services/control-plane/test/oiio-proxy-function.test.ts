import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OiioProxyFunction } from "../src/data-engine/functions/oiio-proxy.js";
import { FunctionRegistry } from "../src/data-engine/registry.js";

describe("OiioProxyFunction", () => {
  it("has correct function id", () => {
    const fn = new OiioProxyFunction();
    assert.equal(fn.id, "oiio_proxy_generator");
  });

  it("has required DataEngineFunction fields", () => {
    const fn = new OiioProxyFunction();
    assert.ok(fn.version);
    assert.ok(fn.description);
    assert.ok(fn.inputSchema);
    assert.ok(fn.outputSchema);
  });

  it("execute returns expected shape in dev mode", async () => {
    const fn = new OiioProxyFunction();
    const result = await fn.execute({
      asset_id: "abc123",
      source_uri: "mock://ingest/abc123/hero.exr",
      event_type: "ElementCreated",
    });
    assert.equal(result["status"], "completed");
    assert.ok(result["thumbnail_uri"]);
    assert.ok(result["proxy_uri"]);
  });

  it("can be registered in FunctionRegistry", () => {
    const registry = new FunctionRegistry();
    registry.register(new OiioProxyFunction());
    assert.ok(registry.has("oiio_proxy_generator"));
    assert.equal(registry.size, 1);
  });
});
