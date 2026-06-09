---
name: EAS iOS build gotchas (ledger-mobile)
description: Two non-obvious blockers when building the Expo iOS app on EAS from the Replit sandbox — Sentry dSYM phase and git-disabled archiving.
---

# EAS iOS build gotchas (ledger-mobile)

## 1. Sentry "Upload Debug Symbols to Sentry" phase fails the archive in a pnpm monorepo
**Symptom:** `xcodebuild` archive fails with exit 65, `** ARCHIVE FAILED **`,
failing build command = `PhaseScriptExecution Upload Debug Symbols to Sentry`.

**Why:** The `@sentry/react-native` Expo config plugin (`withSentryIOS`)
*unconditionally* adds that build phase — `PluginProps` has no option to skip it.
The phase runs `scripts/sentry-xcode-debug-files.sh`, which does `set -e` and
resolves `@sentry/cli` / starts the upload *before* it checks
`SENTRY_DISABLE_AUTO_UPLOAD`. So the script dies under `set -e` earlier than the
skip check — meaning **`SENTRY_DISABLE_AUTO_UPLOAD=true` (env / eas.json) does NOT
fix it.** (The actual `debug-files upload` failure is handled gracefully and would
NOT fail the build; the hard failure is the earlier `set -e` region.)

**Fix that works:** a custom Expo config plugin
(`plugins/withDisableSentryDebugUpload.js`) listed in app.json **after**
`@sentry/react-native`, which finds the `Upload Debug Symbols to Sentry`
PBXShellScriptBuildPhase via `pbxItemByComment(...)` and rewrites its
`shellScript` to a no-op `echo`. dSYM upload only adds *native-crash*
symbolication; JS error reporting is unaffected.

**How to apply / re-enable:** To get native-crash symbolication back, remove that
plugin and give the EAS build a Sentry auth token scoped to the **eap-k2** org
with upload permission. NOTE: the `SENTRY_AUTH_TOKEN` secret in this repl only has
scope `org:ci` and 403s against eap-k2 — it is NOT sufficient as-is.

## 2. EAS builds from the Replit sandbox must use `EAS_NO_VCS=1`
**Symptom:** `eas build` aborts with "Destructive git operations are not allowed
in the main agent ... .git/index.lock". EAS's default project archiving invokes
git, which the sandbox blocks (it even blocks `rm .git/index.lock`).

**Fix:** prefix the build command with `EAS_NO_VCS=1` so EAS tars the working dir
directly instead of using git, e.g.
`EAS_NO_VCS=1 EXPO_TOKEN="$EXPO_TOKEN" pnpm --filter @workspace/ledger-mobile run tf:build`.
A stale empty `.git/index.lock` may be left behind; it's harmless when NO_VCS is set.
