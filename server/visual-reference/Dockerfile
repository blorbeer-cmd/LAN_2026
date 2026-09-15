# syntax=docker/dockerfile:1
# Reference environment for the visual E2E comparisons (visualCore/visualArcade). Local runs and
# CI build this same file, so OS packages, fonts, Chromium, Playwright, Node.js and the CPU
# architecture match exactly. Any change here changes the reference profile and requires the
# controlled refresh described in server/TESTING.md ("Visuelle Referenzen").
#
# Ubuntu 24.04 with the Chromium build and system libraries/fonts of Playwright 1.56.1, pinned to
# the linux/amd64 image manifest.
ARG BASE_IMAGE=mcr.microsoft.com/playwright:v1.56.1-noble@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2
FROM ${BASE_IMAGE}
ARG BASE_IMAGE

# The project pins Node.js 24 (.nvmrc); the Playwright image ships its own Node.js release.
ARG NODE_VERSION=24.18.0
ARG NODE_SHA256=783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8
RUN curl -fsSLo /tmp/node.tar.gz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
  && echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --no-same-owner \
  && rm /tmp/node.tar.gz \
  && test "$(node --version)" = "v${NODE_VERSION}"

# RESPAWN_VISUAL_BASE_IMAGE marks this environment for the test runner and the profile check.
ENV TZ=Etc/UTC \
  RESPAWN_VISUAL_BASE_IMAGE=${BASE_IMAGE} \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  NPM_CONFIG_AUDIT=false \
  NPM_CONFIG_FUND=false \
  NPM_CONFIG_UPDATE_NOTIFIER=false

# Linux dependencies (better-sqlite3 is native). Runs mount the checkout read-only at /work and
# overlay this directory, so a Windows or macOS node_modules is never used here.
WORKDIR /work/server
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
