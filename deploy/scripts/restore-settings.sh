#!/usr/bin/env bash
# Restore the settings-data volume from a tarball created by backup-settings.sh.
# Usage: restore-settings.sh <tarball>
set -euo pipefail

TARBALL="${1:-}"
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "Usage: $0 <tarball>" >&2
  exit 2
fi

echo "This will OVERWRITE the current settings-data volume with $TARBALL."
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi

# Stop the control-plane so we don't race with a running server writing
# to /data while we're swapping the contents.
docker compose stop control-plane || true

docker run --rm \
  -v spaceharbor_settings-data:/volume \
  -v "$(dirname "$(realpath "$TARBALL")")":/backup:ro \
  alpine:3 \
  sh -c "cd /volume && rm -rf ./* && tar xzf /backup/$(basename "$TARBALL")"

docker compose start control-plane
echo "Restore complete. Verify via: docker compose exec control-plane cat /data/settings.json | jq ."
