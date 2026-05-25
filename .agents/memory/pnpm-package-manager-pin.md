---
name: pnpm packageManager pin vs Replit nix pnpm
description: When root package.json `packageManager` field pins an older pnpm than the Replit container ships, every `pnpm` call hangs SIGABRT trying to self-install the pinned version.
---

# Rule
If `pnpm --version` (or any pnpm command) loops on `ERROR Command was killed with SIGTERM/SIGABRT: pnpm add pnpm@X.Y.Z`, the root `package.json`'s `packageManager` field is pinning a pnpm older than what nix has installed in the container. Bump the pin to match the installed version (`pnpm --version` from a fresh shell, if it ever responds — otherwise inspect `which pnpm` → nix store path version).

**Why:** Newer pnpm wrappers see the older pin and try to bootstrap that exact version via `pnpm add pnpm@X.Y.Z`. On Replit containers that bootstrap fails with `resource temporarily unavailable` (fork limit / OOM under retry pressure) and retries forever, blocking every workflow that runs through pnpm.

**How to apply:** First sign is workflows failing to restart with `DIDNT_OPEN_A_PORT` while the log spams `pnpm add pnpm@X.Y.Z` errors. Fix is a one-line edit to `package.json` → `"packageManager"`. Existing `node_modules` from the prior install keeps working — no full reinstall needed.
