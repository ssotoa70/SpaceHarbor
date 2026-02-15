const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("nightly reliability workflow runs smoke harness and uploads artifacts", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "nightly-reliability-smoke.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:/);
  assert.match(workflow, /timeout-minutes:\s*20/);
  assert.match(workflow, /docker compose up -d --build/);
  assert.match(workflow, /\/health/);
  assert.match(workflow, /\/api\/v1\/metrics/);
  assert.match(workflow, /node tests\/reliability\/run-smoke\.mjs/);
  assert.match(workflow, /actions\/upload-artifact/);
});
