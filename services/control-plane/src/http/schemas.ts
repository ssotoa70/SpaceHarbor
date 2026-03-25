// ---------------------------------------------------------------------------
// Platform Settings schemas
// ---------------------------------------------------------------------------

export const s3EndpointConfigSchema = {
  type: "object",
  required: ["id", "label", "endpoint", "bucket", "accessKeyId", "region", "useSsl", "pathStyle"],
  properties: {
    id: { type: "string" },
    label: { type: "string", description: "Human-readable label (e.g. 'Production Media')" },
    endpoint: { type: "string", description: "S3-compatible endpoint URL" },
    bucket: { type: "string" },
    accessKeyId: { type: "string", description: "VAST S3 access key ID" },
    region: { type: "string", description: "Signature region (e.g. us-east-1)" },
    useSsl: { type: "boolean", description: "Use HTTPS" },
    pathStyle: { type: "boolean", description: "Path-style addressing (required for VAST)" },
    // secretAccessKey is accepted on write but NEVER included in response schemas
  },
} as const;

/**
 * Write-only variant of s3EndpointConfigSchema used in the PUT body.
 * Accepts the optional secretAccessKey field on inbound writes.
 */
export const s3EndpointConfigWriteSchema = {
  type: "object",
  required: ["id", "label", "endpoint", "bucket", "accessKeyId", "region", "useSsl", "pathStyle"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    endpoint: { type: "string" },
    bucket: { type: "string" },
    accessKeyId: { type: "string" },
    secretAccessKey: { type: "string", description: "Write-only. Never returned in GET responses." },
    region: { type: "string" },
    useSsl: { type: "boolean" },
    pathStyle: { type: "boolean" },
  },
} as const;

export const platformSettingsResponseSchema = {
  type: "object",
  required: ["vastDatabase", "vastEventBroker", "vastDataEngine", "authentication", "storage", "scim"],
  properties: {
    vastDatabase: {
      type: "object",
      required: ["configured", "endpoint", "status", "tablesDeployed"],
      properties: {
        configured: { type: "boolean" },
        endpoint: { anyOf: [{ type: "string" }, { type: "null" }] },
        status: { type: "string", enum: ["connected", "disconnected", "error"] },
        tablesDeployed: { type: "boolean" },
        // Operational fields — present in response when set, never masked
        vmsVip: { anyOf: [{ type: "string" }, { type: "null" }] },
        cnodeVips: { anyOf: [{ type: "string" }, { type: "null" }] },
        accessKeyId: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    vastEventBroker: {
      type: "object",
      required: ["configured", "brokerUrl", "topic", "status"],
      properties: {
        configured: { type: "boolean" },
        brokerUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
        topic: { anyOf: [{ type: "string" }, { type: "null" }] },
        status: { type: "string", enum: ["connected", "disconnected", "not_configured"] },
      },
    },
    vastDataEngine: {
      type: "object",
      required: ["configured", "url", "status"],
      properties: {
        configured: { type: "boolean" },
        url: { anyOf: [{ type: "string" }, { type: "null" }] },
        status: { type: "string", enum: ["connected", "disconnected", "not_configured"] },
        // tenant is operational config, not a secret
        tenant: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    authentication: {
      type: "object",
      required: ["mode", "iamEnabled", "shadowMode", "rolloutRing"],
      properties: {
        mode: { type: "string", enum: ["local", "oidc"] },
        oidcIssuer: { anyOf: [{ type: "string" }, { type: "null" }] },
        jwksUri: { anyOf: [{ type: "string" }, { type: "null" }] },
        iamEnabled: { type: "boolean" },
        shadowMode: { type: "boolean" },
        rolloutRing: { type: "string" },
      },
    },
    storage: {
      type: "object",
      required: ["configured"],
      properties: {
        s3Endpoint: { anyOf: [{ type: "string" }, { type: "null" }] },
        s3Bucket: { anyOf: [{ type: "string" }, { type: "null" }] },
        configured: { type: "boolean" },
        // secretAccessKey is intentionally ABSENT from this response schema
        endpoints: { type: "array", items: s3EndpointConfigSchema },
        nfsConnectors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              exportPath: { type: "string" },
              mountPoint: { type: "string" },
              version: { type: "string" },
              options: { type: "string" },
            },
          },
        },
        smbConnectors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              sharePath: { type: "string" },
              mountPoint: { type: "string" },
              domain: { type: "string" },
              username: { type: "string" },
              // password is intentionally ABSENT (write-only)
            },
          },
        },
      },
    },
    scim: {
      type: "object",
      required: ["configured", "enabled"],
      properties: {
        configured: { type: "boolean" },
        enabled: { type: "boolean" },
      },
    },
    ldap: {
      type: "object",
      properties: {
        configured: { type: "boolean" },
        enabled: { type: "boolean" },
        host: { type: "string" },
        port: { type: "number" },
        baseDn: { type: "string" },
        bindDn: { type: "string" },
        useTls: { type: "boolean" },
        userSearchFilter: { type: "string" },
        groupSearchBase: { type: "string" },
        groupSearchFilter: { type: "string" },
        syncIntervalMinutes: { type: "number" },
        // bindPassword intentionally ABSENT (write-only)
      },
    },
  },
} as const;

