#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SpaceHarbor Container Validation Script
# Builds, starts, and validates all containers from a clean state.
# Usage: ./scripts/validate_containers.sh [--json] [--skip-build] [--keep]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

COMPOSE_FILE="docker-compose.yml"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH_TIMEOUT=90        # seconds to wait for healthy status
POLL_INTERVAL=3          # seconds between health polls

# Default services started by `docker compose up` (no profiles)
DEFAULT_SERVICES=("spaceharbor-control-plane" "spaceharbor-web-ui" "spaceharbor-openassetio-manager")

# Known health endpoints
declare -A HEALTH_ENDPOINTS=(
  ["spaceharbor-control-plane"]="http://localhost:8080/health"
  ["spaceharbor-web-ui"]="http://localhost:4173"
  ["spaceharbor-openassetio-manager"]="http://localhost:8001/health"
)

# ── Parse arguments ──────────────────────────────────────────────────────────

JSON_OUTPUT=false
SKIP_BUILD=false
KEEP_RUNNING=false

for arg in "$@"; do
  case "$arg" in
    --json)       JSON_OUTPUT=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --keep)       KEEP_RUNNING=true ;;
    --help|-h)
      echo "Usage: $0 [--json] [--skip-build] [--keep]"
      echo "  --json        Output results as JSON"
      echo "  --skip-build  Skip docker compose build"
      echo "  --keep        Keep containers running after validation"
      exit 0
      ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
RESULTS=()

log()  { echo -e "${CYAN}[validate]${NC} $*"; }
pass() { echo -e "${GREEN}  PASS${NC} $*"; ((PASS_COUNT++)); RESULTS+=("{\"service\":\"$1\",\"check\":\"$2\",\"status\":\"PASS\"}"); }
fail() { echo -e "${RED}  FAIL${NC} $*"; ((FAIL_COUNT++)); RESULTS+=("{\"service\":\"$1\",\"check\":\"$2\",\"status\":\"FAIL\",\"detail\":\"$3\"}"); }
warn() { echo -e "${YELLOW}  WARN${NC} $*"; ((WARN_COUNT++)); RESULTS+=("{\"service\":\"$1\",\"check\":\"$2\",\"status\":\"WARN\",\"detail\":\"$3\"}"); }

cleanup() {
  if [ "$KEEP_RUNNING" = false ]; then
    log "Cleaning up containers..."
    cd "$PROJECT_DIR" && docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
  fi
}

# ── Pre-flight checks ───────────────────────────────────────────────────────

cd "$PROJECT_DIR"

log "Starting SpaceHarbor container validation"
log "Project directory: $PROJECT_DIR"

# Check prerequisites
if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found" >&2
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "ERROR: Docker daemon not running" >&2
  exit 1
fi

# Check .env exists
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    log "No .env found — copying .env.example"
    cp .env.example .env
  else
    echo "ERROR: No .env or .env.example found" >&2
    exit 1
  fi
fi

# ── Phase 1: Build ──────────────────────────────────────────────────────────

if [ "$SKIP_BUILD" = false ]; then
  log "Phase 1: Building containers..."
  if docker compose -f "$COMPOSE_FILE" build 2>&1; then
    pass "build" "docker-compose-build" ""
  else
    fail "build" "docker-compose-build" "Build failed"
    cleanup
    exit 1
  fi
else
  log "Phase 1: Skipping build (--skip-build)"
fi

# ── Phase 2: Start ──────────────────────────────────────────────────────────

log "Phase 2: Starting containers..."
# Stop any existing containers first
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

if docker compose -f "$COMPOSE_FILE" up -d 2>&1; then
  pass "startup" "docker-compose-up" ""
else
  fail "startup" "docker-compose-up" "Failed to start"
  cleanup
  exit 1
fi

# Give containers a moment to initialize
sleep 5

# ── Phase 3: Container status checks ────────────────────────────────────────

log "Phase 3: Checking container status..."

for svc in "${DEFAULT_SERVICES[@]}"; do
  # Check container exists and is running
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "not_found")

  if [ "$STATUS" = "running" ]; then
    pass "$svc" "container-running" ""
  else
    fail "$svc" "container-running" "Status: $STATUS"
    continue
  fi

  # Check not restarting
  RESTART_COUNT=$(docker inspect --format='{{.RestartCount}}' "$svc" 2>/dev/null || echo "0")
  if [ "$RESTART_COUNT" -gt 0 ]; then
    fail "$svc" "no-restart-loop" "Restart count: $RESTART_COUNT"
  else
    pass "$svc" "no-restart-loop" ""
  fi

  # Check running as non-root
  CONTAINER_USER=$(docker exec "$svc" whoami 2>/dev/null || echo "unknown")
  if [ "$CONTAINER_USER" != "root" ]; then
    pass "$svc" "non-root-user" ""
  else
    warn "$svc" "non-root-user" "Running as root"
  fi

  # Check for permission errors in logs
  PERM_ERRORS=$(docker logs "$svc" 2>&1 | grep -ci "permission denied" || true)
  if [ "$PERM_ERRORS" -eq 0 ]; then
    pass "$svc" "no-permission-errors" ""
  else
    fail "$svc" "no-permission-errors" "Found $PERM_ERRORS permission denied errors in logs"
  fi

  # Check for fatal errors in logs
  FATAL_ERRORS=$(docker logs "$svc" 2>&1 | grep -ciE "(fatal|emerg|panic)" || true)
  if [ "$FATAL_ERRORS" -eq 0 ]; then
    pass "$svc" "no-fatal-errors" ""
  else
    fail "$svc" "no-fatal-errors" "Found $FATAL_ERRORS fatal/emerg/panic errors in logs"
  fi
