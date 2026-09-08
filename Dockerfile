# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    tar \
    util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path \
  && install -D -m 0755 /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && /usr/local/bin/opencode --version

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && mkdir -p /data \
  && chown -R node:node /app /data

ENV NODE_ENV=production \
    ROSTER_API_HOST=0.0.0.0 \
    ROSTER_API_PORT=8787 \
    ROSTER_API=http://127.0.0.1:8787 \
    ROSTER_PUBLIC_URL=http://127.0.0.1:5173 \
    ROSTER_DATA_DIR=/data \
    ROSTER_OPENCODE_DIR=/data/opencode \
    ROSTER_STATIC_DIR=/app/dist \
    OPENCODE_BIN=/usr/local/bin/opencode \
    HOME=/data/home

EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["/entrypoint.sh"]
