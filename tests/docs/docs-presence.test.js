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

  assert.match(runbook, /^# Runbook/m);
  assert.match(apiContracts, /^# API Contracts/m);
  assert.match(eventContracts, /^# Event Contracts/m);
});
