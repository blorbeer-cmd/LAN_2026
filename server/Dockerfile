# Multi-stage build: compile TypeScript + native better-sqlite3 addon in a
# full build image, then ship only the runtime bits. Both stages use the same
# base image so the native addon's glibc ABI matches between build and run.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 compiles a native addon at install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies now that the build output exists, so the runtime stage
# only copies production node_modules.
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY agent-dist ./agent-dist

# node:20-bookworm-slim ships a non-root "node" user out of the box.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
