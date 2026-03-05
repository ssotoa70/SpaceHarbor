import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processProxyGeneratedEvent } from "../src/events/processor.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { isProxyGeneratedEvent } from "../src/events/types.js";

function ctx(id: string) {
  return { correlationId: id };
}

describe("processProxyGeneratedEvent", () => {
  it("updates asset thumbnail_url and proxy_url in metadata", () => {
    const persistence = new LocalPersistenceAdapter();
    const ingest = persistence.createIngestAsset(
      { title: "hero-plate", sourceUri: "mock://ingest/abc123/hero.exr" },
      ctx("corr-proxy-event-1"),
    );
    const assetId = ingest.asset.id;

    processProxyGeneratedEvent(
      {
        type: "proxy.generated",
        asset_id: assetId,
        thumbnail_uri: "mock://thumbnails/abc123_thumb.jpg",
        proxy_uri: "mock://proxies/abc123_proxy.mp4",
        timestamp: new Date().toISOString(),
      },
      persistence,
      ctx("corr-proxy-event-2"),
    );

    const updated = persistence.getAssetById(assetId);
    assert.equal(updated?.metadata?.thumbnail_url, "mock://thumbnails/abc123_thumb.jpg");
    assert.equal(updated?.metadata?.proxy_url, "mock://proxies/abc123_proxy.mp4");
  });

  it("is a no-op for unknown asset_id", () => {
    const persistence = new LocalPersistenceAdapter();
    // Should not throw
    processProxyGeneratedEvent(
      {
        type: "proxy.generated",
        asset_id: "nonexistent-asset",
        thumbnail_uri: "mock://thumb.jpg",
        proxy_uri: "mock://proxy.mp4",
        timestamp: new Date().toISOString(),
      },
      persistence,
      ctx("corr-proxy-event-noop"),
    );
  });

  it("isProxyGeneratedEvent narrows correctly", () => {
    assert.ok(
      isProxyGeneratedEvent({
        type: "proxy.generated",
        asset_id: "abc123",
        thumbnail_uri: "/t.jpg",
        proxy_uri: "/p.mp4",
        timestamp: "2026-01-01T00:00:00Z",
      }),
    );
    assert.ok(!isProxyGeneratedEvent({ type: "other.event", asset_id: "x" }));
    assert.ok(!isProxyGeneratedEvent(null));
  });
});
