import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { uploadUrlRequestSchema, uploadUrlResponseSchema, errorEnvelopeSchema } from "../http/schemas.js";
import { getS3Config, createS3Client, generateUploadUrl } from "../storage/s3-client.js";

interface UploadUrlBody {
  filename: string;
  contentType?: string;
  prefix?: string;
}

const ALLOWED_EXTENSIONS = new Set([
  // Image/Texture
  ".exr", ".dpx", ".tiff", ".tif", ".png", ".jpg", ".jpeg", ".hdr", ".tx", ".tex", ".psd",
  // Video
  ".mov", ".mp4", ".mxf", ".avi", ".mkv", ".webm",
  // Raw Camera
  ".r3d", ".cr3", ".cr2", ".arw", ".nef", ".dng",
  // Audio
  ".wav", ".aif", ".aiff", ".mp3", ".flac", ".ogg",
  // 3D/Scene
  ".abc", ".usd", ".usda", ".usdc", ".usdz", ".fbx", ".obj", ".gltf", ".glb", ".vdb",
  // Material/Shader
  ".mtlx", ".osl", ".oso",
  // VFX Scripts
  ".nk", ".hip", ".ma", ".mb",
  // Editorial
  ".otio", ".edl", ".xml", ".aaf",
  // LUT/Color
  ".cube", ".3dl", ".csp", ".lut",
  // Document
  ".pdf", ".doc", ".docx", ".ai",
  // Archive
  ".zip", ".tar", ".gz",
  // Metadata
  ".json", ".yaml", ".yml",
]);

const PREFIX_PATTERN = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export async function registerUploadRoute(
  app: FastifyInstance,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.post<{ Body: UploadUrlBody }>(
      withPrefix(prefix, "/assets/upload-url"),
      {
        attachValidation: true,
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1GenerateUploadUrl" : "legacyGenerateUploadUrl",
          summary: "Generate a presigned URL for asset upload",
          body: uploadUrlRequestSchema,
          response: {
            201: uploadUrlResponseSchema,
            400: errorEnvelopeSchema,
            503: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const filename = request.body?.filename?.trim();
        if (!filename) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "filename is required");
        }

        // --- Filename path traversal validation ---
        if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "invalid filename: must not contain path separators");
        }

        // --- File extension validation ---
        const ext = path.extname(filename).toLowerCase();
        if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", `file type not allowed: ${ext || "(none)"}`);
        }

        const config = getS3Config();
        if (!config) {
          return sendError(
            request,
            reply,
            503,
            "S3_NOT_CONFIGURED",
            "S3 storage is not configured. Set SPACEHARBOR_S3_* environment variables."
          );
        }

        const contentType = request.body?.contentType ?? "application/octet-stream";
        const prefixParam = request.body?.prefix ?? "uploads";

        // --- Prefix path traversal validation ---
        if (!PREFIX_PATTERN.test(prefixParam)) {
          return sendError(
            request,
            reply,
            400,
            "VALIDATION_ERROR",
            "invalid prefix: must contain only alphanumeric, underscore, hyphen, and forward slash characters"
          );
        }

        const uuid = crypto.randomUUID();
        const storageKey = `${prefixParam}/${uuid}/${filename}`;

        const client = createS3Client(config);
        const result = await generateUploadUrl(client, config.bucket, storageKey, contentType);

        return reply.status(201).send({
          uploadUrl: result.url,
          storageKey: result.key,
          expiresAt: result.expiresAt,
        });
      }
    );
  }
}
