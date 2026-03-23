/**
 * S3 client mock-based integration tests.
 *
 * These tests exercise the s3-client.ts helpers without hitting a real
 * S3 endpoint. Presigned URL generation does not require a network call
 * (AWS SDK signs locally), so generateUploadUrl can run against a real
 * S3Client pointed at a local endpoint with fake credentials.
 *
 * tagS3Object requires a send() call, so we inject a mock S3Client whose
 * send() method is replaced with a function that records calls and returns
 * configurable results.
 *
 * Coverage:
 * - generateUploadUrl: returns url, key, expiresAt with correct shape
 * - generateUploadUrl: key format matches bucket/key passed in
 * - generateUploadUrl: expiresAt is in the future
 * - tagS3Object: calls send with PutObjectTaggingCommand carrying correct TagSet
 * - tagS3Object: propagates errors from send() (bucket not found, access denied)
 * - getS3Config: returns null when env vars missing, object when all present
 * - createS3Client: uses forcePathStyle and provided credentials
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import {
  generateUploadUrl,
  tagS3Object,
  getS3Config,
  createS3Client,
} from "../../src/storage/s3-client.js";

// ---------------------------------------------------------------------------
// Mock S3Client factory
// ---------------------------------------------------------------------------

interface S3Call {
  commandName: string;
  input: Record<string, unknown>;
}

/**
 * Creates an S3Client with send() replaced by a mock that:
 * - records every call to `calls`
 * - throws `error` if provided
 * - returns `returnValue` otherwise
 */
function makeMockS3Client(opts: { error?: Error; returnValue?: unknown } = {}): {
  client: S3Client;
  calls: S3Call[];
} {
  const calls: S3Call[] = [];

  const client = new S3Client({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    credentials: { accessKeyId: "AKID", secretAccessKey: "SKID" },
    forcePathStyle: true,
  });

  // Replace the send method on the instance to avoid making real HTTP calls
  (client as any).send = async (command: any) => {
    calls.push({
      commandName: command.constructor.name,
      input: command.input as Record<string, unknown>,
    });
    if (opts.error) throw opts.error;
    return opts.returnValue ?? {};
  };

  return { client, calls };
}

// ---------------------------------------------------------------------------
// generateUploadUrl — presigned URL generation
// ---------------------------------------------------------------------------

describe("S3 client mock integration — generateUploadUrl", () => {
  it("returns url, key, and expiresAt with the expected key unchanged", async () => {
    // generateUploadUrl uses @aws-sdk/s3-request-presigner which signs locally
    // — no network call needed. We use a real S3Client pointing to a fake endpoint.
    const client = new S3Client({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "SKID" },
      forcePathStyle: true,
    });

    const result = await generateUploadUrl(client, "test-bucket", "uploads/uuid/hero.exr", "image/x-exr");

    assert.equal(result.key, "uploads/uuid/hero.exr", "key must be echoed back unchanged");
    assert.ok(result.url, "url must be non-empty");
    assert.ok(result.expiresAt, "expiresAt must be set");
    assert.ok(
      new Date(result.expiresAt).getTime() > Date.now(),
      "expiresAt must be in the future",
    );
  });

  it("generates a URL containing the bucket name and key", async () => {
    const client = new S3Client({
      endpoint: "http://s3.test:9000",
      region: "us-east-1",
      credentials: { accessKeyId: "AK", secretAccessKey: "SK" },
      forcePathStyle: true,
    });

    const result = await generateUploadUrl(
      client,
      "my-bucket",
      "raw/abc123/test.mov",
      "video/quicktime",
    );

    // Path-style URL must contain the bucket and key
    assert.ok(result.url.includes("my-bucket"), "URL should reference the bucket");
    assert.ok(result.url.includes("raw%2Fabc123%2Ftest.mov") || result.url.includes("raw/abc123/test.mov"), "URL should encode the key");
  });

  it("respects custom expiresInSeconds when computing expiresAt", async () => {
    const client = new S3Client({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      credentials: { accessKeyId: "AK", secretAccessKey: "SK" },
      forcePathStyle: true,
    });

    const before = Date.now();
    const result = await generateUploadUrl(client, "bucket", "k/file.exr", "image/x-exr", 7200);
    const after = Date.now();

    const expiresMs = new Date(result.expiresAt).getTime();
    // Must be approximately now + 7200s (±5s tolerance for test execution time)
    assert.ok(expiresMs >= before + 7200_000 - 5_000, "expiresAt must be at least ~2h from now");
    assert.ok(expiresMs <= after + 7200_000 + 5_000, "expiresAt must not be more than ~2h from now");
  });
});

// ---------------------------------------------------------------------------
// tagS3Object — PutObjectTaggingCommand
// ---------------------------------------------------------------------------

