const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");

test("worktree preflight script validates active workspace", () => {
  const output = execFileSync("bash", ["scripts/check-worktree.sh"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /Worktree preflight OK/);
  assert.match(output, /Repository root:/);
  assert.match(output, /Current branch:/);
});
