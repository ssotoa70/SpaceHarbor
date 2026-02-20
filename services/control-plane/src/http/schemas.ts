export const workflowStatusEnum = [
  "pending",
  "processing",
  "completed",
  "failed",
  "needs_replay",
  "qc_pending",
  "qc_in_review",
  "qc_approved",
  "qc_rejected"
] as const;

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
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const thumbnailSchema = {
  anyOf: [
    {
      type: "object",
      required: ["uri", "width", "height", "generatedAt"],
      properties: {
        uri: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        generatedAt: { type: "string", format: "date-time" }
      }
    },
    { type: "null" }
  ]
} as const;

export const proxySchema = {
  anyOf: [
    {
      type: "object",
      required: ["uri", "durationSeconds", "codec", "generatedAt"],
      properties: {
        uri: { type: "string" },
        durationSeconds: { type: "number" },
        codec: { type: "string" },
        generatedAt: { type: "string", format: "date-time" }
      }
    },
    { type: "null" }
  ]
} as const;

export const annotationHookSchema = {
  type: "object",
  required: ["enabled", "provider", "contextId"],
  properties: {
    enabled: { type: "boolean" },
    provider: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    contextId: {
      anyOf: [{ type: "string" }, { type: "null" }]
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
    "leaseExpiresAt",
    "thumbnail",
    "proxy",
    "annotationHook"
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
    },
    thumbnail: thumbnailSchema,
    proxy: proxySchema,
    annotationHook: annotationHookSchema
  }
} as const;

export const assetQueueRowSchema = {
  type: "object",
  required: ["id", "jobId", "title", "sourceUri", "status", "thumbnail", "proxy", "annotationHook"],
  properties: {
    id: { type: "string" },
    jobId: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    title: { type: "string" },
    sourceUri: { type: "string" },
    status: { type: "string", enum: [...workflowStatusEnum] },
    thumbnail: thumbnailSchema,
    proxy: proxySchema,
    annotationHook: annotationHookSchema
  }
} as const;
