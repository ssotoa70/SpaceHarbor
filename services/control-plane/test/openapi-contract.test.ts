import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("GET /openapi.json returns OpenAPI document with critical workflow paths", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.openapi, "string");
  assert.equal(body.openapi.startsWith("3."), true);

  const requiredPaths = [
    "/api/v1/assets",
    "/api/v1/assets/ingest",
    "/api/v1/events",
    "/api/v1/audit",
    "/api/v1/queue/claim",
    "/api/v1/jobs/{id}/heartbeat",
    "/api/v1/jobs/{id}/replay",
    "/api/v1/incident/coordination",
    "/api/v1/incident/coordination/actions",
    "/api/v1/incident/coordination/notes",
    "/api/v1/incident/coordination/handoff"
  ];

  for (const path of requiredPaths) {
    assert.ok(body.paths[path], `missing path in OpenAPI doc: ${path}`);
  }

  await app.close();
});

test("OpenAPI includes explicit /api/v1/audit schema metadata", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const operation = body.paths?.["/api/v1/audit"]?.get;
  assert.ok(operation, "missing GET /api/v1/audit operation");
  assert.equal(operation.operationId, "v1ListAuditEvents");
  assert.equal(operation.tags.includes("audit"), true);

  const eventSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.events?.items;
  assert.ok(eventSchema, "missing audit event schema");
  assert.deepEqual(eventSchema.required, ["id", "message", "at", "signal"]);
  assert.deepEqual(eventSchema.properties?.signal?.anyOf?.[0]?.required, ["type", "code", "severity"]);

  await app.close();
});

test("OpenAPI includes explicit /api/v1/assets schema metadata with production metadata", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const operation = body.paths?.["/api/v1/assets"]?.get;
  assert.ok(operation, "missing GET /api/v1/assets operation");
  assert.equal(operation.operationId, "v1ListAssets");
  assert.equal(operation.tags.includes("assets"), true);

  const itemSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.assets?.items;
  assert.ok(itemSchema, "missing assets item schema");
  assert.deepEqual(itemSchema.required, [
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
  ]);

  const productionMetadataSchema = itemSchema.properties?.productionMetadata;
  assert.ok(productionMetadataSchema, "missing productionMetadata schema");
  assert.deepEqual(productionMetadataSchema.required, ["show", "episode", "sequence", "shot", "version", "vendor", "priority", "dueDate", "owner"]);
  assert.deepEqual(productionMetadataSchema.properties?.priority?.anyOf?.[0]?.enum, ["low", "normal", "high", "urgent"]);

  await app.close();
});

test("GET /docs is available in non-production mode", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/docs"
  });

  assert.notEqual(response.statusCode, 404);

  await app.close();

  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("OpenAPI critical workflow operations expose stable operation metadata", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const criticalOperations = [
    { path: "/api/v1/assets/ingest", method: "post", expectedStatus: "201", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/events", method: "post", expectedStatus: "202", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/queue/claim", method: "post", expectedStatus: "200", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/jobs/{id}/heartbeat", method: "post", expectedStatus: "200", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/jobs/{id}/replay", method: "post", expectedStatus: "202", requiresBody: false, requiresSecurity: true },
    { path: "/api/v1/incident/coordination", method: "get", expectedStatus: "200", requiresBody: false, requiresSecurity: false },
    { path: "/api/v1/incident/coordination/actions", method: "put", expectedStatus: "200", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/incident/coordination/notes", method: "post", expectedStatus: "201", requiresBody: true, requiresSecurity: true },
    { path: "/api/v1/incident/coordination/handoff", method: "put", expectedStatus: "200", requiresBody: true, requiresSecurity: true }
  ] as const;

  for (const operationConfig of criticalOperations) {
    const operation = body.paths?.[operationConfig.path]?.[operationConfig.method];
    assert.ok(operation, `missing operation ${operationConfig.method.toUpperCase()} ${operationConfig.path}`);

    assert.equal(typeof operation.operationId, "string", `missing operationId for ${operationConfig.path}`);
    assert.equal(operation.operationId.length > 0, true, `empty operationId for ${operationConfig.path}`);

    assert.ok(operation.responses?.[operationConfig.expectedStatus], `missing ${operationConfig.expectedStatus} response for ${operationConfig.path}`);

    if (operationConfig.requiresSecurity) {
      assert.ok(operation.security, `missing security declaration for ${operationConfig.path}`);
      assert.deepEqual(operation.security, [{ ApiKeyAuth: [] }], `unexpected security for ${operationConfig.path}`);
    } else {
      assert.equal(operation.security, undefined, `unexpected security declaration for ${operationConfig.path}`);
    }

    if (operationConfig.requiresBody) {
      assert.equal(operation.requestBody?.required, true, `requestBody is not required for ${operationConfig.path}`);
    }
  }

  await app.close();
});

