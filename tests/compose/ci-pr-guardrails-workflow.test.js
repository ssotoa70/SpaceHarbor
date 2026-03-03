const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("CI workflow enforces PR guardrails for stale/conflicted and oversized PRs", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "ci.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /PR guardrails/i);
  assert.match(workflow, /pull-requests:\s*read/i);
  assert.match(workflow, /github\.event_name == 'pull_request'/);
  assert.match(workflow, /node scripts\/ci\/pr-guardrails\.js/);
  assert.match(workflow, /PR_MAX_CHANGED_FILES/);
  assert.match(workflow, /PR_MAX_TOTAL_CHANGES/);
});
