FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Create non-root user and settings data directory
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /data && chown -R app:app /app /data

USER app

EXPOSE 8080

CMD ["npm", "run", "start"]
