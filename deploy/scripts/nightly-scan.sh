#!/usr/bin/env bash
# Nightly vulnerability scan for SpaceHarbor images + dependencies.
# Reads findings from trivy and npm audit, summarizes, posts to Slack
# via SPACEHARBOR_WEBHOOK_SLACK_URL.
#
# Intentionally NOT a GitHub Action — per team policy (past suspension).
# Run via crontab on the deploy host:
#   0 4 * * * /home/vastdata/SpaceHarbor/deploy/scripts/nightly-scan.sh
#
# Env:
#   SPACEHARBOR_WEBHOOK_SLACK_URL   Slack webhook URL (required)
#   REPO_PATH                       path to SpaceHarbor clone (default: script's grandparent)

set -euo pipefail

REPO_PATH="${REPO_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
SLACK_URL="${SPACEHARBOR_WEBHOOK_SLACK_URL:-}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -z "$SLACK_URL" ]; then
  echo "[nightly-scan] SPACEHARBOR_WEBHOOK_SLACK_URL not set — logging to stdout only"
fi

REPORT=$(mktemp)
trap 'rm -f "$REPORT"' EXIT

echo "=== SpaceHarbor nightly scan — $TIMESTAMP ===" > "$REPORT"
echo "" >> "$REPORT"

# ── 1. Trivy scan of running images ─────────────────────────────────────
echo "=== trivy image scan ===" >> "$REPORT"
if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy NOT INSTALLED — run: docker pull aquasec/trivy:latest and alias" >> "$REPORT"
else
  for IMAGE in spaceharbor-control-plane spaceharbor-web-ui; do
    echo "" >> "$REPORT"
    echo "--- $IMAGE ---" >> "$REPORT"
    trivy image --severity HIGH,CRITICAL --no-progress --quiet "$IMAGE" 2>&1 \
      | tail -40 >> "$REPORT" || echo "scan failed for $IMAGE" >> "$REPORT"
  done
fi

# ── 2. npm audit on control-plane ──────────────────────────────────────
echo "" >> "$REPORT"
echo "=== npm audit (control-plane) ===" >> "$REPORT"
if [ -d "$REPO_PATH/services/control-plane" ]; then
  cd "$REPO_PATH/services/control-plane"
  npm audit --json 2>/dev/null | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  m = d.get('metadata', {}).get('vulnerabilities', {})
  print(f'Total: {sum(m.values())}  critical={m.get(\"critical\",0)}  high={m.get(\"high\",0)}  moderate={m.get(\"moderate\",0)}  low={m.get(\"low\",0)}')
except Exception as e:
  print(f'parse failed: {e}')
" >> "$REPORT"
fi

# ── 3. npm audit on web-ui ─────────────────────────────────────────────
echo "" >> "$REPORT"
echo "=== npm audit (web-ui) ===" >> "$REPORT"
if [ -d "$REPO_PATH/services/web-ui" ]; then
  cd "$REPO_PATH/services/web-ui"
  npm audit --json 2>/dev/null | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  m = d.get('metadata', {}).get('vulnerabilities', {})
  print(f'Total: {sum(m.values())}  critical={m.get(\"critical\",0)}  high={m.get(\"high\",0)}  moderate={m.get(\"moderate\",0)}  low={m.get(\"low\",0)}')
except Exception as e:
  print(f'parse failed: {e}')
" >> "$REPORT"
fi

# ── 4. Publish ─────────────────────────────────────────────────────────
cat "$REPORT"

if [ -n "$SLACK_URL" ]; then
  BODY=$(cat "$REPORT")
  PAYLOAD=$(python3 -c "
import json, os
body = open(os.environ['REPORT']).read()
print(json.dumps({'text': f'```{body[:2000]}```'}))
" REPORT="$REPORT")
  curl -s -X POST -H "content-type: application/json" --data "$PAYLOAD" "$SLACK_URL" >/dev/null
  echo "Posted to Slack."
fi
