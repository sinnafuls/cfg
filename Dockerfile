# syntax=docker/dockerfile:1

# ---- Build stage ----
# node:20-slim (Debian/glibc), NOT alpine/musl: the native @mongodb-js/zstd
# module (pulled in by compressors:"zstd") only ships glibc prebuilds. On musl
# it fails to load and the zstd-compressed Mongo connection drops on every
# ~10s topology heartbeat (connect succeeds, then flaps). Matches perceptor.
FROM node:20-slim AS build
WORKDIR /app

# Install dependencies (including dev) for the build
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build (tsc -p tsconfig.build.json -> dist/)
COPY tsconfig.json tsconfig.build.json* ./
COPY source ./source
RUN npm run build

# ---- Production stage ----
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy built output from the build stage
COPY --from=build /app/dist ./dist

# The bot has no exposed ports; it connects out to Discord/Mongo/Redis
CMD ["node", "dist/index.js"]
