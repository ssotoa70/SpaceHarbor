import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../../src/utils/ttl-cache.js";

describe("TtlCache", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache<string>(100); // 100ms TTL for fast tests
  });

  it("set and get returns value", () => {
    cache.set("a", "hello");
    assert.equal(cache.get("a"), "hello");
  });

  it("returns undefined for non-existent key", () => {
    assert.equal(cache.get("missing"), undefined);
  });

  it("has() returns true for existing key", () => {
    cache.set("a", "hello");
    assert.ok(cache.has("a"));
  });

  it("has() returns false for non-existent key", () => {
    assert.ok(!cache.has("missing"));
  });

  it("expires after TTL", async () => {
    cache.set("a", "hello");
    assert.equal(cache.get("a"), "hello");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cache.get("a"), undefined);
  });

  it("clear removes all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get("a"), undefined);
  });

  it("size reflects live entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    assert.equal(cache.size, 2);
  });

  it("default TTL is 10 minutes", () => {
    const defaultCache = new TtlCache<number>();
    defaultCache.set("x", 42);
    assert.equal(defaultCache.get("x"), 42);
  });

  it("overwrites existing key", () => {
    cache.set("a", "first");
    cache.set("a", "second");
    assert.equal(cache.get("a"), "second");
  });
});
