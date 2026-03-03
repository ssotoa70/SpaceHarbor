export const workflowStatusEnum = ["pending", "processing", "completed", "failed", "needs_replay", "qc_pending", "qc_in_review", "qc_approved", "qc_rejected"] as const;

export const errorEnvelopeSchema = {
  type: "object",
  required: ["code", "message", "requestId", "details"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    requestId: { type: "string" },
    details: {
      anyOf: [
        {
          type: "object",
          additionalProperties: true
        },
        {
          type: "null"
        }
      ]
    }
  }
} as const;

export const assetSchema = {
  type: "object",
  required: ["id", "title", "sourceUri", "createdAt"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    sourceUri: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    metadata: {
      type: "object",
      properties: {
        codec: { type: "string" },
        resolution: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } }
        },
        frame_range: {
          type: "object",
          properties: { start: { type: "number" }, end: { type: "number" } }
        },
        frame_rate: { type: "number" },
        pixel_aspect_ratio: { type: "number" },
        display_window: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }
        },
        data_window: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }
        },
        compression_type: { type: "string" },
        channels: { type: "array", items: { type: "string" } },
        color_space: { type: "string" },
        bit_depth: { type: "number" },
        file_size_bytes: { type: "number" },
        md5_checksum: { type: "string" }
      }
    },
    version: {
      type: "object",
      properties: {
        version_label: { type: "string" },
        parent_version_id: { type: "string" }
      }
    },
    integrity: {
      type: "object",
      properties: {
        file_size_bytes: { type: "number" },
        checksum: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["md5", "xxhash"] },
            value: { type: "string" }
          }
        },
        verified_at: { type: "string", format: "date-time" }
      }
    }
  }
} as const;

export const workflowJobSchema = {
  type: "object",
  required: [
    "id",
    "assetId",
    "status",
    "createdAt",
    "updatedAt",
    "lastError",
    "attemptCount",
    "maxAttempts",
    "nextAttemptAt",
    "leaseOwner",
    "leaseExpiresAt"
  ],
  properties: {
    id: { type: "string" },
    assetId: { type: "string" },
    status: { type: "string", enum: [...workflowStatusEnum] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    lastError: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    attemptCount: { type: "number" },
    maxAttempts: { type: "number" },
    nextAttemptAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    },
    leaseOwner: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    leaseExpiresAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;
