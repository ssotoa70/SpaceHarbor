import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, fetchStorageMetadata } from "./api";

describe("fetchStorageMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed response on 200", async () => {
    const payload = {
      schema_version: "1.0.0",
      file_kind: "video",
      source_uri: "s3://bucket/shot.mov",
      sidecar_key: ".proxies/shot_metadata.json",
      bucket: "bucket",
      bytes: 3247,
      data: { metadata: { video_codec: "prores" } },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStorageMetadata("s3://bucket/shot.mov");
    expect(result).toEqual(payload);

    // URL-encoded sourceUri
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("/api/v1/storage/metadata");
    expect(url).toContain("sourceUri=s3%3A%2F%2Fbucket%2Fshot.mov");
  });

  it("returns null on 404 (sidecar not ready)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 } as Response)));
    expect(await fetchStorageMetadata("s3://bucket/shot.mov")).toBeNull();
  });

  it("returns null on 415 (file kind not supported)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 415 } as Response)));
    expect(await fetchStorageMetadata("s3://bucket/notes.pdf")).toBeNull();
  });

  it("returns null on 400 (malformed sourceUri — callers shouldn't crash)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400 } as Response)));
    expect(await fetchStorageMetadata("")).toBeNull();
  });

  it("throws ApiRequestError on 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 } as Response)));
    const err = await fetchStorageMetadata("s3://bucket/shot.mov").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(503);
  });

  it("throws ApiRequestError on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const err = await fetchStorageMetadata("s3://bucket/shot.mov").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
  });

  it("forwards the AbortSignal to fetch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      schema_version: "1.0.0", file_kind: "video", source_uri: "x", sidecar_key: "x",
      bucket: "b", bytes: 0, data: {},
    }) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await fetchStorageMetadata("s3://bucket/shot.mov", { signal: controller.signal });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBe(controller.signal);
  });
});
