import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PipelineDiscoveryService,
  type FunctionFetcher,
  type LiveFunctionRecord,
} from "../src/data-engine/discovery.js";
import type { DataEnginePipelineConfig } from "../src/data-engine/pipeline-config.js";

const frameConfig: DataEnginePipelineConfig = {
  fileKind: "image",
  functionName: "frame-metadata-extractor",
  extensions: [".exr"],
  targetSchema: "frame_metadata",
  targetTable: "files",
  sidecarSchemaId: "frame@1",
};

const videoConfig: DataEnginePipelineConfig = {
  fileKind: "video",
  functionName: "video-metadata-extractor",
  extensions: [".mp4"],
  targetSchema: "video_metadata",
  targetTable: "files",
  sidecarSchemaId: "video@1",
};

const liveFrame: LiveFunctionRecord = {
  guid: "1be09ba0-ba18-4483-a930-1cd96c0a57c5",
  name: "frame-metadata-extractor",
  description: "Multi-format VFX frame metadata extractor",
  owner: { id: "262", name: "Sergio Soto" },
  createdAt: "2026-04-14T22:02:13.688000Z",
  updatedAt: "2026-04-14T22:02:13.688000Z",
  vrn: "vast:dataengine:functions:frame-metadata-extractor",
  lastRevisionNumber: 1,
};

const liveVideo: LiveFunctionRecord = {
  guid: "c71f8092-0adb-4680-bbb5-e25c53059485",
  name: "video-metadata-extractor",
  description: "Rich video metadata extraction",
  owner: { id: "262", name: "Sergio Soto" },
  createdAt: "2026-04-14T22:00:00Z",
  updatedAt: "2026-04-14T22:00:00Z",
  vrn: "vast:dataengine:functions:video-metadata-extractor",
  lastRevisionNumber: 2,
};

/** Build a fetcher from a simple name → record map. */
function staticFetcher(records: Record<string, LiveFunctionRecord | null>): FunctionFetcher & { callCount: () => number } {
  let calls = 0;
  return {
    fetchByName: async (name) => {
      calls += 1;
      return records[name] ?? null;
    },
    callCount: () => calls,
  };
}

/** Build a fetcher that throws a fixed error. */
function throwingFetcher(message: string): FunctionFetcher {
  return {
    fetchByName: async () => {
      throw new Error(message);
    },
  };
}

describe("PipelineDiscoveryService — merge logic", () => {
  it("merges config + live record on happy path", async () => {
    const fetcher = staticFetcher({
      "frame-metadata-extractor": liveFrame,
      "video-metadata-extractor": liveVideo,
    });
    const svc = new PipelineDiscoveryService(() => [frameConfig, videoConfig], fetcher);

    const result = await svc.discover();
    assert.equal(result.length, 2);
    assert.equal(result[0].status, "ok");
    assert.equal(result[0].config.functionName, "frame-metadata-extractor");
    assert.equal(result[0].live?.guid, "1be09ba0-ba18-4483-a930-1cd96c0a57c5");
    assert.equal(result[1].status, "ok");
    assert.equal(result[1].live?.name, "video-metadata-extractor");
  });

  it("returns empty array when no pipelines are configured", async () => {
    const svc = new PipelineDiscoveryService(() => [], staticFetcher({}));
    const result = await svc.discover();
    assert.deepEqual(result, []);
  });

  it("tags function-not-found when VAST returns no match", async () => {
    const fetcher = staticFetcher({}); // empty — every name returns null
    const svc = new PipelineDiscoveryService(() => [frameConfig], fetcher);
    const result = await svc.discover();
    assert.equal(result[0].status, "function-not-found");
    assert.equal(result[0].live, null);
    assert.match(result[0].statusDetail ?? "", /frame-metadata-extractor/);
  });

  it("tags vast-unreachable when fetcher throws", async () => {
    const svc = new PipelineDiscoveryService(
      () => [frameConfig],
      throwingFetcher("ECONNREFUSED 127.0.0.1:443"),
    );
    const result = await svc.discover();
    assert.equal(result[0].status, "vast-unreachable");
    assert.match(result[0].statusDetail ?? "", /ECONNREFUSED/);
  });

  it("isolates failures across pipelines — one error does not block others", async () => {
    const fetcher: FunctionFetcher = {
      fetchByName: async (name) => {
        if (name === "frame-metadata-extractor") throw new Error("frame lookup broke");
        if (name === "video-metadata-extractor") return liveVideo;
        return null;
      },
    };
    const svc = new PipelineDiscoveryService(() => [frameConfig, videoConfig], fetcher);
    const result = await svc.discover();
    assert.equal(result[0].status, "vast-unreachable");
    assert.equal(result[1].status, "ok");
    assert.equal(result[1].live?.guid, liveVideo.guid);
  });
});

