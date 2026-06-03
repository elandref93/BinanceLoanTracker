---
name: api-server Sentry / esbuild bundling constraint
description: Why the backend uses @sentry/node v7 and what the single-file no-node_modules bundle forbids.
---

# api-server is a single esbuild bundle with NO node_modules at runtime

The api-server ships as one esbuild bundle (`dist/index.mjs`); the Dockerfile's
runtime stage copies **only `dist/`** — there is no `node_modules` in production.
`build.mjs` keeps an `external` list (e.g. `@opentelemetry/*`,
`@sentry/profiling-node`, native modules). Anything left external that is
actually imported at runtime crashes the process (ERR_MODULE_NOT_FOUND), because
there is nothing to resolve it against.

## Rule: backend Sentry uses `@sentry/node` v7, not v8+
**Why:** `@sentry/node` v8+ hard-depends on `@opentelemetry/*`, which is in the
esbuild `external` list and absent at runtime → startup crash. v7 is fully
self-contained (no OTel), so it bundles into the single file cleanly. For pure
error capture (captureException + Express error handler) v7 is sufficient; OTel
auto-instrumentation/tracing wouldn't work in a bundled-and-inlined app anyway.

**How to apply:** If upgrading Sentry to v8+, you must also stop externalizing
`@opentelemetry/*` AND ship `node_modules` at runtime (change the Dockerfile),
or accept it will not work. Otherwise stay on v7.

## How to verify any backend dep survives the prod runtime
Don't trust local dev (it has node_modules). After `pnpm --filter
@workspace/api-server run build`, copy `dist/` to an empty dir and run it there:
`node --enable-source-maps ./dist/index.mjs` with PORT + required env, then probe
`/api/healthz`. If it serves, the bundle is self-contained. Also grep
`dist/index.mjs` for leftover `from "@sentry`/`"@opentelemetry"` external imports.

## Source maps
Backend runs with `node --enable-source-maps` and `dist/*.map` ships, so stack
traces are already original-source-mapped before Sentry captures them — no
sentry-cli upload / SENTRY_AUTH_TOKEN needed for the backend. The auth token is a
MOBILE concern only (native dSYMs + RN JS source map upload during EAS build).
