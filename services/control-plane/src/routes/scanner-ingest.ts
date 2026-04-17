/**
 * Scanner ingest endpoint — receives normalized S3 ElementCreated events
 * forwarded from a VAST DataEngine scanner-function and runs the parse +
 * resolve + ingest pipeline that used to live in the Python function.
 *
 *   POST /api/v1/scanner/ingest
 *     Headers:
 *       X-Scanner-Signature: hex(hmac-sha256(secret, body))
 *     Body:
 *       { bucket: string, key: string, etag?: string, size?: number,
 *         actor?: string }
 *     Returns:
 *       200 { status: "ingested", assetId, jobId }
 *       200 { status: "skipped", reason }       (non-render path / unsupported ext)
 *       200 { status: "already_ingested", ... } (idempotent re-fire)
 *       401 { code: "BAD_SIGNATURE" }            (HMAC mismatch / missing secret)
 *       404 { code: "PROJECT_NOT_FOUND" }        (hierarchy resolver could not find project)
 *
 * Auth model: HMAC-only (added to app.ts public-route bypass list — same
 * pattern as inbound /webhooks/:id). Configure the shared secret via the
 * `SPACEHARBOR_SCANNER_SECRET` env var; if unset, the route returns 503
 * to make misconfiguration obvious instead of silently accepting events.
 *
 * Replaces (Phase 6 scanner thinning):
 *   - services/scanner-function/path_parser.py
 *   - services/scanner-function/hierarchy_resolver.py
 *   - services/scanner-function/ingest_client.py
 *   - services/scanner-function/trino_client.py
 * The Python function becomes a thin forwarder: extract S3 fields, sign,
 * POST here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { resolveCorrelationId } from "../http/correlation.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { parseRenderPath } from "../scanner/path-parser.js";
import {
  HierarchyNotFoundError,
  resolveHierarchy,
} from "../scanner/hierarchy-resolver.js";

interface ScannerIngestBody {
  bucket: string;
  key: string;
  etag?: string;
  size?: number;
  actor?: string;
}

const SIGNATURE_HEADER = "x-scanner-signature";

function verifySignature(secret: string, body: string, providedHex: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function registerScannerIngestRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    app.post<{ Body: ScannerIngestBody }>(
      withPrefix(prefix, "/scanner/ingest"),
      {
        // Body validation runs after we read the raw body for HMAC, so we
        // attach the parsed body via the standard Fastify pipeline. The
        // raw body for HMAC verification lives at request.rawBody when the
        // contentTypeParser is configured to keep it (see app.ts).
        schema: {
          tags: ["scanner"],
          operationId: `${op}ScannerIngest`,
          summary: "Receive a forwarded S3 ElementCreated event from the scanner-function",
          body: {
            type: "object",
            required: ["bucket", "key"],
            properties: {
              bucket: { type: "string", minLength: 1, maxLength: 255 },
              key:    { type: "string", minLength: 1, maxLength: 2048 },
              etag:   { type: "string", maxLength: 128 },
              size:   { type: "integer", minimum: 0 },
              actor:  { type: "string", maxLength: 255 },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                status: { type: "string" },
                assetId: { type: "string" },
                jobId: { type: "string" },
                reason: { type: "string" },
                key: { type: "string" },
              },
            },
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const secret = process.env.SPACEHARBOR_SCANNER_SECRET;
        if (!secret) {
          return sendError(request, reply, 503, "SCANNER_SECRET_NOT_CONFIGURED",
            "SPACEHARBOR_SCANNER_SECRET env var is not set on the control-plane");
        }
        const provided = request.headers[SIGNATURE_HEADER];
        if (typeof provided !== "string" || !provided) {
          return sendError(request, reply, 401, "MISSING_SIGNATURE", "X-Scanner-Signature header required");
        }
        // The JSON content-type parser stashes the exact request bytes on
        // request.rawBody (see app.ts) so we sign the same string the
        // Python forwarder hashed — no canonical-JSON gymnastics required.
        const rawBody = (request as unknown as { rawBody?: string | null }).rawBody;
        if (!rawBody) {
          return sendError(request, reply, 401, "BAD_SIGNATURE", "request body unavailable for signature verification");
        }
        if (!verifySignature(secret, rawBody, provided)) {
          return sendError(request, reply, 401, "BAD_SIGNATURE", "HMAC signature mismatch");
        }

        const parsed = parseRenderPath(request.body.key);
        if (!parsed) {
          return reply.status(200).send({
            status: "skipped",
            reason: "key does not match render path pattern or extension is not supported",
            key: request.body.key,
          });
        }

        const correlationId = resolveCorrelationId(request);
        let resolved;
        try {
          resolved = await resolveHierarchy(parsed, persistence, { correlationId });
        } catch (e) {
          if (e instanceof HierarchyNotFoundError) {
            return sendError(request, reply, 404, "PROJECT_NOT_FOUND", e.message);
          }
          throw e;
        }

        // Sentinel events represent the whole render directory; the parser
        // sets `filename` to the directory path. Otherwise we ingest the
        // single file with its actual S3 metadata.
        const sourceUri = parsed.isSentinel
          ? `s3://${request.body.bucket}/${parsed.filename}`
          : `s3://${request.body.bucket}/${request.body.key}`;
        const title = parsed.isSentinel
          ? parsed.filename.split("/").slice(-2).join("/")
          : parsed.filename;
        const fileSize  = parsed.isSentinel ? 0 : (request.body.size ?? 0);
        const checksum  = parsed.isSentinel ? "" : (request.body.etag ?? "");
        const createdBy = request.body.actor ?? "scanner";

        try {
          const result = await persistence.createIngestAsset(
            {
              title,
              sourceUri,
              shotId: resolved.shotId,
              projectId: resolved.projectId,
              versionLabel: resolved.versionLabel,
              fileSizeBytes: fileSize,
              md5Checksum: checksum,
              createdBy,
            },
            { correlationId },
          );
          return reply.status(200).send({
            status: "ingested",
            assetId: result.asset.id,
            jobId: result.job.id,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("already exists") || msg.includes("duplicate")) {
            return reply.status(200).send({
              status: "already_ingested",
              key: request.body.key,
              reason: msg,
            });
          }
          throw e;
        }
      },
    );
  }
}