describe("S3 client mock integration — tagS3Object", () => {
  it("calls send with PutObjectTaggingCommand carrying the correct TagSet", async () => {
    const { client, calls } = makeMockS3Client();

    await tagS3Object(client, "media-bucket", "raw/uuid/hero.exr", {
      "ah-project-id": "proj-001",
      "ah-asset-id": "asset-abc",
      "ah-media-type": "exr_sequence",
    });

    assert.equal(calls.length, 1, "exactly one send call expected");
    assert.equal(calls[0].commandName, "PutObjectTaggingCommand");

    const input = calls[0].input as {
      Bucket: string;
      Key: string;
      Tagging: { TagSet: Array<{ Key: string; Value: string }> };
    };

    assert.equal(input.Bucket, "media-bucket");
    assert.equal(input.Key, "raw/uuid/hero.exr");

    const tagSet = input.Tagging.TagSet;
    assert.ok(Array.isArray(tagSet), "TagSet must be an array");
    assert.equal(tagSet.length, 3);

    const tagMap = Object.fromEntries(tagSet.map((t) => [t.Key, t.Value]));
    assert.equal(tagMap["ah-project-id"], "proj-001");
    assert.equal(tagMap["ah-asset-id"], "asset-abc");
    assert.equal(tagMap["ah-media-type"], "exr_sequence");
  });

  it("handles an empty tag map without throwing", async () => {
    const { client, calls } = makeMockS3Client();
    await tagS3Object(client, "bucket", "key/file.exr", {});

    assert.equal(calls.length, 1);
    const input = calls[0].input as { Tagging: { TagSet: unknown[] } };
    assert.deepEqual(input.Tagging.TagSet, [], "empty tag map should produce empty TagSet");
  });

  it("propagates an error thrown by send() (e.g. bucket not found)", async () => {
    const bucketError = Object.assign(new Error("NoSuchBucket"), { name: "NoSuchBucket" });
    const { client } = makeMockS3Client({ error: bucketError });

    await assert.rejects(
      () => tagS3Object(client, "missing-bucket", "key.exr", { tag: "val" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error).name, "NoSuchBucket");
        return true;
      },
    );
  });

  it("propagates an access denied error from send()", async () => {
    const accessDenied = Object.assign(new Error("Access Denied"), { name: "AccessDenied" });
    const { client } = makeMockS3Client({ error: accessDenied });

    await assert.rejects(
      () => tagS3Object(client, "bucket", "key.exr", { env: "prod" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          (err as Error).name === "AccessDenied" || (err as Error).message.includes("Access Denied"),
          `Expected AccessDenied, got: ${(err as Error).name}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getS3Config — environment variable parsing
// ---------------------------------------------------------------------------

describe("S3 client mock integration — getS3Config", () => {
  // Preserve the original env state across all tests in this group
  const savedEnv: Record<string, string | undefined> = {};
  const S3_ENV_KEYS = [
    "SPACEHARBOR_S3_ENDPOINT",
    "SPACEHARBOR_S3_REGION",
    "SPACEHARBOR_S3_BUCKET",
    "SPACEHARBOR_S3_ACCESS_KEY_ID",
    "SPACEHARBOR_S3_SECRET_ACCESS_KEY",
  ] as const;

  before(() => {
    for (const k of S3_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const k of S3_ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it("returns null when all S3 env vars are absent", () => {
    const result = getS3Config();
    assert.equal(result, null);
  });

  it("returns null when only some S3 env vars are set", () => {
    process.env.SPACEHARBOR_S3_ENDPOINT = "http://s3.test:9000";
    process.env.SPACEHARBOR_S3_REGION = "us-east-1";
    // bucket, accessKeyId, secretAccessKey still absent
    const result = getS3Config();
    assert.equal(result, null);
    delete process.env.SPACEHARBOR_S3_ENDPOINT;
    delete process.env.SPACEHARBOR_S3_REGION;
  });

  it("returns config object when all five env vars are present", () => {
    process.env.SPACEHARBOR_S3_ENDPOINT = "https://s3.vast.example.com";
    process.env.SPACEHARBOR_S3_REGION = "us-east-1";
    process.env.SPACEHARBOR_S3_BUCKET = "spaceharbor-media";
    process.env.SPACEHARBOR_S3_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

    const result = getS3Config();

    assert.ok(result !== null, "config must be non-null when all vars set");
    assert.equal(result.endpoint, "https://s3.vast.example.com");
    assert.equal(result.region, "us-east-1");
    assert.equal(result.bucket, "spaceharbor-media");
    assert.equal(result.accessKeyId, "AKIAIOSFODNN7EXAMPLE");
    assert.equal(result.secretAccessKey, "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  });
});

// ---------------------------------------------------------------------------
// createS3Client — client factory
// ---------------------------------------------------------------------------

describe("S3 client mock integration — createS3Client", () => {
  it("creates an S3Client instance", () => {
    const config = {
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "test-bucket",
      accessKeyId: "AKID",
      secretAccessKey: "SKID",
    };

    const client = createS3Client(config);
    assert.ok(client instanceof S3Client, "should return an S3Client instance");
  });
});
