# syntax=docker/dockerfile:1

# ---- Build stage ----
# node:20-slim (Debian/glibc), NOT alpine/musl: the native @mongodb-js/zstd
# module (compressors:"zstd") only ships glibc prebuilds; on musl the
# zstd-compressed Mongo connection drops every ~10s heartbeat. Matches perceptor.
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# curl is used by the docker-compose healthcheck (slim ships without it).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the adapter-node build output
COPY --from=build /app/build ./build

# adapter-node listens on $PORT (default 3000). ADDRESS_HEADER/XFF_DEPTH let the
# Node server trust the single nginx hop when reading the client IP.
ENV PORT=3000 \
    HOST=0.0.0.0 \
    ADDRESS_HEADER=X-Forwarded-For \
    XFF_DEPTH=1
EXPOSE 3000

CMD ["node", "build/index.js"]
