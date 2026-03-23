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
  const cohortTemplate = read("docs/rollouts/templates/cohort-rollout-tracker.md");
  const projectTemplate = read("docs/rollouts/templates/project-rollout-signoff.md");

  assert.match(runbook, /^# Runbook/m);
  assert.match(apiContracts, /^# API Contracts/m);
  assert.match(eventContracts, /^# Event Contracts/m);

  assert.match(runbook, /SPACEHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(runbook, /SPACEHARBOR_WEBHOOK_SLACK_URL/);
  assert.match(runbook, /SPACEHARBOR_WEBHOOK_SIGNING_SECRET/);
  assert.match(runbook, /fail-fast/i);
  assert.match(runbook, /## SLO Definitions/i);
  assert.match(runbook, /## Warning and Critical Thresholds/i);
  assert.match(runbook, /## Ownership and Escalation Matrix/i);

  assert.match(releaseProcess, /^# Release Process/m);
  assert.match(releaseProcess, /## Canary Promotion and Rollback Gates/i);
  assert.match(releaseProcess, /## Go\/No-Go Checklist/i);
  assert.match(releaseProcess, /## Project-by-Project Rollout Tracking/i);
  assert.match(releaseProcess, /## Post-Release Verification Checkpoints/i);
  assert.match(releaseProcess, /## Communication Templates/i);

  assert.match(wikiOpsRunbook, /## Alert Thresholds/i);
  assert.match(wikiOpsRunbook, /## Ownership and Escalation Matrix/i);
  assert.match(wikiOpsRunbook, /## Canary Rollback Triggers/i);

  assert.match(degradedModePlaybook, /^# Degraded Mode Playbook/m);
  assert.match(degradedModePlaybook, /## Detection and Triage/i);
  assert.match(faultInjectionChecklist, /^# Fault Injection Checklist/m);
  assert.match(faultInjectionChecklist, /## Execution Log/i);
  assert.match(releaseDayChecklist, /^# Release Day Checklist/m);
  assert.match(releaseDayChecklist, /## Go\/No-Go Decision/i);
  assert.match(releaseDayChecklist, /## Communication Templates/i);
  assert.match(releaseDayChecklist, /### Promotion Announcement/i);
  assert.match(releaseDayChecklist, /### Rollback Notice/i);
  assert.match(releaseDayChecklist, /## Post-Release Verification Checkpoints/i);
  assert.match(releaseDayChecklist, /### T\+15m/i);
  assert.match(releaseDayChecklist, /### T\+60m/i);
  assert.match(releaseDayChecklist, /rollout tracker/i);

  assert.match(cohortTemplate, /^# Cohort Rollout Tracker Template/m);
  assert.match(cohortTemplate, /\| project_key \|/i);
  assert.match(cohortTemplate, /not_started \| ready \| in_pilot \| go_live_ready \| live \| rolled_back/i);

  assert.match(projectTemplate, /^# Project Rollout Signoff Template/m);
  assert.match(projectTemplate, /## Pilot Entry Checklist/i);
  assert.match(projectTemplate, /## Cutover Go\/No-Go Decision/i);
  assert.match(projectTemplate, /## Rollback Trigger Matrix/i);
  assert.match(projectTemplate, /## Signoff/i);

  assert.match(readme, /SPACEHARBOR_VAST_FALLBACK_TO_LOCAL/);
  assert.match(wikiOpsRunbook, /fallback/i);
  assert.match(wikiOpsRunbook, /strict/i);
  assert.match(eventContracts, /out-of-order/i);
  assert.match(eventContracts, /REPLAY_NOT_ALLOWED/);
  assert.match(apiContracts, /x-spaceharbor-signature/);
});
