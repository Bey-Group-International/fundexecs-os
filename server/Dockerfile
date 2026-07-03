# Build context is the repo root (set in railway.toml) so workspace packages resolve.
#
# Debian-slim, not alpine: uWebSockets.js and mediasoup ship glibc-built native
# binaries that fail to load under musl — alpine either crashes at startup
# (uWS) or forces a slow compile-from-source (mediasoup worker). On slim,
# mediasoup downloads its prebuilt worker; python3/build-essential remain only
# as the documented fallback for when that download is unavailable.
# Node 22 satisfies the engines range declared by mediasoup and its deps.

FROM node:22-slim AS build
WORKDIR /app

# Fallback toolchain for mediasoup's compile-from-source path; ca-certificates
# for the prebuilt-worker and github-tarball downloads.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install only the shared/server workspace deps — the root workspace is the
# Next.js web app, which this image must not carry.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN npm ci --workspaces --include-workspace-root=false

# Build shared first (server depends on it)
COPY shared/ ./shared/
RUN npm run build --workspace=shared

# Build server
COPY server/ ./server/
RUN npm run build --workspace=server

# Re-resolve production-only deps for the runtime image.
RUN npm ci --workspaces --include-workspace-root=false --omit=dev

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/package.json ./package.json

EXPOSE 4000
# RTC_MIN_PORT/RTC_MAX_PORT UDP range must be exposed and allowed through Railway firewall
ENV RTC_MIN_PORT=40000
ENV RTC_MAX_PORT=49999
CMD ["node", "server/dist/index.js"]
