const DEFAULT_BASE_URL = "http://localhost:8080";

async function requestJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, init);
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    body
  };
}

async function runScenario(name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const details = await fn();
    return {
      name,
      passed: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      details
    };
  } catch (error) {
    return {
      name,
      passed: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function scenarioHealthCheck({ baseUrl, fetchImpl }) {
  const result = await requestJson(fetchImpl, `${baseUrl}/health`);
  if (result.status !== 200) {
    throw new Error(`health check failed with status ${result.status}`);
  }

  return `health status ${result.status}`;
}

async function scenarioIngestClaim({ baseUrl, fetchImpl }) {
  const ingest = await requestJson(fetchImpl, `${baseUrl}/api/v1/assets/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title: `reliability-smoke-${Date.now()}`,
      sourceUri: "s3://bucket/reliability-smoke.mov"
    })
  });

  if (ingest.status !== 201 || !ingest.body?.job?.id) {
    throw new Error(`ingest failed with status ${ingest.status}`);
  }

  const claim = await requestJson(fetchImpl, `${baseUrl}/api/v1/queue/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workerId: "reliability-smoke-worker",
      leaseSeconds: 30
    })
  });

  if (claim.status !== 200 || claim.body?.job?.status !== "processing") {
    throw new Error(`claim failed with status ${claim.status}`);
  }

  return `ingest+claim ok for job ${ingest.body.job.id}`;
}

async function scenarioDuplicateEventIdempotency({ baseUrl, fetchImpl }) {
  const ingest = await requestJson(fetchImpl, `${baseUrl}/api/v1/assets/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title: `reliability-idempotency-${Date.now()}`,
      sourceUri: "s3://bucket/reliability-idempotency.mov"
    })
  });

  if (ingest.status !== 201 || !ingest.body?.asset?.id || !ingest.body?.job?.id) {
    throw new Error(`idempotency setup failed with status ${ingest.status}`);
  }

  const payload = {
    eventId: "evt-smoke-1",
    eventType: "asset.processing.started",
    eventVersion: "1.0",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-reliability-smoke-1",
    producer: "reliability-harness",
    data: {
      assetId: ingest.body.asset.id,
      jobId: ingest.body.job.id
    }
  };

  const first = await requestJson(fetchImpl, `${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const second = await requestJson(fetchImpl, `${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (first.status !== 202 || first.body?.duplicate !== false) {
    throw new Error(`first event did not apply as expected (status ${first.status})`);
  }

  if (second.status !== 202 || second.body?.duplicate !== true) {
    throw new Error(`second duplicate event did not no-op as expected (status ${second.status})`);
  }

  return "duplicate event no-op verified";
}

async function runReliabilitySmoke(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.ASSETHARBOR_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const startedAt = new Date().toISOString();
  const scenarios = [];

  scenarios.push(await runScenario("health-check", () => scenarioHealthCheck({ baseUrl, fetchImpl })));
  scenarios.push(await runScenario("ingest-claim", () => scenarioIngestClaim({ baseUrl, fetchImpl })));
  scenarios.push(await runScenario("duplicate-event-idempotency", () => scenarioDuplicateEventIdempotency({ baseUrl, fetchImpl })));

  return {
    baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: scenarios.every((scenario) => scenario.passed),
    scenarios
  };
}

module.exports = {
  runReliabilitySmoke
};
