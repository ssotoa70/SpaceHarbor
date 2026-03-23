#!/usr/bin/env bash
set -euo pipefail

# SpaceHarbor first-time setup
# Usage: ./setup.sh

echo "=== SpaceHarbor Setup ==="
echo ""

# 1. Check prerequisites
for cmd in docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is not installed. Install it first."
    exit 1
  fi
done

if ! docker compose version &>/dev/null; then
  echo "ERROR: 'docker compose' (v2) is required. Install Docker Compose v2."
  exit 1
fi

echo "[ok] Docker and Docker Compose found."

# 2. Create .env from .env.example if missing
if [ -f .env ]; then
  echo "[ok] .env already exists — keeping it."
else
  if [ ! -f .env.example ]; then
    echo "ERROR: .env.example not found. Are you in the SpaceHarbor root directory?"
    exit 1
  fi
  cp .env.example .env
  echo "[ok] Created .env from .env.example."
fi

# 3. Generate JWT secret if still set to placeholder
CURRENT_JWT=$(grep '^SPACEHARBOR_JWT_SECRET=' .env | cut -d= -f2-)
if [ -z "$CURRENT_JWT" ] || [ "$CURRENT_JWT" = "dev-jwt-secret-change-in-production" ] || [ "$CURRENT_JWT" = "CHANGE_ME" ]; then
  JWT_SECRET=$(openssl rand -base64 32)
  sed -i.bak "s|^SPACEHARBOR_JWT_SECRET=.*|SPACEHARBOR_JWT_SECRET=${JWT_SECRET}|" .env
  rm -f .env.bak
  echo "[ok] Generated random JWT secret."
else
  echo "[ok] JWT secret already configured."
fi

# 4. Prompt for admin credentials
echo ""
CURRENT_EMAIL=$(grep '^SPACEHARBOR_ADMIN_EMAIL=' .env | cut -d= -f2-)
if [ -z "$CURRENT_EMAIL" ] || [ "$CURRENT_EMAIL" = "admin@spaceharbor.dev" ]; then
  read -rp "Admin email [admin@spaceharbor.dev]: " ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@spaceharbor.dev}
  sed -i.bak "s|^SPACEHARBOR_ADMIN_EMAIL=.*|SPACEHARBOR_ADMIN_EMAIL=${ADMIN_EMAIL}|" .env
  rm -f .env.bak
fi

CURRENT_PASS=$(grep '^SPACEHARBOR_ADMIN_PASSWORD=' .env | cut -d= -f2-)
if [ -z "$CURRENT_PASS" ] || [ "$CURRENT_PASS" = "Admin1234!dev" ] || [ "$CURRENT_PASS" = "CHANGE_ME" ]; then
  read -rp "Admin password (min 8 chars): " ADMIN_PASS
  if [ -n "$ADMIN_PASS" ]; then
    sed -i.bak "s|^SPACEHARBOR_ADMIN_PASSWORD=.*|SPACEHARBOR_ADMIN_PASSWORD=${ADMIN_PASS}|" .env
    rm -f .env.bak
  fi
fi

# 5. Summary
echo ""
echo "=== Configuration Summary ==="
echo "  Persistence: $(grep '^SPACEHARBOR_PERSISTENCE_BACKEND=' .env | cut -d= -f2-)"
echo "  Admin email: $(grep '^SPACEHARBOR_ADMIN_EMAIL=' .env | cut -d= -f2-)"
echo "  VAST DB URL: $(grep '^VAST_DATABASE_URL=' .env | cut -d= -f2- || echo '(not set)')"
echo "  Event Broker: $(grep '^VAST_EVENT_BROKER_URL=' .env | cut -d= -f2- || echo '(not set)')"
echo ""
echo "To start SpaceHarbor:"
echo "  docker compose up --build -d"
echo ""
echo "Web UI will be at: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):4173"
echo "API will be at:    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):8080"
