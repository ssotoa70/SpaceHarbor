FROM node:20-slim@sha256:4a7f0c6a92093750c7aa3aee2a0c4a09e40f12ccd720e7cafa545a2a6d7dac95

WORKDIR /app

# Install Python + vastdb SDK for VAST Database schema migrations.
# Debian-slim has pre-built wheels for adbc_driver_manager (required by vastdb).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip wget \
    && pip3 install --break-system-packages vastdb pyarrow \
    && apt-get purge -y --auto-remove && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Create non-root user and settings data directory
RUN groupadd -r app && useradd -r -g app app \
    && mkdir -p /data && chown -R app:app /app /data

USER app

EXPOSE 8080

# Accept self-signed VAST cluster certificates by default.
# Override with SPACEHARBOR_VAST_SKIP_TLS=false for production with valid CAs.
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

CMD ["npm", "run", "start"]
