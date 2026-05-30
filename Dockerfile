# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies (including dev) for the build
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build (tsc -p tsconfig.build.json -> dist/)
COPY tsconfig.json tsconfig.build.json* ./
COPY source ./source
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy built output from the build stage
COPY --from=build /app/dist ./dist

# The bot has no exposed ports; it connects out to Discord/Mongo/Redis
CMD ["node", "dist/index.js"]
