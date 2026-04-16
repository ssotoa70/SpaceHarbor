#!/usr/bin/env bash
# Capture the Docker named volume `settings-data` as a timestamped tarball.
# Usage: backup-settings.sh <target-dir>
set -euo pipefail

TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then
  echo "Usage: $0 <target-dir>" >&2
  exit 2
fi
mkdir -p "$TARGET_DIR"

TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT="$TARGET_DIR/settings-$TIMESTAMP.tar.gz"

# Use a helper container with the volume mounted so we don't depend on
# any specific tar binary on the host.
docker run --rm \
  -v spaceharbor_settings-data:/volume:ro \
  -v "$TARGET_DIR":/backup \
  alpine:3 \
  sh -c "cd /volume && tar czf /backup/settings-$TIMESTAMP.tar.gz ."

echo "Wrote $OUT"
ls -lh "$OUT"
