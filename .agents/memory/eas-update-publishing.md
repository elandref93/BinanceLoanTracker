---
name: EAS Update (OTA) publishing in this env
description: How to reliably publish an Expo OTA update from the Replit container for ledger-mobile.
---

Publishing an `eas update` from this container must go through a Replit-managed **workflow**, not a backgrounded/detached shell.

**Why:** Detached/background shells get SIGKILLed mid-export in this environment, so a long `eas update` (cold Metro export ~3-5 min) never finishes and writes no sentinel. A managed workflow survives and its logs are pollable.

**How to apply:**
- `configureWorkflow({ name: "Publish OTA", outputType: "console", command: <below> })`, then poll `getWorkflowStatus` until output shows `Published!`, then `removeWorkflow`.
- Command: `cd artifacts/ledger-mobile && EXPO_PUBLIC_DOMAIN=binance-loan-tracker-backend.azurewebsites.net EXPO_USE_METRO_WORKSPACE_ROOT=1 CI=1 NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/eas update --branch production --message "..." --non-interactive`
- `EXPO_TOKEN` secret is set (auth). `EXPO_PUBLIC_DOMAIN` is NOT in env — must be inlined (points at the Azure backend in production).
- Runtime version is `appVersion` (1.0.0); branch `production`. The first OTA carrying a new feature is itself invisible — the device applies it on next cold launch (checkAutomatically ON_LOAD, fallbackToCacheTimeout 0), so user must open→close→open once before any new UI appears.
- Changing `fallbackToCacheTimeout` / native config requires a native rebuild (`tf:build`), not an OTA.
