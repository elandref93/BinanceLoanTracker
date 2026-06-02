---
name: expo-updates reloadAsync native crash (ledger-mobile)
description: Why the app must not call Updates.reloadAsync() on this Expo/RN/new-arch build, and how OTA updates are applied instead.
---

Do NOT call `Updates.reloadAsync()` in ledger-mobile. It crashes the app
natively on this build (Expo SDK 54, expo-updates ~29, react-native 0.81,
`newArchEnabled: true`). A JS `try/catch` cannot prevent it — native crashes
bypass JS error handling.

**Why:** A TestFlight user repeatedly crashed only on the "Tap to restart" /
"Update ready" action (the sole `reloadAsync` caller), while the app launched
and ran fine on a normal cold start. App-works-on-launch + crash-only-on-reload
isolates the fault to the native reload path, not the downloaded bundle.

**How to apply:** Staged OTA updates apply on their own on the next cold launch
because `app.json` sets `updates.checkAutomatically: ON_LOAD` and
`fallbackToCacheTimeout: 0`. So after `checkForUpdateAsync` + `fetchUpdateAsync`
stage the update, just tell the user to fully close (swipe away) and reopen the
app — never force a reload. `fallbackToCacheTimeout: 0` means "don't block
startup on the network", it does NOT disable staged-update application.
Re-enable reloadAsync only after upgrading Expo/RN/expo-updates and verifying on
a real TestFlight build.
