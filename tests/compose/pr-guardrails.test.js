const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluatePullRequest } = require("../../scripts/ci/pr-guardrails.js");

test("PR guardrails fail conflicted or behind PRs", () => {
  const result = evaluatePullRequest({
    mergeable_state: "dirty",
    changed_files: 10,
    additions: 100,
    deletions: 20,
    labels: []
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /mergeable_state is 'dirty'/i);
});

test("PR guardrails fail oversized PR without override label", () => {
  const result = evaluatePullRequest(
    {
      mergeable_state: "clean",
      changed_files: 61,
      additions: 1000,
      deletions: 300,
      labels: []
    },
    {
      maxChangedFiles: 40,
      maxTotalChanges: 1200
    }
  );

  assert.equal(result.errors.length, 2);
});

test("PR guardrails downgrade size violations to warnings with override label", () => {
  const result = evaluatePullRequest(
    {
      mergeable_state: "clean",
      changed_files: 61,
      additions: 1000,
      deletions: 300,
      labels: [{ name: "allow-large-pr" }]
    },
    {
      maxChangedFiles: 40,
      maxTotalChanges: 1200
    }
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
});
