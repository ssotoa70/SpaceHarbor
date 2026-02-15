const test = require("node:test");
const assert = require("node:assert/strict");

const { runReliabilitySmoke } = require("./harness.js");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("runReliabilitySmoke returns passing summary for healthy scenario run", async () => {
  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    fetchCalls.push(`${method} ${url}`);

    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true }, 200);
    }

    if (url.endsWith("/api/v1/assets/ingest")) {
      return jsonResponse({
        asset: { id: "asset-1" },
        job: { id: "job-1", status: "pending" }
      }, 201);
    }

    if (url.endsWith("/api/v1/queue/claim")) {
      return jsonResponse({
        job: { id: "job-1", status: "processing" }
      }, 200);
    }

    if (url.endsWith("/api/v1/events")) {
      const payload = JSON.parse(init.body || "{}");
      return jsonResponse({ accepted: true, duplicate: payload.eventId === "evt-smoke-1" && fetchCalls.filter((x) => x === `POST ${url}`).length > 1 }, 202);
    }

    return jsonResponse({}, 404);
  };

  const result = await runReliabilitySmoke({
    baseUrl: "http://localhost:8080",
    fetchImpl
  });

  assert.equal(result.passed, true);
  assert.equal(Array.isArray(result.scenarios), true);
  assert.equal(result.scenarios.length, 3);
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.name),
    ["health-check", "ingest-claim", "duplicate-event-idempotency"]
  );
});

test("runReliabilitySmoke reports failed scenario details", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/health")) {
      return jsonResponse({ ok: false }, 503);
    }

    return jsonResponse({}, 200);
  };

  const result = await runReliabilitySmoke({
    baseUrl: "http://localhost:8080",
    fetchImpl
  });

  assert.equal(result.passed, false);
  const failed = result.scenarios.find((scenario) => !scenario.passed);
  assert.ok(failed);
  assert.equal(failed.name, "health-check");
  assert.match(failed.details, /503/);
});
