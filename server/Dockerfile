# Build context is the repo root (set in railway.toml) so workspace packages resolve.

FROM node:20-alpine AS base
WORKDIR /app

# mediasoup requires native compilation
RUN apk add --no-cache python3 py3-pip make g++ linux-headers

# Install all workspace deps
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN npm ci

# Build shared first (server depends on it)
COPY shared/ ./shared/
RUN npm run build --workspace=shared

# Build server
COPY server/ ./server/
RUN npm run build --workspace=server

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# mediasoup worker binary is dynamically linked — keep same runtime deps
RUN apk add --no-cache libstdc++

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/shared/package.json ./shared/package.json
COPY --from=base /app/server/dist ./server/dist
COPY --from=base /app/server/package.json ./server/package.json
COPY --from=base /app/package.json ./package.json

EXPOSE 4000
# RTC_MIN_PORT/RTC_MAX_PORT UDP range must be exposed and allowed through Railway firewall
ENV RTC_MIN_PORT=40000
ENV RTC_MAX_PORT=49999
CMD ["node", "server/dist/index.js"]
