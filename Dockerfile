# syntax=docker/dockerfile:1
# Build identity for GET /api/version and <meta name="roster-build">.
# Pass the same values to both stages. Empty means "unknown" (the image has no .git).
#   docker build \
#     --build-arg ROSTER_BUILD_SHA="$(git rev-parse HEAD)" \
#     --build-arg ROSTER_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .
# Do not pass secrets. Compose reads these from the shell or .env (docs/STANDUP.md).
FROM node:22-bookworm-slim AS build
ARG ROSTER_BUILD_SHA=
ARG ROSTER_BUILT_AT=
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig.json vite.config.ts index.html ./
COPY server/build-info.mjs ./server/build-info.mjs
COPY src ./src
RUN npm ci \
  && ROSTER_BUILD_SHA="$ROSTER_BUILD_SHA" ROSTER_BUILT_AT="$ROSTER_BUILT_AT" npm run build

FROM node:22-bookworm-slim
ARG ROSTER_BUILD_SHA=
ARG ROSTER_BUILT_AT=
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
    ROSTER_BUILD_SHA=${ROSTER_BUILD_SHA} \
    ROSTER_BUILT_AT=${ROSTER_BUILT_AT} \
    ROSTER_API_HOST=0.0.0.0 \
    ROSTER_API_PORT=8790 \
    ROSTER_API=http://127.0.0.1:8790 \
    ROSTER_WEB_PORT=5175 \
    ROSTER_PUBLIC_URL=http://127.0.0.1:5175 \
    ROSTER_DATA_DIR=/data \
    ROSTER_OPENCODE_DIR=/data/opencode \
    ROSTER_STATIC_DIR=/app/dist \
    OPENCODE_BIN=/usr/local/bin/opencode \
    HOME=/data/home

EXPOSE 8790
VOLUME ["/data"]
ENTRYPOINT ["/entrypoint.sh"]
