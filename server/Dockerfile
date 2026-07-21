# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS dependency-base
WORKDIR /app

# npm runs the repository's prepare hook during npm ci. Include that tiny
# script before dependency installation so container builds stay quiet; it
# intentionally becomes a no-op because the image has no .git checkout.
COPY --link package.json package-lock.json ./
COPY --link scripts/setup-git-hooks.js ./scripts/setup-git-hooks.js

# better-sqlite3 12.11.1 provides a Node 24 Linux prebuild, so neither this
# stage nor the production dependency stage needs a native compiler toolchain.
# The cache only accelerates downloads; an empty cache still produces the
# package-lock.json-pinned dependency tree.
FROM dependency-base AS build-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM dependency-base AS prod-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM build-deps AS builder

COPY --link tsconfig.json ./
COPY --link src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --link --chown=1000:1000 --from=prod-deps /app/package.json ./package.json
COPY --link --chown=1000:1000 --from=prod-deps /app/node_modules ./node_modules
COPY --link --chown=1000:1000 --from=builder /app/dist ./dist

# Keep the large, infrequently changing Windows agent payload independent so
# BuildKit can rebase and reuse this layer when other application files change.
COPY --link --chown=1000:1000 agent-dist ./agent-dist
COPY --link --chown=1000:1000 public ./public
COPY --link --chown=1000:1000 scripts/jam-controller.mjs ./scripts/jam-controller.mjs

# node:24-bookworm-slim ships a non-root "node" user out of the box. The data
# directory remains writable even when the image is started without Compose's
# production bind mount; all shipped application files stay read-only at run
# time and already have the correct owner from COPY --chown.
RUN install -d -o node -g node /app/data
USER node

EXPOSE 3000

# The deploy waits for this check before reporting success. It uses Node
# itself so the slim runtime image needs no curl/wget package, and reads the
# existing container environment without exposing ACCESS_TOKEN in CI logs.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{'x-access-token':process.env.ACCESS_TOKEN||''}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
