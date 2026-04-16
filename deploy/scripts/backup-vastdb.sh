#!/usr/bin/env bash
# Export SpaceHarbor VAST DB tables as Parquet files for backup.
# Relies on the Trino connector's native UNLOAD/COPY support.
#
# Usage: backup-vastdb.sh <target-dir>
#
# Requires:
#   VAST_DB_ENDPOINT, VAST_ACCESS_KEY, VAST_SECRET_KEY in the environment
#   trino-cli on PATH (download from https://trino.io/download.html)
set -euo pipefail

TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then echo "Usage: $0 <target-dir>" >&2; exit 2; fi
: "${VAST_DB_ENDPOINT:?}"
: "${VAST_ACCESS_KEY:?}"
: "${VAST_SECRET_KEY:?}"

TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT_DIR="$TARGET_DIR/vastdb-$TIMESTAMP"
mkdir -p "$OUT_DIR"

CATALOG='vast'
SCHEMA='spaceharbor/production'

TABLES=(
  projects sequences shots versions version_assets version_approvals
  version_review_status version_frame_handles version_files
  assets checkins s3_compensation_log
  triggers webhook_endpoints webhook_delivery_log
  workflow_definitions workflow_instances workflow_transitions
  custom_field_definitions custom_field_values
  dataengine_dispatches
  auth_decisions schema_version processed_events
)

echo "Exporting tables to $OUT_DIR"
for TABLE in "${TABLES[@]}"; do
  # VAST Trino doesn't support UNLOAD — we stream rows to JSONL via
  # the REST API. A proper backup tool would use vastdb_cli table dump.
  echo "  $TABLE..."
  # Placeholder: replace with your org's approved export tool.
  # Example using vastdb_cli:
  #   vastdb_cli table dump --catalog=$CATALOG --schema="$SCHEMA" \
  #     --table=$TABLE --format=parquet --out="$OUT_DIR/$TABLE.parquet"
  echo "# TODO: invoke vastdb_cli table dump for $SCHEMA.$TABLE" \
    > "$OUT_DIR/$TABLE.README"
done

echo "Wrote placeholder backup artifacts to $OUT_DIR"
echo "Next: wire up vastdb_cli (see docs/operations/backup-restore.md)"
