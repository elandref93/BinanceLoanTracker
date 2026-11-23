# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the Ledger api-server.
# The api-server is an esbuild-bundled Express app: everything (workspace libs,
# express, pino, jose) is inlined into dist/index.mjs at build time, so the
# runtime image needs only node + the dist/ output. No node_modules at runtime.

# ---------- Build stage ----------
FROM node:26.12.1-alpine AS build
# Node 26 no longer ships Corepack. Install the pnpm version declared in package.json.
RUN npm install -g pnpm@10.26.1

WORKDIR /repo

# Copy workspace manifests first so dependency install is cached separately from source.
# Every workspace package listed in pnpm-workspace.yaml must have its package.json
# present at install time, even ones unrelated to api-server, otherwise pnpm fails
# workspace resolution. Mobile/scripts/etc. manifests are tiny — copying them
# costs nothing and keeps `pnpm install` happy.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server/package.json      ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json  ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json      ./lib/api-client-react/
COPY lib/api-spec/package.json              ./lib/api-spec/
COPY lib/api-zod/package.json               ./lib/api-zod/
COPY lib/db/package.json                    ./lib/db/
COPY scripts/package.json                   ./scripts/

# The root package.json declares a `preinstall` hook that runs
# scripts/ensure-pnpm.mjs to guard against accidental npm/yarn usage. We copy
# the file before install so the hook can find it.
COPY scripts/ensure-pnpm.mjs                ./scripts/

# Install only what api-server (and its workspace deps) need.
RUN pnpm install --no-frozen-lockfile --filter @workspace/api-server...

# Copy sources for api-server and its workspace deps.
COPY artifacts/api-server/ ./artifacts/api-server/
COPY lib/api-zod/          ./lib/api-zod/
COPY lib/db/               ./lib/db/

RUN pnpm --filter @workspace/api-server run build

# ---------- Dashboard stage ----------
# Tailwind, lightningcss, and Rollup publish glibc binaries. Workspace
# overrides drop the musl builds, so Vite is built on bookworm. The runtime
# image stays alpine. Do not copy artifacts/ledger-mobile (it is not in the repo).
# VITE_API_BASE_URL is empty: the built SPA calls /api on this same host.
FROM node:26.12.1-bookworm-slim AS web
RUN npm install -g pnpm@10.26.1

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server/package.json      ./artifacts/api-server/
COPY artifacts/ledger-web/package.json      ./artifacts/ledger-web/
COPY artifacts/mockup-sandbox/package.json  ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json      ./lib/api-client-react/
COPY lib/api-spec/package.json              ./lib/api-spec/
COPY lib/api-zod/package.json               ./lib/api-zod/
COPY lib/db/package.json                    ./lib/db/
COPY scripts/package.json                   ./scripts/
COPY scripts/ensure-pnpm.mjs                ./scripts/

# Root optionalDependencies pin the glibc Rollup, Tailwind, and lightningcss
# binaries. The ledger-web filter alone does not install that package.
RUN pnpm install --no-frozen-lockfile --filter @workspace/ledger-web... --filter .

COPY artifacts/ledger-web/     ./artifacts/ledger-web/
COPY lib/api-client-react/     ./lib/api-client-react/

ENV VITE_API_BASE_URL=
RUN pnpm --filter @workspace/ledger-web run build

# ---------- Runtime stage ----------
FROM node:26.12.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# esbuild bundle is fully self-contained — copy only dist/.
COPY --from=build /repo/artifacts/api-server/dist ./dist
# Built dashboard. Served by the API process on this same host.
COPY --from=web /repo/artifacts/ledger-web/dist ./web
ENV LEDGER_WEB_ROOT=/app/web

# Azure App Service injects PORT; default to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Non-root user for safety.
RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