test("OpenAPI workflow operations keep tags, parameter docs, and error envelope consistency", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const workflowOperations = [
    {
      path: "/api/v1/assets/ingest",
      method: "post",
      expectedTag: "assets",
      errorStatuses: ["400", "401", "403"]
    },
    {
      path: "/api/v1/events",
      method: "post",
      expectedTag: "events",
      errorStatuses: ["400", "401", "403", "404"]
    },
    {
      path: "/api/v1/queue/claim",
      method: "post",
      expectedTag: "workflow",
      errorStatuses: ["400", "401", "403"]
    },
    {
      path: "/api/v1/jobs/{id}/heartbeat",
      method: "post",
      expectedTag: "workflow",
      errorStatuses: ["400", "401", "403", "404"]
    },
    {
      path: "/api/v1/jobs/{id}/replay",
      method: "post",
      expectedTag: "workflow",
      errorStatuses: ["401", "403", "404"]
    },
    {
      path: "/api/v1/incident/coordination",
      method: "get",
      expectedTag: "operations",
      errorStatuses: []
    },
    {
      path: "/api/v1/incident/coordination/actions",
      method: "put",
      expectedTag: "operations",
      errorStatuses: ["400", "401", "403", "409"]
    },
    {
      path: "/api/v1/incident/coordination/notes",
      method: "post",
      expectedTag: "operations",
      errorStatuses: ["400", "401", "403"]
    },
    {
      path: "/api/v1/incident/coordination/handoff",
      method: "put",
      expectedTag: "operations",
      errorStatuses: ["400", "401", "403", "409"]
    }
  ] as const;

  for (const operationConfig of workflowOperations) {
    const operation = body.paths?.[operationConfig.path]?.[operationConfig.method];
    assert.ok(operation, `missing operation ${operationConfig.method.toUpperCase()} ${operationConfig.path}`);

    assert.ok(Array.isArray(operation.tags), `missing tags for ${operationConfig.path}`);
    assert.ok(operation.tags.includes(operationConfig.expectedTag), `missing expected tag for ${operationConfig.path}`);

    if (operationConfig.path.includes("{id}")) {
      const idParameter = operation.parameters?.find((parameter: { name?: string }) => parameter.name === "id");
      assert.ok(idParameter, `missing id parameter for ${operationConfig.path}`);
      assert.equal(idParameter.required, true, `id parameter should be required for ${operationConfig.path}`);
      assert.equal(typeof idParameter.description, "string", `missing id parameter description for ${operationConfig.path}`);
      assert.equal(idParameter.description.length > 0, true, `empty id parameter description for ${operationConfig.path}`);
    }

    for (const status of operationConfig.errorStatuses) {
      const errorResponse = operation.responses?.[status];
      assert.ok(errorResponse, `missing ${status} response for ${operationConfig.path}`);

      const requiredFields = errorResponse.content?.["application/json"]?.schema?.required;
      assert.ok(Array.isArray(requiredFields), `missing required fields in ${status} response for ${operationConfig.path}`);
      assert.deepEqual([...requiredFields].sort(), ["code", "details", "message", "requestId"], `unexpected error envelope in ${status} response for ${operationConfig.path}`);
    }
  }

  await app.close();
});

test("OpenAPI exposes additive review/QC statuses and event types", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const queueStatusEnum =
    body.paths?.["/api/v1/jobs/{id}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.status?.
      enum ?? [];

  for (const status of ["qc_pending", "qc_in_review", "qc_approved", "qc_rejected"]) {
    assert.ok(queueStatusEnum.includes(status), `missing workflow status enum in OpenAPI: ${status}`);
  }

  const eventTypeEnum = body.paths?.["/api/v1/events"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties
    ?.eventType?.enum ?? [];

  for (const eventType of [
    "asset.review.qc_pending",
    "asset.review.in_review",
    "asset.review.approved",
    "asset.review.rejected",
    "asset.review.annotation_created",
    "asset.review.annotation_resolved",
    "asset.review.task_linked",
    "asset.review.submission_created",
    "asset.review.decision_recorded",
    "asset.review.decision_overridden"
  ]) {
    assert.ok(eventTypeEnum.includes(eventType), `missing event type enum in OpenAPI: ${eventType}`);
  }

  const eventDataSchemaProperties =
    body.paths?.["/api/v1/events"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.data?.properties ?? {};

  for (const fieldName of [
    "projectId",
    "shotId",
    "reviewId",
    "submissionId",
    "versionId",
    "actorId",
    "actorRole",
    "annotationId",
    "taskId",
    "taskSystem",
    "decision",
    "decisionReasonCode",
    "priorDecisionEventId",
    "overrideReasonCode"
  ]) {
    assert.ok(eventDataSchemaProperties[fieldName], `missing event data field in OpenAPI schema: ${fieldName}`);
  }

  assert.deepEqual(eventDataSchemaProperties.actorRole.enum, ["artist", "coordinator", "supervisor", "producer"]);
  assert.deepEqual(eventDataSchemaProperties.decision.enum, ["approved", "changes_requested", "rejected"]);

  const assetRowSchemaProperties =
    body.paths?.["/api/v1/assets"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.assets?.items
      ?.properties;
  assert.ok(assetRowSchemaProperties?.thumbnail, "missing thumbnail schema in assets response");
  assert.ok(assetRowSchemaProperties?.proxy, "missing proxy schema in assets response");
  assert.ok(assetRowSchemaProperties?.annotationHook, "missing annotationHook schema in assets response");
  assert.ok(assetRowSchemaProperties?.handoffChecklist, "missing handoffChecklist schema in assets response");
  assert.ok(assetRowSchemaProperties?.handoff, "missing handoff schema in assets response");

  const jobSchemaProperties =
    body.paths?.["/api/v1/jobs/{id}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties;
  assert.ok(jobSchemaProperties?.thumbnail, "missing thumbnail schema in jobs response");
  assert.ok(jobSchemaProperties?.proxy, "missing proxy schema in jobs response");
  assert.ok(jobSchemaProperties?.annotationHook, "missing annotationHook schema in jobs response");
  assert.ok(jobSchemaProperties?.handoffChecklist, "missing handoffChecklist schema in jobs response");
  assert.ok(jobSchemaProperties?.handoff, "missing handoff schema in jobs response");

  await app.close();
});
