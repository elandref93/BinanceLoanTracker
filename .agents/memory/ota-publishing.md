---
name: How Ledger OTA updates actually reach the phone
description: The OTA publish pipeline for the Ledger/BinanceLoanTracker app and why editing code in Replit does not update installed builds.
---

OTA = EAS Update. `app.json` has `updates.url` (u.expo.dev/<projectId>),
`checkAutomatically: ON_LOAD`, `runtimeVersion.policy: appVersion` (so runtime ==
`version`). The production build profile's channel is `production`, mapped to an EAS
branch also named `production`. An OTA only reaches builds whose native version
matches the update's runtimeVersion — a native/SDK change still needs a fresh
TestFlight build.

**Canonical publish path (in-repo, deterministic):** `.github/workflows/publish-update.yml`
runs `eas update --branch production` on push to `main` touching mobile/shared paths.
It needs the `EXPO_TOKEN` secret in the GitHub repo. It sets
`EXPO_PUBLIC_DOMAIN=<azure backend>` and `EXPO_USE_METRO_WORKSPACE_ROOT=1` in the
publish step — without `EXPO_PUBLIC_DOMAIN` the bundle points at the wrong/undefined
backend.
**Why this exists:** OTA used to be published only by the Expo dashboard GitHub App
integration (actor "GitHub App · @elandref93 (robot)"), which stalled silently —
observed ~6 commits (a whole feature) sitting on origin/main with no published
update for ~11h, with no signal. If BOTH the dashboard integration and this workflow
are active they double-publish; disable the dashboard auto-update once the workflow
is in use.

**Why "feature is done" ≠ "feature on phone":**
- Editing/committing in Replit does nothing to installed builds by itself; a commit
  must reach GitHub `main` AND an OTA must be published for it.
- The current production build only **stages** OTA updates and applies them on the
  next **cold launch** (force-quit + reopen). It does NOT call
  `Updates.reloadAsync()` because that crashes natively on this New-Arch + SDK 54
  build (would roll back + re-crash). A fresh install shows "Bundled (no OTA yet)"
  until it downloads + cold-launches an update.

**Manual `eas update` from the Replit sandbox is NOT dependable:** the local Metro
export ran 9+ min without finishing (EAS/Expo infra does it in well under a minute),
and in this pnpm monorepo `babel-preset-expo` is only transitive — export fails to
resolve it unless it's a direct devDep of `@workspace/ledger-mobile`. Prefer the
GitHub Action.

**Guaranteed alternative to OTA:** `pnpm --filter @workspace/ledger-mobile run
tf:build` bakes current JS into a fresh TestFlight binary (bypasses OTA entirely).
