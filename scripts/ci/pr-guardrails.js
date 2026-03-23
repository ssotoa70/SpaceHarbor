"use strict";

const DISALLOWED_MERGEABLE_STATES = new Set(["dirty", "behind"]);

function parsePositiveInt(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
}

function evaluatePullRequest(pr, options = {}) {
  const maxChangedFiles = parsePositiveInt(options.maxChangedFiles, 40);
  const maxTotalChanges = parsePositiveInt(options.maxTotalChanges, 1200);

  const labels = Array.isArray(pr.labels) ? pr.labels : [];
  const hasLargePrOverride = labels.some((label) => {
    const name = typeof label === "string" ? label : label?.name;
    return typeof name === "string" && name.toLowerCase() === "allow-large-pr";
  });

  const errors = [];
  const warnings = [];

  const mergeableState = String(pr.mergeable_state ?? "unknown").toLowerCase();
  if (DISALLOWED_MERGEABLE_STATES.has(mergeableState)) {
    errors.push(
      `PR mergeable_state is '${mergeableState}'. Rebase/merge from main to clear stale/conflicted state before merge.`
    );
  }

  const changedFiles = Number(pr.changed_files ?? 0);
  const totalChanges = Number(pr.additions ?? 0) + Number(pr.deletions ?? 0);

  if (changedFiles > maxChangedFiles) {
    const message = `PR changed_files is ${changedFiles}, above threshold ${maxChangedFiles}.`;
    if (hasLargePrOverride) {
      warnings.push(`${message} Override label allow-large-pr detected.`);
    } else {
      errors.push(`${message} Split into smaller PR slices or add allow-large-pr label with justification.`);
    }
  }

  if (totalChanges > maxTotalChanges) {
    const message = `PR total line changes is ${totalChanges}, above threshold ${maxTotalChanges}.`;
    if (hasLargePrOverride) {
      warnings.push(`${message} Override label allow-large-pr detected.`);
    } else {
      errors.push(`${message} Split into smaller PR slices or add allow-large-pr label with justification.`);
    }
  }

  return {
    mergeableState,
    changedFiles,
    totalChanges,
    maxChangedFiles,
    maxTotalChanges,
    hasLargePrOverride,
    warnings,
    errors
  };
}

async function fetchPullRequest(repo, prNumber, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch PR metadata (${response.status}): ${body}`);
  }

  return response.json();
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("PR guardrails skipped: not a pull_request event.");
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;

  if (!token || !repo || !prNumber) {
    throw new Error("Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER");
  }

  const pr = await fetchPullRequest(repo, prNumber, token);
  const result = evaluatePullRequest(pr, {
    maxChangedFiles: process.env.PR_MAX_CHANGED_FILES,
    maxTotalChanges: process.env.PR_MAX_TOTAL_CHANGES
  });

  console.log(`PR guardrails evaluated: #${pr.number} ${pr.title}`);
  console.log(`- mergeable_state: ${result.mergeableState}`);
  console.log(`- changed_files: ${result.changedFiles} (max ${result.maxChangedFiles})`);
  console.log(`- total_changes: ${result.totalChanges} (max ${result.maxTotalChanges})`);

  for (const warning of result.warnings) {
    console.log(`warning: ${warning}`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`error: ${error}`);
    }
    process.exit(1);
  }
}

module.exports = {
  evaluatePullRequest
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
