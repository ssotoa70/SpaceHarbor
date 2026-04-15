/**
 * Sidecar fetcher — S3 GET + JSON parse.
 *
 * Wraps the AWS S3 client with the small amount of defensive logic the
 * route handler needs:
 *
 *   - Max body size enforcement (configurable via env, default 2 MiB)
 *     so a misbehaving extractor can't blow up Node with a multi-GB read.
 *   - NoSuchKey → `{ kind: "not-found" }` instead of throwing, so routes
 *     can return a clean 404 without inspecting AWS error codes.
 *   - Invalid JSON → `{ kind: "invalid-json" }` so routes can return 502.
 *   - Infrastructure errors → `{ kind: "error", error }` so routes can
 *     log and return 503.
 *
 * The S3 client is injected, which means tests never touch real S3 and
 * all failure paths are covered.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export interface SidecarFetchConfig {
  /** Hard cap on bytes read from S3. Defaults to 2 MiB. */
  maxBodyBytes: number;
}

export const DEFAULT_SIDECAR_FETCH_CONFIG: SidecarFetchConfig = {
  maxBodyBytes: readMaxBodyBytes(),
};

function readMaxBodyBytes(): number {
  const envValue = process.env.SPACEHARBOR_SIDECAR_MAX_BYTES;
  if (!envValue) return 2 * 1024 * 1024;
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2 * 1024 * 1024;
  return parsed;
}

export type SidecarFetchResult =
  | { kind: "ok"; data: Record<string, unknown>; bytes: number }
  | { kind: "not-found" }
  | { kind: "too-large"; bytes: number; limit: number }
  | { kind: "invalid-json"; snippet: string }
  | { kind: "error"; error: Error };

interface ReadableStreamLike {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}

const NOT_FOUND_CODES = new Set(["NoSuchKey", "NotFound", "404"]);

/**
 * Fetch and parse a JSON sidecar from S3. Never throws — every outcome
 * is a tagged result. Callers can log + map to HTTP status codes.
 */
export async function fetchSidecar(
  s3: S3Client,
  bucket: string,
  key: string,
  config: SidecarFetchConfig = DEFAULT_SIDECAR_FETCH_CONFIG,
): Promise<SidecarFetchResult> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body;
    if (!body) {
      return { kind: "error", error: new Error("S3 GetObject returned empty body") };
    }
    const bytes = await readStreamBounded(body as unknown as ReadableStreamLike, config.maxBodyBytes);
    if (bytes === "too-large") {
      return { kind: "too-large", bytes: config.maxBodyBytes + 1, limit: config.maxBodyBytes };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          kind: "invalid-json",
          snippet: text.slice(0, 120),
        };
      }
      return { kind: "ok", data: parsed as Record<string, unknown>, bytes: bytes.byteLength };
    } catch {
      return { kind: "invalid-json", snippet: text.slice(0, 120) };
    }
  } catch (err) {
    if (isNotFoundError(err)) {
      return { kind: "not-found" };
    }
    return { kind: "error", error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const withName = err as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (typeof withName.name === "string" && NOT_FOUND_CODES.has(withName.name)) return true;
  if (typeof withName.Code === "string" && NOT_FOUND_CODES.has(withName.Code)) return true;
  if (withName.$metadata && withName.$metadata.httpStatusCode === 404) return true;
  return false;
}

async function readStreamBounded(
  stream: ReadableStreamLike,
  limit: number,
): Promise<Uint8Array | "too-large"> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > limit) return "too-large";
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
