import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { S3Client } from "@aws-sdk/client-s3";

import { fetchSidecar, type SidecarFetchConfig } from "../src/storage/sidecar-fetcher.js";

const SMALL_CONFIG: SidecarFetchConfig = { maxBodyBytes: 1024 };

// Minimal fake S3 client that records received commands and replays a
// scripted response. Mirrors the shape the fetcher needs, not the whole SDK.
function fakeS3(responder: (input: unknown) => Promise<unknown> | unknown): S3Client {
  return {
    send: async (cmd: unknown) => responder(cmd),
  } as unknown as S3Client;
}

function streamFromBytes(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () { yield bytes; })();
}

describe("fetchSidecar", () => {
  it("returns parsed JSON on a successful GET", async () => {
    const payload = { schema_version: "1.0.0", metadata: { video_codec: "prores" } };
    const s3 = fakeS3(async () => ({
      Body: streamFromBytes(new TextEncoder().encode(JSON.stringify(payload))),
    }));
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.deepEqual(result.data, payload);
      assert.ok(result.bytes > 0);
    }
  });

  it("returns not-found when S3 throws NoSuchKey", async () => {
    const s3 = fakeS3(async () => {
      const err = new Error("not found") as Error & { name: string };
      err.name = "NoSuchKey";
      throw err;
    });
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "not-found");
  });

  it("returns not-found when S3 throws a 404 metadata envelope", async () => {
    const s3 = fakeS3(async () => {
      const err = new Error("404") as Error & { $metadata: { httpStatusCode: number } };
      (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
      throw err;
    });
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "not-found");
  });

  it("returns too-large when body exceeds the cap", async () => {
    const big = new Uint8Array(SMALL_CONFIG.maxBodyBytes + 32);
    big.fill(65); // 'A'
    const s3 = fakeS3(async () => ({ Body: streamFromBytes(big) }));
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "too-large");
    if (result.kind === "too-large") {
      assert.equal(result.limit, SMALL_CONFIG.maxBodyBytes);
    }
  });

  it("returns invalid-json on unparseable body", async () => {
    const s3 = fakeS3(async () => ({
      Body: streamFromBytes(new TextEncoder().encode("not json at all")),
    }));
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "invalid-json");
  });

  it("returns invalid-json when body is a JSON array (sidecars must be objects)", async () => {
    const s3 = fakeS3(async () => ({
      Body: streamFromBytes(new TextEncoder().encode("[1,2,3]")),
    }));
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "invalid-json");
  });

  it("returns error on generic infrastructure failures", async () => {
    const s3 = fakeS3(async () => { throw new Error("connection reset"); });
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.match(result.error.message, /connection reset/);
    }
  });

  it("returns error when S3 response has no body", async () => {
    const s3 = fakeS3(async () => ({ Body: undefined }));
    const result = await fetchSidecar(s3, "b", "k", SMALL_CONFIG);
    assert.equal(result.kind, "error");
  });
});
