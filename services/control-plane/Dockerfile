FROM node:20-slim@sha256:1e85773c98c31d4fe5b545e4cb17379e617b348832fb3738b22a08f68dec30f3

WORKDIR /app

# Install build tools (required by @confluentinc/kafka-javascript native module)
# and Python + vastdb SDK for VAST Database schema migrations.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev wget \
    build-essential g++ make \
    && pip3 install --break-system-packages vastdb pyarrow \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

# Remove build tools after npm ci to keep image smaller
RUN apt-get update && apt-get purge -y --auto-remove build-essential g++ make python3-dev \
    && rm -rf /var/lib/apt/lists/*

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
