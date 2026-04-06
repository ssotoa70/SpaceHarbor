#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# SpaceHarbor Trino Entrypoint
#
# Generates vast.properties from environment variables and starts Trino.
# Uses the official vastdataorg/trino-vast image (connector pre-installed).
#
# Required env vars:
#   VAST_S3_ENDPOINT       - S3 gateway URL (e.g. http://s3-gateway:8080)
#   VAST_ACCESS_KEY_ID     - S3 access key
#   VAST_SECRET_ACCESS_KEY - S3 secret key
#
# Optional env vars:
#   VAST_DATA_ENDPOINTS    - CNode VIPs for faster data reads (comma-separated)
#   VAST_REGION            - S3 region (default: us-east-1)
#   TRINO_MEMORY           - JVM heap (default: 1G)
# ---------------------------------------------------------------------------

CONFIG_DIR="/etc/trino"
CATALOG_DIR="${CONFIG_DIR}/catalog"

mkdir -p "${CATALOG_DIR}" "${CONFIG_DIR}" /data/trino 2>/dev/null || true

# --- Node properties ---
cat > "${CONFIG_DIR}/node.properties" <<EOF
node.environment=spaceharbor
node.data-dir=/data/trino
EOF

# --- JVM config ---
cat > "${CONFIG_DIR}/jvm.config" <<EOF
-server
-Xmx${TRINO_MEMORY:-1G}
-XX:+UseG1GC
-XX:G1HeapRegionSize=32M
-XX:+ExplicitGCInvokesConcurrent
-XX:+HeapDumpOnOutOfMemoryError
-XX:+ExitOnOutOfMemoryError
-Djdk.attach.allowAttachSelf=true
EOF

# --- Config properties (single-node coordinator) ---
cat > "${CONFIG_DIR}/config.properties" <<EOF
coordinator=true
node-scheduler.include-coordinator=true
http-server.http.port=8080
discovery.uri=http://localhost:8080
query.max-memory=512MB
query.max-memory-per-node=512MB
EOF

# --- Log levels ---
cat > "${CONFIG_DIR}/log.properties" <<EOF
io.trino=INFO
io.vast=INFO
EOF

# --- VAST catalog ---
if [ -n "${VAST_S3_ENDPOINT}" ]; then
  cat > "${CATALOG_DIR}/vast.properties" <<EOF
connector.name=vast
endpoint=${VAST_S3_ENDPOINT}
region=${VAST_REGION:-us-east-1}
access_key_id=${VAST_ACCESS_KEY_ID:-}
secret_access_key=${VAST_SECRET_ACCESS_KEY:-}
num_of_splits=64
num_of_subsplits=10
vast.http-client.request-timeout=60m
vast.http-client.idle-timeout=60m
vast.http-client.max-connections=100
vast.http-client.max-connections-per-server=50
EOF

  [ -n "${VAST_DATA_ENDPOINTS}" ] && \
    echo "data_endpoints=${VAST_DATA_ENDPOINTS}" >> "${CATALOG_DIR}/vast.properties"

  echo "[spaceharbor-trino] VAST catalog configured -> ${VAST_S3_ENDPOINT}"
else
  echo "[spaceharbor-trino] WARNING: VAST_S3_ENDPOINT not set — no VAST catalog."
  echo "[spaceharbor-trino] Set VAST_S3_ENDPOINT in .env to connect to VAST Database."
fi

echo "[spaceharbor-trino] Starting Trino..."
exec /usr/lib/trino/bin/run-trino