done

# ── Phase 4: Health endpoint checks ─────────────────────────────────────────

log "Phase 4: Waiting for health endpoints (timeout: ${HEALTH_TIMEOUT}s)..."

for svc in "${DEFAULT_SERVICES[@]}"; do
  ENDPOINT="${HEALTH_ENDPOINTS[$svc]:-}"
  if [ -z "$ENDPOINT" ]; then
    continue
  fi

  ELAPSED=0
  HEALTHY=false
  while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$ENDPOINT" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
      HEALTHY=true
      break
    fi
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  if [ "$HEALTHY" = true ]; then
    pass "$svc" "health-endpoint" ""
  else
    fail "$svc" "health-endpoint" "$ENDPOINT returned $HTTP_CODE after ${HEALTH_TIMEOUT}s"
  fi
done

# ── Phase 5: Docker health status ───────────────────────────────────────────

log "Phase 5: Checking Docker health status..."

for svc in "${DEFAULT_SERVICES[@]}"; do
  # Wait for Docker healthcheck to settle
  ELAPSED=0
  DOCKER_HEALTH="starting"
  while [ $ELAPSED -lt $HEALTH_TIMEOUT ] && [ "$DOCKER_HEALTH" = "starting" ]; do
    DOCKER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "none")
    if [ "$DOCKER_HEALTH" = "starting" ]; then
      sleep "$POLL_INTERVAL"
      ELAPSED=$((ELAPSED + POLL_INTERVAL))
    fi
  done

  if [ "$DOCKER_HEALTH" = "healthy" ]; then
    pass "$svc" "docker-healthcheck" ""
  elif [ "$DOCKER_HEALTH" = "none" ]; then
    warn "$svc" "docker-healthcheck" "No healthcheck defined"
  else
    fail "$svc" "docker-healthcheck" "Docker health: $DOCKER_HEALTH"
  fi
done

# ── Phase 6: Port reachability ──────────────────────────────────────────────

log "Phase 6: Checking port reachability..."

declare -A PORTS=(
  ["spaceharbor-control-plane"]="8080"
  ["spaceharbor-web-ui"]="4173"
  ["spaceharbor-openassetio-manager"]="8001"
)

for svc in "${DEFAULT_SERVICES[@]}"; do
  PORT="${PORTS[$svc]:-}"
  if [ -z "$PORT" ]; then continue; fi

  if curl -s --connect-timeout 5 "http://localhost:$PORT" >/dev/null 2>&1; then
    pass "$svc" "port-reachable" ""
  else
    fail "$svc" "port-reachable" "Port $PORT not reachable"
  fi
done

# ── Phase 7: Service inter-dependency check ─────────────────────────────────

log "Phase 7: Checking service dependencies..."

# Control-plane health response
CP_HEALTH=$(curl -s http://localhost:8080/health 2>/dev/null || echo "{}")
if echo "$CP_HEALTH" | grep -q '"status":"ok"'; then
  pass "spaceharbor-control-plane" "health-response-valid" ""
else
  fail "spaceharbor-control-plane" "health-response-valid" "Health response: $CP_HEALTH"
fi

# ── Results ──────────────────────────────────────────────────────────────────

echo ""
log "═══════════════════════════════════════════════════════"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}  RESULT: PASS${NC}  ($PASS_COUNT passed, $WARN_COUNT warnings, $FAIL_COUNT failures)"
  OVERALL="PASS"
else
  echo -e "${RED}  RESULT: FAIL${NC}  ($PASS_COUNT passed, $WARN_COUNT warnings, $FAIL_COUNT failures)"
  OVERALL="FAIL"
fi

log "═══════════════════════════════════════════════════════"

# ── JSON output ──────────────────────────────────────────────────────────────

if [ "$JSON_OUTPUT" = true ]; then
  echo ""
  echo "{"
  echo "  \"result\": \"$OVERALL\","
  echo "  \"pass\": $PASS_COUNT,"
  echo "  \"warn\": $WARN_COUNT,"
  echo "  \"fail\": $FAIL_COUNT,"
  echo "  \"checks\": ["
  for i in "${!RESULTS[@]}"; do
    if [ "$i" -lt $((${#RESULTS[@]} - 1)) ]; then
      echo "    ${RESULTS[$i]},"
    else
      echo "    ${RESULTS[$i]}"
    fi
  done
  echo "  ]"
  echo "}"
fi

# ── Cleanup ──────────────────────────────────────────────────────────────────

if [ "$KEEP_RUNNING" = false ]; then
  cleanup
fi

# Exit with appropriate code
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
