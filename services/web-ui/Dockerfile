FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0

# Create non-root user and writable temp directories under /tmp
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /tmp/nginx \
    && chown -R app:app /tmp/nginx /usr/share/nginx/html \
    && chown -R app:app /etc/nginx/conf.d

# Include non-root path overrides at the top of the main nginx.conf.
# Remove the stock pid directive first to avoid a duplicate when nginx-nonroot.conf sets its own.
COPY --chown=app:app nginx-nonroot.conf /etc/nginx/nginx-nonroot.conf
RUN sed -i '/^pid\s/d' /etc/nginx/nginx.conf \
    && sed -i '1s|^|include /etc/nginx/nginx-nonroot.conf;\n|' /etc/nginx/nginx.conf

COPY --from=build --chown=app:app /app/dist /usr/share/nginx/html
COPY --chown=app:app nginx.conf /etc/nginx/conf.d/default.conf

USER app

EXPOSE 8080

CMD ["sh", "-c", "mkdir -p /tmp/nginx && exec nginx -g 'daemon off;'"]
