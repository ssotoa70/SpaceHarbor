FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0

# Create non-root user and configure nginx to run as non-root
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /var/cache/nginx /var/log/nginx /tmp/nginx \
    && chown -R app:app /var/cache/nginx /var/log/nginx /tmp/nginx \
    && chown -R app:app /usr/share/nginx/html \
    && sed -i 's|pid\s*/run/nginx.pid;|pid /tmp/nginx/nginx.pid;|' /etc/nginx/nginx.conf \
    && chown -R app:app /etc/nginx/conf.d

COPY --from=build --chown=app:app /app/dist /usr/share/nginx/html
COPY --chown=app:app nginx.conf /etc/nginx/conf.d/default.conf

USER app

EXPOSE 8080
