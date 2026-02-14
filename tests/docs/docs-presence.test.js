const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

test("required docs exist with key headings", () => {
  const runbook = read("docs/runbook.md");
  const apiContracts = read("docs/api-contracts.md");
  const eventContracts = read("docs/event-contracts.md");
  const readme = read("README.md");
  const wikiOpsRunbook = read("docs/wiki-2.0/Operations-Runbook.md");

  assert.match(runbook, /^# Runbook/m);
  assert.match(apiContracts, /^# API Contracts/m);
  assert.match(eventContracts, /^# Event Contracts/m);

  assert.match(runbook, /ASSETHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(runbook, /fail-fast/i);
  assert.match(readme, /ASSETHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(wikiOpsRunbook, /fallback/i);
  assert.match(wikiOpsRunbook, /strict/i);
  assert.match(eventContracts, /out-of-order/i);
  assert.match(eventContracts, /REPLAY_NOT_ALLOWED/);
});
