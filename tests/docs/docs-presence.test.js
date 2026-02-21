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
  const releaseProcess = read("docs/wiki-2.0/Release-Process.md");
  const wikiOpsRunbook = read("docs/wiki-2.0/Operations-Runbook.md");
  const degradedModePlaybook = read("docs/runbooks/degraded-mode-playbook.md");
  const faultInjectionChecklist = read("docs/runbooks/fault-injection-checklist.md");
  const releaseDayChecklist = read("docs/runbooks/release-day-checklist.md");

  assert.match(runbook, /^# Runbook/m);
  assert.match(apiContracts, /^# API Contracts/m);
  assert.match(eventContracts, /^# Event Contracts/m);

  assert.match(runbook, /ASSETHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(runbook, /ASSETHARBOR_WEBHOOK_SLACK_URL/);
  assert.match(runbook, /ASSETHARBOR_WEBHOOK_SIGNING_SECRET/);
  assert.match(runbook, /fail-fast/i);
  assert.match(runbook, /## SLO Definitions/i);
  assert.match(runbook, /## Warning and Critical Thresholds/i);
  assert.match(runbook, /## Ownership and Escalation Matrix/i);

  assert.match(releaseProcess, /^# Release Process/m);
  assert.match(releaseProcess, /## Canary Promotion and Rollback Gates/i);
  assert.match(releaseProcess, /## Go\/No-Go Checklist/i);

  assert.match(wikiOpsRunbook, /## Alert Thresholds/i);
  assert.match(wikiOpsRunbook, /## Ownership and Escalation Matrix/i);
  assert.match(wikiOpsRunbook, /## Canary Rollback Triggers/i);

  assert.match(degradedModePlaybook, /^# Degraded Mode Playbook/m);
  assert.match(degradedModePlaybook, /## Detection and Triage/i);
  assert.match(faultInjectionChecklist, /^# Fault Injection Checklist/m);
  assert.match(faultInjectionChecklist, /## Execution Log/i);
  assert.match(releaseDayChecklist, /^# Release Day Checklist/m);
  assert.match(releaseDayChecklist, /## Go\/No-Go Decision/i);

  assert.match(readme, /ASSETHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(wikiOpsRunbook, /fallback/i);
  assert.match(wikiOpsRunbook, /strict/i);
  assert.match(eventContracts, /out-of-order/i);
  assert.match(eventContracts, /REPLAY_NOT_ALLOWED/);
  assert.match(apiContracts, /x-assetharbor-signature/);
});
