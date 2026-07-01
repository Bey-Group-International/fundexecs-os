# Build context is the repo root (set in railway.toml) so workspace packages resolve.

FROM node:20-alpine AS base
WORKDIR /app

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

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/shared/package.json ./shared/package.json
COPY --from=base /app/server/dist ./server/dist
COPY --from=base /app/server/package.json ./server/package.json
COPY --from=base /app/package.json ./package.json

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
