#!/usr/bin/env bash
# Post-restore smoke test — asserts SpaceHarbor came back up cleanly.
# Usage: post-restore-checks.sh [base-url]
set -euo pipefail

BASE="${1:-http://localhost:8080}"
FAIL=0

check() {
  local NAME="$1"; local EXPECT="$2"; local ACTUAL="$3"
  if [ "$ACTUAL" = "$EXPECT" ]; then
    echo "  ✓ $NAME"
  else
    echo "  ✗ $NAME (expected $EXPECT, got $ACTUAL)" >&2
    FAIL=1
  fi
}

echo "=== Post-restore checks against $BASE ==="

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
check "GET /health returns 200" "200" "$HEALTH"

READY=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/ready")
check "GET /health/ready returns 200" "200" "$READY"

METRICS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/metrics")
check "GET /metrics returns 200" "200" "$METRICS"

# Audit chain verification — needs admin token
if [ -n "${ADMIN_TOKEN:-}" ]; then
  VERIFY=$(curl -s -X POST -H "authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/admin/audit/verify")
  VALID=$(echo "$VERIFY" | python3 -c "import json,sys;print(json.load(sys.stdin).get('valid'))" 2>/dev/null || echo "?")
  check "Audit chain valid" "True" "$VALID"
  SCANNED=$(echo "$VERIFY" | python3 -c "import json,sys;print(json.load(sys.stdin).get('scanned'))" 2>/dev/null || echo "?")
  echo "    scanned $SCANNED rows"
else
  echo "  ⚠ ADMIN_TOKEN not set — skipping audit chain verification"
fi

if [ $FAIL -eq 0 ]; then
  echo "All checks passed."
else
  echo "One or more checks failed." >&2
  exit 1
fi
