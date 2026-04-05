FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa

WORKDIR /app

# Install Python + vastdb for VAST Database schema migrations
RUN apk add --no-cache python3 py3-pip \
    && pip3 install --break-system-packages vastdb

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Create non-root user and settings data directory
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /data && chown -R app:app /app /data

USER app

EXPOSE 8080

# Accept self-signed VAST cluster certificates by default.
# Override with SPACEHARBOR_VAST_SKIP_TLS=false for production with valid CAs.
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

CMD ["npm", "run", "start"]
