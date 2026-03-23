import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { assetSchema, errorEnvelopeSchema, workflowJobSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { getS3Config, createS3Client, tagS3Object } from "../storage/s3-client.js";
import { CATALOG_TAGS } from "../integrations/vast-catalog.js";

interface IngestPayload {
  title: string;
  sourceUri: string;
  // Optional — provided by ScannerFunction (VAST DataEngine trigger)
  shotId?: string;
  projectId?: string;
  versionLabel?: string;
  fileSizeBytes?: number;
  md5Checksum?: string;
  createdBy?: string;
}

function inferMediaTypeFromExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    exr: "image", dpx: "image", tiff: "image", tif: "image", png: "image", jpg: "image", jpeg: "image", hdr: "image",
    mov: "video", mp4: "video", mxf: "video", avi: "video", mkv: "video", r3d: "video",
    wav: "audio", aif: "audio", aiff: "audio", mp3: "audio", flac: "audio",
    abc: "3d", usd: "3d", usda: "3d", usdc: "3d", usdz: "3d", fbx: "3d", obj: "3d",
    mtlx: "material", osl: "material",
    otio: "editorial", edl: "editorial",
    nk: "comp", hip: "fx", ma: "scene",
  };
  return map[ext] ?? "other";
}

const ingestBodySchema = {
  type: "object",
  required: ["title", "sourceUri"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    sourceUri: { type: "string", minLength: 1 },
    shotId: { type: "string" },
    projectId: { type: "string" },
    versionLabel: { type: "string" },
    fileSizeBytes: { type: "number" },
    md5Checksum: { type: "string" },
    createdBy: { type: "string" }
  }
} as const;

const ingestResponseSchema = {
  type: "object",
  required: ["asset", "job"],
  properties: {
    asset: assetSchema,
    job: workflowJobSchema
  }
} as const;

export async function registerIngestRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const routePath = withPrefix(prefix, "/assets/ingest");
    app.post<{ Body: IngestPayload }>(
      routePath,
      {
        attachValidation: true,
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1IngestAsset" : "legacyIngestAsset",
          summary: "Register a media asset for ingest",
          body: ingestBodySchema,
          response: {
            201: ingestResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            500: errorEnvelopeSchema
          },
          ...(prefix === "/api/v1" ? { security: [{ ApiKeyAuth: [] as string[] }] } : {})
        }
      },
      async (request, reply) => {
        const title = request.body?.title?.trim();
        const sourceUri = request.body?.sourceUri?.trim();

        if (!title || !sourceUri) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "title and sourceUri are required", {
            fields: ["title", "sourceUri"]
          });
        }

        const result = await persistence.createIngestAsset(
          {
            title,
            sourceUri,
            shotId: request.body?.shotId,
            projectId: request.body?.projectId,
            versionLabel: request.body?.versionLabel,
            fileSizeBytes: request.body?.fileSizeBytes,
            md5Checksum: request.body?.md5Checksum,
            createdBy: request.body?.createdBy ?? request.identity ?? undefined,
          },
          { correlationId: resolveCorrelationId(request) }
        );

        // C.10: Write S3 tags for VAST Catalog integration (best-effort, non-blocking)
        const s3Config = getS3Config();
        if (s3Config && sourceUri) {
          try {
            const s3Client = createS3Client(s3Config);
            // Extract the S3 key from the sourceUri
            const s3Key = sourceUri.replace(/^vast:\/\/[^/]+\//, "").replace(/^s3:\/\/[^/]+\//, "");
            if (s3Key && s3Key !== sourceUri) {
              const inferredMediaType = inferMediaTypeFromExt(title);
              const tags: Record<string, string> = {
                [CATALOG_TAGS.assetId]: result.asset.id,
                [CATALOG_TAGS.ingestTimestamp]: new Date().toISOString(),
              };
              if (request.body?.projectId) tags[CATALOG_TAGS.projectId] = request.body.projectId;
              if (inferredMediaType) tags[CATALOG_TAGS.mediaType] = inferredMediaType;
              tags[CATALOG_TAGS.pipelineStage] = "ingested";

              await tagS3Object(s3Client, s3Config.bucket, s3Key, tags);
            }
          } catch (err) {
            // S3 tagging is best-effort — log but don't fail the ingest
            request.log?.warn?.({ err }, "Failed to write S3 tags for VAST Catalog");
          }
        }

        return reply.status(201).send(result);
      }
    );
  }
}
