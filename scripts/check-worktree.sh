#!/usr/bin/env bash

set -euo pipefail

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Worktree preflight failed: current directory is not inside a git repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
current_dir="$(pwd -P)"
branch_name="$(git branch --show-current)"

registered_paths=()
while IFS= read -r path; do
  registered_paths+=("$path")
done < <(git worktree list --porcelain | sed -n 's/^worktree //p')

is_registered="false"
for worktree_path in "${registered_paths[@]}"; do
  if [[ "$current_dir" == "$worktree_path"* ]]; then
    is_registered="true"
    break
  fi
done

if [[ "$is_registered" != "true" ]]; then
  echo "Worktree preflight failed: current directory is not an active git worktree path for this repository."
  echo "Current directory: $current_dir"
  echo "Registered worktrees:"
  for worktree_path in "${registered_paths[@]}"; do
    echo "  - $worktree_path"
  done
  exit 1
fi

if [[ -n "${EXPECTED_WORKTREE_PREFIX:-}" ]]; then
  if [[ "$current_dir" != "$EXPECTED_WORKTREE_PREFIX"* ]]; then
    echo "Worktree preflight failed: current directory is outside EXPECTED_WORKTREE_PREFIX."
    echo "Current directory: $current_dir"
    echo "Expected prefix: $EXPECTED_WORKTREE_PREFIX"
    exit 1
  fi
fi

echo "Worktree preflight OK"
echo "Repository root: $repo_root"
echo "Current directory: $current_dir"
echo "Current branch: $branch_name"
