# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the Ledger api-server.
# The api-server is an esbuild-bundled Express app: everything (workspace libs,
# express, pino, clerk, drizzle, pg) is inlined into dist/index.mjs at build time,
# so the runtime image needs only node + the dist/ output. No node_modules at runtime.

# ---------- Build stage ----------
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

# Copy workspace manifests first so dependency install is cached separately from source.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY artifacts/api-server/package.json     ./artifacts/api-server/
COPY lib/api-zod/package.json              ./lib/api-zod/
COPY lib/db/package.json                   ./lib/db/

# Install only what api-server (and its workspace deps) need.
RUN pnpm install --no-frozen-lockfile --filter @workspace/api-server...

# Copy sources for api-server and its workspace deps.
COPY artifacts/api-server/ ./artifacts/api-server/
COPY lib/api-zod/          ./lib/api-zod/
COPY lib/db/               ./lib/db/

RUN pnpm --filter @workspace/api-server run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# esbuild bundle is fully self-contained — copy only dist/.
COPY --from=build /repo/artifacts/api-server/dist ./dist

# Azure App Service injects PORT; default to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Non-root user for safety.
RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