export const savePlatformSettingsBodySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    vastDatabase: {
      type: "object",
      properties: {
        endpoint: { anyOf: [{ type: "string" }, { type: "null" }] },
        vmsVip: { anyOf: [{ type: "string" }, { type: "null" }] },
        cnodeVips: { anyOf: [{ type: "string" }, { type: "null" }] },
        accessKeyId: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    vastEventBroker: {
      type: "object",
      properties: {
        brokerUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
        topic: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    vastDataEngine: {
      type: "object",
      properties: {
        url: { anyOf: [{ type: "string" }, { type: "null" }] },
        tenant: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    storage: {
      type: "object",
      additionalProperties: true,
      properties: {
        s3Endpoint: { anyOf: [{ type: "string" }, { type: "null" }] },
        s3Bucket: { anyOf: [{ type: "string" }, { type: "null" }] },
        // endpoints use the write schema which allows secretAccessKey
        endpoints: { type: "array", items: s3EndpointConfigWriteSchema },
        nfsConnectors: { type: "array" },
        smbConnectors: { type: "array" },
      },
    },
  },
} as const;

export const connectionTestRequestSchema = {
  type: "object",
  required: ["service"],
  properties: {
    service: {
      type: "string",
      description: "Service identifier to test. Use 's3:{endpointId}' to test a specific S3 endpoint.",
    },
  },
} as const;

export const connectionTestResponseSchema = {
  type: "object",
  required: ["service", "status", "message"],
  properties: {
    service: { type: "string" },
    status: { type: "string", enum: ["ok", "error"] },
    message: { type: "string" },
  },
} as const;

export const schemaDeployResponseSchema = {
  type: "object",
  required: ["status", "migrationsApplied", "message"],
  properties: {
    status: { type: "string", enum: ["ok", "error"] },
    migrationsApplied: { type: "number" },
    message: { type: "string" },
  },
} as const;

export const schemaStatusResponseSchema = {
  type: "object",
  required: ["currentVersion", "availableMigrations", "upToDate", "pending"],
  properties: {
    currentVersion: { type: "number" },
    availableMigrations: { type: "number" },
    upToDate: { type: "boolean" },
    pending: {
      type: "array",
      items: {
        type: "object",
        required: ["version", "description"],
        properties: {
          version: { type: "number" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Workflow Status & Error Envelope
// ---------------------------------------------------------------------------

export const workflowStatusEnum = [
  "pending",
  "processing",
  "completed",
  "failed",
  "needs_replay",
  "qc_pending",
  "qc_in_review",
  "qc_approved",
  "qc_rejected",
  "revision_required",
  "retake",
  "client_submitted",
  "client_approved",
  "client_rejected"
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
    createdAt: { type: "string", format: "date-time" },
    // Optional VFX hierarchy context — populated when ingested via ScannerFunction
    shotId: { type: "string" },
    projectId: { type: "string" },
    versionLabel: { type: "string" }
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

export const handoffChecklistSchema = {
  type: "object",
  required: ["releaseNotesReady", "verificationComplete", "commsDraftReady", "ownerAssigned"],
  properties: {
    releaseNotesReady: { type: "boolean" },
    verificationComplete: { type: "boolean" },
    commsDraftReady: { type: "boolean" },
    ownerAssigned: { type: "boolean" }
  }
} as const;

export const handoffSchema = {
  type: "object",
  required: ["status", "owner", "lastUpdatedAt"],
  properties: {
    status: { type: "string", enum: ["not_ready", "ready_for_release"] },
    owner: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    lastUpdatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    }
  }
} as const;

export const productionMetadataSchema = {
  type: "object",
  required: ["show", "episode", "sequence", "shot", "version", "vendor", "priority", "dueDate", "owner"],
  properties: {
    show: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    episode: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    sequence: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    shot: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    version: {
      anyOf: [{ type: "number" }, { type: "null" }]
    },
    vendor: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    priority: {
      anyOf: [
        { type: "string", enum: ["low", "normal", "high", "urgent"] },
        { type: "null" }
      ]
    },
    dueDate: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    },
    owner: {
      anyOf: [{ type: "string" }, { type: "null" }]
    }
  }
} as const;

export const assetQueueRowSchema = {
  type: "object",
  required: [
    "id",
    "jobId",
    "title",
    "sourceUri",
    "status",
    "thumbnail",
    "proxy",
    "annotationHook",
    "handoffChecklist",
    "handoff",
    "productionMetadata"
  ],
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
    annotationHook: annotationHookSchema,
    handoffChecklist: handoffChecklistSchema,
    handoff: handoffSchema,
    productionMetadata: productionMetadataSchema
  }
} as const;

export const assetsResponseSchema = {
  type: "object",
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      items: assetQueueRowSchema
    },
    pagination: {
      type: "object",
      properties: {
        total: { type: "number" },
        limit: { type: "number" },
        offset: { type: "number" }
      }
    }
  }
} as const;

export const workflowJobSchema = {
  type: "object",
  required: [
    "id",
    "assetId",
    "sourceUri",
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
    "annotationHook",
    "handoffChecklist",
    "handoff"
  ],
  properties: {
    id: { type: "string" },
    assetId: { type: "string" },
    sourceUri: { type: "string" },
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
    annotationHook: annotationHookSchema,
    handoffChecklist: handoffChecklistSchema,
    handoff: handoffSchema
  }
} as const;

export const assetDetailResponseSchema = {
  type: "object",
  required: ["id", "title", "sourceUri", "createdAt"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    sourceUri: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    },
    metadata: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
    },
    version: {
      anyOf: [
        {
          type: "object",
          properties: {
            version_label: { type: "string" },
            parent_version_id: { type: "string" }
          }
        },
        { type: "null" }
      ]
    },
    integrity: {
      anyOf: [
        {
          type: "object",
          properties: {
            file_size_bytes: { type: "number" },
            checksum: {
              type: "object",
              properties: {
                type: { type: "string" },
                value: { type: "string" }
              }
            },
            verified_at: { type: "string", format: "date-time" }
          }
        },
        { type: "null" }
      ]
    },
    review_uri: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    shotId: { type: "string" },
    projectId: { type: "string" },
    versionLabel: { type: "string" },
    currentVersionId: { type: "string" }
  }
} as const;

export const uploadUrlRequestSchema = {
  type: "object",
  required: ["filename"],
  additionalProperties: false,
  properties: {
    filename: { type: "string", minLength: 1 },
    contentType: { type: "string" },
    prefix: { type: "string" }
  }
} as const;

export const uploadUrlResponseSchema = {
  type: "object",
  required: ["uploadUrl", "storageKey", "expiresAt"],
  properties: {
    uploadUrl: { type: "string" },
    storageKey: { type: "string" },
    expiresAt: { type: "string", format: "date-time" }
  }
} as const;

export const auditSignalSchema = {
  type: "object",
  required: ["type", "code", "severity"],
  properties: {
    type: { type: "string", enum: ["fallback"] },
    code: { type: "string", enum: ["VAST_FALLBACK"] },
    severity: { type: "string", enum: ["warning", "critical"] }
  }
} as const;

export const auditEventSchema = {
  type: "object",
  required: ["id", "message", "at", "signal"],
  properties: {
    id: { type: "string" },
    message: { type: "string" },
    at: { type: "string", format: "date-time" },
    signal: {
      anyOf: [auditSignalSchema, { type: "null" }]
    }
  }
} as const;

export const auditEventsResponseSchema = {
  type: "object",
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: auditEventSchema
    }
  }
} as const;

// ---------------------------------------------------------------------------
// Review Sessions
// ---------------------------------------------------------------------------

export const reviewSessionStatusEnum = ["open", "in_progress", "closed"] as const;
export const reviewSessionTypeEnum = ["dailies", "client_review", "final"] as const;
export const submissionStatusEnum = ["pending", "in_review", "approved", "rejected", "revision_required"] as const;

export const reviewSessionSchema = {
  type: "object",
  required: ["id", "projectId", "sessionDate", "sessionType", "status", "createdAt"],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    department: { anyOf: [{ type: "string" }, { type: "null" }] },
    sessionDate: { type: "string", format: "date" },
    sessionType: { type: "string", enum: [...reviewSessionTypeEnum] },
    supervisorId: { anyOf: [{ type: "string" }, { type: "null" }] },
    status: { type: "string", enum: [...reviewSessionStatusEnum] },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const reviewSessionSubmissionSchema = {
  type: "object",
  required: ["id", "sessionId", "assetId", "submissionOrder", "status", "submittedAt"],
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    assetId: { type: "string" },
    versionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    submissionOrder: { type: "number" },
    status: { type: "string", enum: [...submissionStatusEnum] },
    submittedAt: { type: "string", format: "date-time" }
  }
} as const;

export const reviewSessionWithSubmissionsSchema = {
  type: "object",
  required: ["session", "submissions"],
  properties: {
    session: reviewSessionSchema,
    submissions: {
      type: "array",
      items: reviewSessionSubmissionSchema
    }
  }
} as const;

export const reviewSessionsResponseSchema = {
  type: "object",
  required: ["sessions"],
  properties: {
    sessions: {
      type: "array",
      items: reviewSessionSchema
    }
  }
} as const;

export const createReviewSessionBodySchema = {
  type: "object",
  required: ["projectId", "sessionDate", "sessionType"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 },
    department: { type: "string" },
    sessionDate: { type: "string", format: "date" },
    sessionType: { type: "string", enum: [...reviewSessionTypeEnum] },
    supervisorId: { type: "string" }
  }
} as const;

export const addSubmissionBodySchema = {
  type: "object",
  required: ["assetId"],
  additionalProperties: false,
  properties: {
    assetId: { type: "string", minLength: 1 },
    versionId: { type: "string" },
    submissionOrder: { type: "number" }
  }
} as const;

// ---------------------------------------------------------------------------
// Review Comment schemas (Phase B)
// ---------------------------------------------------------------------------

const commentStatusEnum = ["open", "resolved", "archived"] as const;
const annotationTypeEnum = ["text", "drawing", "arrow", "rect", "circle"] as const;

export const reviewCommentSchema = {
  type: "object",
  required: ["id", "authorId", "body", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    sessionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    submissionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    versionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    parentCommentId: { anyOf: [{ type: "string" }, { type: "null" }] },
    authorId: { type: "string" },
    authorRole: { anyOf: [{ type: "string" }, { type: "null" }] },
    body: { type: "string" },
    frameNumber: { anyOf: [{ type: "number" }, { type: "null" }] },
    timecode: { anyOf: [{ type: "string" }, { type: "null" }] },
    annotationType: { anyOf: [{ type: "string", enum: [...annotationTypeEnum] }, { type: "null" }] },
    status: { type: "string", enum: [...commentStatusEnum] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

export const reviewCommentsResponseSchema = {
  type: "object",
  required: ["comments"],
  properties: {
    comments: { type: "array", items: reviewCommentSchema }
  }
} as const;

export const createReviewCommentBodySchema = {
  type: "object",
  required: ["authorId", "body"],
  additionalProperties: false,
  properties: {
    sessionId: { type: "string" },
    submissionId: { type: "string" },
    versionId: { type: "string" },
    parentCommentId: { type: "string" },
    authorId: { type: "string", minLength: 1 },
    authorRole: { type: "string" },
    body: { type: "string", minLength: 1, maxLength: 4000 },
    frameNumber: { type: "number" },
    timecode: { type: "string", maxLength: 32 },
    annotationType: { type: "string", enum: [...annotationTypeEnum] }
  }
} as const;

export const resolveCommentResponseSchema = {
  type: "object",
  required: ["comment"],
  properties: {
    comment: reviewCommentSchema
  }
} as const;

// ---------------------------------------------------------------------------
// Version Comparison schemas (Phase B)
// ---------------------------------------------------------------------------

export const versionComparisonSchema = {
  type: "object",
  required: ["id", "versionAId", "versionBId", "comparisonType", "resolutionMatch", "colorspaceMatch", "createdAt", "createdBy"],
  properties: {
    id: { type: "string" },
    versionAId: { type: "string" },
    versionBId: { type: "string" },
    comparisonType: { type: "string", enum: ["flip", "wipe", "overlay", "pixel_diff"] },
    diffMetadata: { anyOf: [{ type: "string" }, { type: "null" }] },
    pixelDiffPercentage: { anyOf: [{ type: "number" }, { type: "null" }] },
    frameDiffCount: { anyOf: [{ type: "number" }, { type: "null" }] },
    resolutionMatch: { type: "boolean" },
    colorspaceMatch: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    createdBy: { type: "string" }
  }
} as const;

export const versionComparisonsResponseSchema = {
  type: "object",
  required: ["comparisons"],
  properties: {
    comparisons: { type: "array", items: versionComparisonSchema }
  }
} as const;

export const createVersionComparisonBodySchema = {
  type: "object",
  required: ["comparisonType", "resolutionMatch", "colorspaceMatch", "createdBy"],
  additionalProperties: false,
  properties: {
    comparisonType: { type: "string", enum: ["flip", "wipe", "overlay", "pixel_diff"] },
    diffMetadata: { type: "string", maxLength: 8000 },
    pixelDiffPercentage: { type: "number", minimum: 0, maximum: 100 },
    frameDiffCount: { type: "number", minimum: 0 },
    resolutionMatch: { type: "boolean" },
    colorspaceMatch: { type: "boolean" },
    createdBy: { type: "string", minLength: 1 }
  }
} as const;

// ---------------------------------------------------------------------------
// Asset Provenance & Lineage schemas (Phase C)
// ---------------------------------------------------------------------------

const lineageRelationshipTypeEnum = ["parent", "derived_from", "referenced_by", "retake_of"] as const;

export const assetProvenanceSchema = {
  type: "object",
  required: ["id", "versionId", "createdAt"],
  properties: {
    id: { type: "string" },
    versionId: { type: "string" },
    creator: { anyOf: [{ type: "string" }, { type: "null" }] },
    softwareUsed: { anyOf: [{ type: "string" }, { type: "null" }] },
    softwareVersion: { anyOf: [{ type: "string" }, { type: "null" }] },
    renderJobId: { anyOf: [{ type: "string" }, { type: "null" }] },
    pipelineStage: { anyOf: [{ type: "string" }, { type: "null" }] },
    vastStoragePath: { anyOf: [{ type: "string" }, { type: "null" }] },
    vastElementHandle: { anyOf: [{ type: "string" }, { type: "null" }] },
    sourceHost: { anyOf: [{ type: "string" }, { type: "null" }] },
    sourceProcessId: { anyOf: [{ type: "string" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const provenanceResponseSchema = {
  type: "object",
  required: ["provenance"],
  properties: {
    provenance: { type: "array", items: assetProvenanceSchema }
  }
} as const;

export const createProvenanceBodySchema = {
  type: "object",
  required: [],
  additionalProperties: false,
  properties: {
    creator: { type: "string", maxLength: 255 },
    softwareUsed: { type: "string", maxLength: 255 },
    softwareVersion: { type: "string", maxLength: 100 },
    renderJobId: { type: "string", maxLength: 255 },
    pipelineStage: { type: "string", maxLength: 100 },
    vastStoragePath: { type: "string", maxLength: 1024 },
    vastElementHandle: { type: "string", maxLength: 255 },
    sourceHost: { type: "string", maxLength: 255 },
    sourceProcessId: { type: "string", maxLength: 100 }
  }
} as const;

export const versionLineageSchema = {
  type: "object",
  required: ["id", "ancestorVersionId", "descendantVersionId", "relationshipType", "depth", "createdAt"],
  properties: {
    id: { type: "string" },
    ancestorVersionId: { type: "string" },
    descendantVersionId: { type: "string" },
    relationshipType: { type: "string", enum: [...lineageRelationshipTypeEnum] },
    depth: { type: "number" },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const lineageResponseSchema = {
  type: "object",
  required: ["lineage"],
  properties: {
    lineage: { type: "array", items: versionLineageSchema }
  }
} as const;

export const versionTreeResponseSchema = {
  type: "object",
  required: ["tree"],
  properties: {
    tree: { type: "array", items: versionLineageSchema }
  }
} as const;

// ---------------------------------------------------------------------------
// Asset Lineage DAG schemas (Phase C.3)
// ---------------------------------------------------------------------------

const lineageChangeTypeEnum = ["new_frames", "compression_change", "color_space_change", "full_re_render", "alternate_take"] as const;
const lineageEdgeTypeEnum = ["derives", "depends"] as const;

export const versionNodeSchema = {
  type: "object",
  required: ["id", "versionLabel", "status", "createdAt", "createdBy"],
  properties: {
    id: { type: "string" },
    versionLabel: { type: "string" },
    status: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    createdBy: { type: "string" },
    branchLabel: { anyOf: [{ type: "string" }, { type: "null" }] },
    colorSpace: { anyOf: [{ type: "string" }, { type: "null" }] },
    compressionType: { anyOf: [{ type: "string" }, { type: "null" }] },
    frameRangeStart: { anyOf: [{ type: "number" }, { type: "null" }] },
    frameRangeEnd: { anyOf: [{ type: "number" }, { type: "null" }] }
  }
} as const;

export const versionEdgeSchema = {
  type: "object",
  required: ["sourceId", "targetId", "changeType", "edgeType"],
  properties: {
    sourceId: { type: "string" },
    targetId: { type: "string" },
    changeType: { type: "string", enum: [...lineageChangeTypeEnum] },
    edgeType: { type: "string", enum: [...lineageEdgeTypeEnum] }
  }
} as const;

export const assetLineageDAGResponseSchema = {
  type: "object",
  required: ["nodes", "edges"],
  properties: {
    nodes: { type: "array", items: versionNodeSchema },
    edges: { type: "array", items: versionEdgeSchema }
  }
} as const;

// ---------------------------------------------------------------------------
// Collection schemas (Phase B.6)
// ---------------------------------------------------------------------------

export const collectionSchema = {
  type: "object",
  required: ["id", "projectId", "name", "collectionType", "ownerId", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    collectionType: { type: "string", enum: ["playlist", "selection", "deliverable"] },
    ownerId: { type: "string" },
    status: { type: "string", enum: ["active", "archived"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

export const collectionItemSchema = {
  type: "object",
  required: ["id", "collectionId", "entityType", "entityId", "sortOrder", "addedBy", "addedAt"],
  properties: {
    id: { type: "string" },
    collectionId: { type: "string" },
    entityType: { type: "string", enum: ["asset", "version", "shot", "material"] },
    entityId: { type: "string" },
    sortOrder: { type: "number" },
    addedBy: { type: "string" },
    addedAt: { type: "string", format: "date-time" },
    notes: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
} as const;

export const createCollectionBodySchema = {
  type: "object",
  required: ["name", "collectionType", "ownerId"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 255 },
    description: { type: "string", maxLength: 2000 },
    collectionType: { type: "string", enum: ["playlist", "selection", "deliverable"] },
    ownerId: { type: "string", minLength: 1 }
  }
} as const;

export const addCollectionItemBodySchema = {
  type: "object",
  required: ["entityType", "entityId", "addedBy"],
  properties: {
    entityType: { type: "string", enum: ["asset", "version", "shot", "material"] },
    entityId: { type: "string", minLength: 1 },
    sortOrder: { type: "number" },
    addedBy: { type: "string", minLength: 1 },
    notes: { type: "string", maxLength: 2000 }
  }
} as const;

export const collectionsResponseSchema = {
  type: "object",
  required: ["collections"],
  properties: {
    collections: { type: "array", items: collectionSchema }
  }
} as const;

export const collectionItemsResponseSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: collectionItemSchema }
  }
} as const;

// ---------------------------------------------------------------------------
// Playlist / Dailies schemas (Phase B.7)
// ---------------------------------------------------------------------------

export const playlistSchema = {
  type: "object",
  required: ["id", "projectId", "name", "createdBy", "sessionDate", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    createdBy: { type: "string" },
    sessionDate: { type: "string" },
    status: { type: "string", enum: ["active", "archived"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

export const playlistItemSchema = {
  type: "object",
  required: ["id", "playlistId", "shotId", "versionId", "sortOrder", "addedBy", "addedAt"],
  properties: {
    id: { type: "string" },
    playlistId: { type: "string" },
    shotId: { type: "string" },
    versionId: { type: "string" },
    sortOrder: { type: "number" },
    notes: { anyOf: [{ type: "string" }, { type: "null" }] },
    decision: { anyOf: [{ type: "string", enum: ["approve", "reject", "hold"] }, { type: "null" }] },
    decidedBy: { anyOf: [{ type: "string" }, { type: "null" }] },
    decidedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
    addedBy: { type: "string" },
    addedAt: { type: "string", format: "date-time" }
  }
} as const;

export const createPlaylistBodySchema = {
  type: "object",
  required: ["name", "createdBy", "sessionDate"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 255 },
    description: { type: "string", maxLength: 2000 },
    createdBy: { type: "string", minLength: 1 },
    sessionDate: { type: "string", minLength: 1 }
  }
} as const;

export const addPlaylistItemBodySchema = {
  type: "object",
  required: ["shotId", "versionId", "addedBy"],
  properties: {
    shotId: { type: "string", minLength: 1 },
    versionId: { type: "string", minLength: 1 },
    sortOrder: { type: "number" },
    addedBy: { type: "string", minLength: 1 },
    notes: { type: "string", maxLength: 2000 }
  }
} as const;

export const updatePlaylistItemsBodySchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          sortOrder: { type: "number" },
          notes: { type: "string", maxLength: 2000 }
        }
      }
    }
  }
} as const;

export const updatePlaylistItemDecisionBodySchema = {
  type: "object",
  required: ["decision", "decidedBy"],
  properties: {
    decision: { type: "string", enum: ["approve", "reject", "hold"] },
    decidedBy: { type: "string", minLength: 1 }
  }
} as const;

export const playlistsResponseSchema = {
  type: "object",
  required: ["playlists"],
  properties: {
    playlists: { type: "array", items: playlistSchema }
  }
} as const;

export const playlistItemsResponseSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: playlistItemSchema }
  }
} as const;

export const dailiesReportEntrySchema = {
  type: "object",
  required: ["shotId", "versionId", "commentCount"],
  properties: {
    shotId: { type: "string" },
    shotCode: { anyOf: [{ type: "string" }, { type: "null" }] },
    versionId: { type: "string" },
    versionLabel: { anyOf: [{ type: "string" }, { type: "null" }] },
    decision: { anyOf: [{ type: "string", enum: ["approve", "reject", "hold"] }, { type: "null" }] },
    decidedBy: { anyOf: [{ type: "string" }, { type: "null" }] },
    notes: { anyOf: [{ type: "string" }, { type: "null" }] },
    commentCount: { type: "number" }
  }
} as const;

export const dailiesReportResponseSchema = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: { type: "array", items: dailiesReportEntrySchema }
  }
} as const;
