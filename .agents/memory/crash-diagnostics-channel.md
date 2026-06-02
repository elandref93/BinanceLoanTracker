---
name: Ledger crash diagnostics channel
description: How to actually see crashes in the private Ledger app, given Azure/TestFlight logs are unreachable from the dev env.
---

# How to see crashes in the Ledger app

There is **no remote log access** for this app from the Replit dev environment:
the backend runs on Azure (so `fetch_deployment_logs` is empty), TestFlight
crash reports aren't reachable, and no Sentry/Bugsnag DSN is wired up. Don't
waste time looking for a remote log pane — it doesn't exist here.

**The debugging channel is on-device capture:**
- `lib/crashReporting.ts` installs a global JS error handler (`ErrorUtils`),
  unhandled-rejection hooks, and records anything the React error boundary
  catches. Entries persist to AsyncStorage so they **survive the crash**.
- The user opens **Settings → Diagnostics → Crash logs** (`app/diagnostics.tsx`),
  taps "Copy all", and sends the text. That stack trace is the primary signal.
- Best-effort copies also POST to the backend `POST /api/diag/crash`
  (auth-gated, in-memory ring), which logs them at `error` level into the Azure
  log stream and is readable via `GET /api/diag/crash`.

**Why:** repeated "it still crashes" reports were unactionable because nothing
captured the actual error. On-device persistence + an in-app viewer turns vague
reports into real stack traces.

**How to apply / constraints:**
- The reporter must NEVER throw (every path is try/caught) — a crashing crash
  reporter is worse than none.
- Serialize all buffer writes (`store()`/`clearCrashes()` go through one promise
  chain). AsyncStorage has no atomic RMW, so concurrent unserialized writes
  last-finish-wins and silently roll back newer entries.
- Frontend changes ship via EAS OTA (no Azure redeploy). The backend `/api/diag`
  route needs a GitHub push to deploy; until then the client POST 404s and is
  swallowed — the local Diagnostics screen still works regardless.
- A *native* crash (e.g. react-native-svg NaN) dies before JS runs and won't be
  captured — prevent those at the data edge instead.
