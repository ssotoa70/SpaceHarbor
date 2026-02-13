export const workflowStatusEnum = ["pending", "processing", "completed", "failed", "needs_replay"] as const;

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
