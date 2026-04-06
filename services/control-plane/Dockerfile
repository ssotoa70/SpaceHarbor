FROM node:20-slim@sha256:1e85773c98c31d4fe5b545e4cb17379e617b348832fb3738b22a08f68dec30f3

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

# Create non-root user (UID 100 matches Alpine's adduser -S for volume compat)
RUN groupadd -g 101 app && useradd -u 100 -g app app \
    && mkdir -p /data && chown -R app:app /app /data

USER app

EXPOSE 8080

# Accept self-signed VAST cluster certificates by default.
# Override with SPACEHARBOR_VAST_SKIP_TLS=false for production with valid CAs.
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

CMD ["npm", "run", "start"]