describe("PipelineDiscoveryService — cache", () => {
  it("serves from cache within TTL without re-fetching", async () => {
    const fetcher = staticFetcher({ "frame-metadata-extractor": liveFrame });
    const svc = new PipelineDiscoveryService(() => [frameConfig], fetcher, 60_000);

    await svc.discover();
    await svc.discover();
    await svc.discover();

    assert.equal(fetcher.callCount(), 1);
  });

  it("refetches after TTL expiry", async () => {
    let currentTime = 0;
    const fetcher = staticFetcher({ "frame-metadata-extractor": liveFrame });
    const svc = new PipelineDiscoveryService(
      () => [frameConfig],
      fetcher,
      1000,
      () => currentTime,
    );

    await svc.discover();
    assert.equal(fetcher.callCount(), 1);

    currentTime = 500;
    await svc.discover();
    assert.equal(fetcher.callCount(), 1, "still cached at t=500");

    currentTime = 1001;
    await svc.discover();
    assert.equal(fetcher.callCount(), 2, "refetched after TTL");
  });

  it("force option bypasses cache", async () => {
    const fetcher = staticFetcher({ "frame-metadata-extractor": liveFrame });
    const svc = new PipelineDiscoveryService(() => [frameConfig], fetcher);

    await svc.discover();
    await svc.discover({ force: true });

    assert.equal(fetcher.callCount(), 2);
  });

  it("invalidate() drops the cache so next call refetches", async () => {
    const fetcher = staticFetcher({ "frame-metadata-extractor": liveFrame });
    const svc = new PipelineDiscoveryService(() => [frameConfig], fetcher);

    await svc.discover();
    svc.invalidate();
    await svc.discover();

    assert.equal(fetcher.callCount(), 2);
  });

  it("dedupes concurrent in-flight fetches (cache-miss burst)", async () => {
    let pending: ((r: LiveFunctionRecord | null) => void) = () => {};
    let callCount = 0;
    const fetcher: FunctionFetcher = {
      fetchByName: async () => {
        callCount += 1;
        return new Promise((resolve) => { pending = resolve; });
      },
    };
    const svc = new PipelineDiscoveryService(() => [frameConfig], fetcher);

    // Fire three concurrent discover() calls before any resolves
    const p1 = svc.discover();
    const p2 = svc.discover();
    const p3 = svc.discover();

    // Resolve the shared pending fetch
    pending(liveFrame);

    await Promise.all([p1, p2, p3]);
    assert.equal(callCount, 1, "only one fetch should be issued despite three concurrent calls");
  });

  it("picks up configProvider changes after invalidation", async () => {
    const fetcher = staticFetcher({
      "frame-metadata-extractor": liveFrame,
      "video-metadata-extractor": liveVideo,
    });
    let configs: DataEnginePipelineConfig[] = [frameConfig];
    const svc = new PipelineDiscoveryService(() => configs, fetcher);

    const first = await svc.discover();
    assert.equal(first.length, 1);

    configs = [frameConfig, videoConfig];
    svc.invalidate();

    const second = await svc.discover();
    assert.equal(second.length, 2);
  });
});
