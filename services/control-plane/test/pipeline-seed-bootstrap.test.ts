import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapDataEnginePipelinesSeed,
  getDataEnginePipelines,
  __setSettingsStoreForTests,
} from "../src/routes/platform-settings.js";
import type { SeedLoader } from "../src/data-engine/pipeline-seed.js";
import type { DataEnginePipelineConfig } from "../src/data-engine/pipeline-config.js";
import type { SettingsStore } from "../src/persistence/settings-store.js";

function makeMemoryStore(): {
  store: SettingsStore;
  raw: Map<string, Record<string, unknown>>;
} {
  const raw = new Map<string, Record<string, unknown>>();
  return {
    raw,
    store: {
      get: (ns) => raw.get(ns) ?? null,
      set: (ns, value) => { raw.set(ns, value); },
      delete: (ns) => { raw.delete(ns); },
      listNamespaces: () => [...raw.keys()],
    },
  };
}

const seedPipelines: DataEnginePipelineConfig[] = [
  {
    fileKind: "image",
    functionName: "frame-metadata-extractor",
    extensions: [".exr"],
    targetSchema: "frame_metadata",
    targetTable: "files",
    sidecarSchemaId: "frame@1",
  },
  {
    fileKind: "video",
    functionName: "video-metadata-extractor",
    extensions: [".mp4"],
    targetSchema: "video_metadata",
    targetTable: "files",
    sidecarSchemaId: "video@1",
  },
];

const seedLoader: SeedLoader = { load: () => seedPipelines };

describe("bootstrapDataEnginePipelinesSeed", () => {
  it("seeds on first boot when store is empty", () => {
    const { store, raw } = makeMemoryStore();
    __setSettingsStoreForTests(store);

    const result = bootstrapDataEnginePipelinesSeed(seedLoader);
    assert.equal(result.action, "seeded");

    const persisted = raw.get("platform.operational") as Record<string, unknown>;
    assert.equal(persisted.dataEnginePipelinesSeeded, true);
    assert.equal((persisted.dataEnginePipelines as unknown[]).length, 2);

    const current = getDataEnginePipelines();
    assert.equal(current.length, 2);
    assert.equal(current[0].functionName, "frame-metadata-extractor");
  });

  it("does NOT re-seed after restart when sentinel is persisted", () => {
    const { store, raw } = makeMemoryStore();
    raw.set("platform.operational", {
      vastDatabase: {},
      vastEventBroker: {},
      vastDataEngine: {},
      storage: { endpoints: [], nfsConnectors: [], smbConnectors: [] },
      dataEnginePipelines: seedPipelines,
      dataEnginePipelinesSeeded: true,
    });
    __setSettingsStoreForTests(store);

    const result = bootstrapDataEnginePipelinesSeed(seedLoader);
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "already-seeded");
  });

  it("does NOT re-seed after an admin cleared the pipelines", () => {
    const { store, raw } = makeMemoryStore();
    raw.set("platform.operational", {
      vastDatabase: {},
      vastEventBroker: {},
      vastDataEngine: {},
      storage: { endpoints: [], nfsConnectors: [], smbConnectors: [] },
      dataEnginePipelines: [],
      dataEnginePipelinesSeeded: true,
    });
    __setSettingsStoreForTests(store);

    const result = bootstrapDataEnginePipelinesSeed(seedLoader);
    assert.equal(result.action, "skipped");
    assert.equal(getDataEnginePipelines().length, 0);
  });

  it("sets the sentinel for legacy data (non-empty list, missing sentinel)", () => {
    const { store, raw } = makeMemoryStore();
    raw.set("platform.operational", {
      vastDatabase: {},
      vastEventBroker: {},
      vastDataEngine: {},
      storage: { endpoints: [], nfsConnectors: [], smbConnectors: [] },
      dataEnginePipelines: seedPipelines,
    });
    __setSettingsStoreForTests(store);

    const result = bootstrapDataEnginePipelinesSeed(seedLoader);
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "nonempty-without-sentinel");

    const persisted = raw.get("platform.operational") as Record<string, unknown>;
    assert.equal(persisted.dataEnginePipelinesSeeded, true);
  });

  it("returns failed when seed loader throws", () => {
    const { store } = makeMemoryStore();
    __setSettingsStoreForTests(store);

    const warnings: string[] = [];
    const fakeLog = {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
    };

    const brokenLoader: SeedLoader = {
      load: () => { throw new Error("disk full"); },
    };
    const result = bootstrapDataEnginePipelinesSeed(brokenLoader, fakeLog);
    assert.equal(result.action, "failed");
    assert.match(result.reason ?? "", /disk full/);
    assert.equal(warnings.length, 1);
    assert.equal(getDataEnginePipelines().length, 0);
  });

  it("returns failed when seed content fails validation", () => {
    const { store } = makeMemoryStore();
    __setSettingsStoreForTests(store);

    const warnings: string[] = [];
    const fakeLog = { info: () => {}, warn: (msg: string) => warnings.push(msg) };

    const badLoader: SeedLoader = { load: () => [{ fileKind: "bogus" }] };
    const result = bootstrapDataEnginePipelinesSeed(badLoader, fakeLog);
    assert.equal(result.action, "failed");
    assert.match(warnings[0], /validation/);
  });
});
