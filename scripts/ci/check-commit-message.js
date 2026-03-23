#!/usr/bin/env node
/**
 * Validates that all commits in a PR follow Conventional Commits format.
 * Runs in CI on pull_request events only.
 *
 * Expected env: COMMIT_MESSAGES — newline-separated list of commit messages.
 * If COMMIT_MESSAGES is not set, reads from stdin.
 */

const CONVENTIONAL_RE =
  /^(feat|fix|docs|chore|ci|test|refactor|perf|style|build|revert)(\(.+\))?!?:\s.+/;
const MERGE_RE = /^Merge /;
const COAUTHOR_RE = /^Co-Authored-By:/i;

function validate(messages) {
  const errors = [];
  for (const msg of messages) {
    const subject = msg.split('\n')[0].trim();
    if (!subject) continue;
    if (MERGE_RE.test(subject)) continue;
    if (COAUTHOR_RE.test(subject)) continue;

    if (!CONVENTIONAL_RE.test(subject)) {
      errors.push(`  - "${subject}"`);
    }
  }
  return errors;
}

async function main() {
  let raw = process.env.COMMIT_MESSAGES;

  if (!raw) {
    // Read from stdin (piped git log output)
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString('utf-8');
  }

  if (!raw || !raw.trim()) {
    console.log('No commit messages to validate.');
    process.exit(0);
  }

  // Split on double newlines (git log --format separator) or single newlines
  const messages = raw
    .split(/\n{2,}/)
    .map((m) => m.trim())
    .filter(Boolean);

  const errors = validate(messages);

  if (errors.length > 0) {
    console.error('Commit message validation failed.');
    console.error('The following commits do not follow Conventional Commits format:');
    console.error('');
    for (const e of errors) console.error(e);
    console.error('');
    console.error(
      'Expected format: type(scope)?: description'
    );
    console.error(
      'Valid types: feat, fix, docs, chore, ci, test, refactor, perf, style, build, revert'
    );
    process.exit(1);
  }

  console.log(`All ${messages.length} commit message(s) follow Conventional Commits format.`);
}

main();
