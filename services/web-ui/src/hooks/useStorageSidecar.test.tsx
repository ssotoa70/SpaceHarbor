import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import {
  useStorageSidecar,
  __resetSidecarCacheForTests,
  __setSidecarCacheTtlForTests,
} from "./useStorageSidecar";

const makeResponse = (uri: string): api.StorageMetadataResponse => ({
  schema_version: "1.0.0",
  file_kind: "video",
  source_uri: uri,
  sidecar_key: ".proxies/shot_metadata.json",
  bucket: "bucket",
  bytes: 123,
  data: { metadata: { video_codec: "prores", source: uri } },
});

interface HookResult {
  sidecar: api.StorageMetadataResponse | null;
  loading: boolean;
  error: api.ApiRequestError | null;
}

function HookHarness({ sourceUri, onUpdate }: { sourceUri: string; onUpdate: (r: HookResult) => void }) {
  const result = useStorageSidecar(sourceUri);
  onUpdate(result);
  return null;
}

describe("useStorageSidecar", () => {
  beforeEach(() => {
    __resetSidecarCacheForTests();
    __setSidecarCacheTtlForTests(60_000);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches the sidecar and exposes it", async () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(
      makeResponse("s3://bucket/shot.mov"),
    );
    let last: HookResult = { sidecar: null, loading: false, error: null };
    render(<HookHarness sourceUri="s3://bucket/shot.mov" onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.sidecar).not.toBeNull());
    expect(last.sidecar?.source_uri).toBe("s3://bucket/shot.mov");
    expect(last.loading).toBe(false);
    expect(last.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when sourceUri is empty", () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(null);
    let last: HookResult = { sidecar: null, loading: false, error: null };
    render(<HookHarness sourceUri="" onUpdate={(r) => { last = r; }} />);
    expect(spy).not.toHaveBeenCalled();
    expect(last.sidecar).toBeNull();
    expect(last.loading).toBe(false);
  });

  it("does not fetch when file kind has no extractor (pdf)", () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(null);
    let last: HookResult = { sidecar: null, loading: false, error: null };
    render(<HookHarness sourceUri="s3://bucket/notes.pdf" onUpdate={(r) => { last = r; }} />);
    expect(spy).not.toHaveBeenCalled();
    expect(last.loading).toBe(false);
  });

  it("fetches for image file kinds (EXR via frame-metadata-extractor)", async () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(
      makeResponse("s3://bucket/shot.0042.exr"),
    );
    let last: HookResult = { sidecar: null, loading: false, error: null };
    render(<HookHarness sourceUri="s3://bucket/shot.0042.exr" onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.sidecar).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("caches and returns the same sidecar across rerenders without re-fetching", async () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(
      makeResponse("s3://bucket/a.mov"),
    );
    let last: HookResult = { sidecar: null, loading: false, error: null };
    const { rerender } = render(
      <HookHarness sourceUri="s3://bucket/a.mov" onUpdate={(r) => { last = r; }} />,
    );
    await waitFor(() => expect(last.sidecar).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);

    rerender(<HookHarness sourceUri="s3://bucket/a.mov" onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.sidecar?.source_uri).toBe("s3://bucket/a.mov"));
    // Still one fetch — hit the cache.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expiry on a fresh mount", async () => {
    __setSidecarCacheTtlForTests(0); // expire immediately
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(
      makeResponse("s3://bucket/a.mov"),
    );
    let last: HookResult = { sidecar: null, loading: false, error: null };
    const first = render(
      <HookHarness sourceUri="s3://bucket/a.mov" onUpdate={(r) => { last = r; }} />,
    );
    await waitFor(() => expect(last.sidecar).not.toBeNull());
    first.unmount();

    render(<HookHarness sourceUri="s3://bucket/a.mov" onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("dedupes concurrent fetches for the same sourceUri", async () => {
    let resolver: (v: api.StorageMetadataResponse | null) => void = () => {};
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; }),
    );
    render(<HookHarness sourceUri="s3://bucket/dedupe.mov" onUpdate={() => {}} />);
    render(<HookHarness sourceUri="s3://bucket/dedupe.mov" onUpdate={() => {}} />);
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolver(makeResponse("s3://bucket/dedupe.mov"));
    });
  });

  it("exposes error on non-2xx that the api throws", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockRejectedValue(new api.ApiRequestError(503));
    let last: HookResult = { sidecar: null, loading: false, error: null };
    render(<HookHarness sourceUri="s3://bucket/boom.mov" onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.error).not.toBeNull());
    expect(last.error?.status).toBe(503);
    expect(last.sidecar).toBeNull();
  });

  it("cancels in-flight fetch on unmount (no state update after unmount)", async () => {
    let resolver: (v: api.StorageMetadataResponse | null) => void = () => {};
    vi.spyOn(api, "fetchStorageMetadata").mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; }),
    );
    const { unmount } = render(<HookHarness sourceUri="s3://bucket/cancel.mov" onUpdate={() => {}} />);
    unmount();
    // Resolve after unmount — should not crash or warn.
    await act(async () => {
      resolver(makeResponse("s3://bucket/cancel.mov"));
    });
  });
});
