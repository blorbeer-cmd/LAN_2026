# Multi-stage build: compile TypeScript + native better-sqlite3 addon in a
# full build image, then ship only the runtime bits. Both stages use the same
# base image so the native addon's glibc ABI matches between build and run.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 compiles a native addon at install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# npm runs the repository's prepare hook during npm ci. Include that tiny
# script before dependency installation so container builds stay quiet; it
# intentionally becomes a no-op because the image has no .git checkout.
COPY package.json package-lock.json ./
COPY scripts/setup-git-hooks.js ./scripts/setup-git-hooks.js
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies now that the build output exists, so the runtime stage
# only copies production node_modules.
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY agent-dist ./agent-dist

# node:24-bookworm-slim ships a non-root "node" user out of the box.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# The deploy waits for this check before reporting success. It uses Node
# itself so the slim runtime image needs no curl/wget package, and reads the
# existing container environment without exposing ACCESS_TOKEN in CI logs.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{'x-access-token':process.env.ACCESS_TOKEN||''}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
