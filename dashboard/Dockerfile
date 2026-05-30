# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# curl is used by the docker-compose healthcheck (alpine ships without it).
RUN apk add --no-cache curl

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
